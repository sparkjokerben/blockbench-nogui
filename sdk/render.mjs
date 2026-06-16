// Headless render-to-PNG. Reuses each element's Blockbench-built geometry (correct shape +
// per-face UV) but swaps materials to plain MeshBasicMaterial backed by a DataTexture bridged
// from the texture's 2D canvas. This sidesteps two headless hazards:
//   1. Blockbench's custom GLSL ShaderMaterials (not guaranteed to compile under WebGL1)
//   2. headless-gl can't upload a napi canvas/Image directly (must be {width,height,data})
// Backend: headless-gl (WebGL1) + THREE r129, proven in the Phase 0 spike.
import createGL from 'gl';
import { PNG } from 'pngjs';
import { BB } from './internal/bb.mjs';

const THREE = BB.THREE;
const _renderers = new Map();

function getRenderer(w, h) {
	const key = w + 'x' + h;
	if (_renderers.has(key)) return _renderers.get(key);
	const glctx = createGL(w, h, { preserveDrawingBuffer: true, antialias: true });
	if (!glctx) throw new Error('headless-gl failed to create a WebGL context');
	const canvas = {
		width: w, height: h, style: {},
		addEventListener() {}, removeEventListener() {},
		getContext: () => glctx,
	};
	const renderer = new THREE.WebGLRenderer({ canvas, context: glctx, antialias: true, alpha: true, preserveDrawingBuffer: true });
	renderer.setSize(w, h, false);
	const entry = { gl: glctx, canvas, renderer };
	_renderers.set(key, entry);
	return entry;
}

// Bridge a Blockbench Texture (napi 2D canvas) -> THREE.DataTexture headless-gl can upload.
function bridgeTexture(texture, cache) {
	if (cache.has(texture.uuid)) return cache.get(texture.uuid);
	const canvas = texture.canvas;
	const ctx = canvas.getContext('2d');
	const w = canvas.width, h = canvas.height;
	const src = ctx.getImageData(0, 0, w, h).data;
	// THREE ignores flipY for DataTexture (ArrayBufferView), so flip rows manually: the
	// geometry UVs have V=1 at the cube's top, which must map to the texture's top row.
	const flipped = new Uint8Array(w * h * 4);
	for (let y = 0; y < h; y++) {
		flipped.set(src.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
	}
	const dt = new THREE.DataTexture(flipped, w, h, THREE.RGBAFormat);
	dt.magFilter = THREE.NearestFilter;
	dt.minFilter = THREE.NearestFilter;
	dt.generateMipmaps = false;
	dt.flipY = false;
	dt.needsUpdate = true;
	cache.set(texture.uuid, dt);
	return dt;
}

function materialForFace(faceTexUuid, element, texCache, project) {
	const tex = faceTexUuid && project.textures.find((t) => t.uuid === faceTexUuid);
	if (tex) {
		return new THREE.MeshBasicMaterial({
			map: bridgeTexture(tex, texCache),
			transparent: true,
			alphaTest: 0.01,
			side: THREE.DoubleSide,
		});
	}
	// untextured: solid-ish color from the element marker color
	return new THREE.MeshBasicMaterial({ color: 0xb8b8c0, side: THREE.DoubleSide });
}

const FACE_ORDER = ['north', 'east', 'south', 'west', 'up', 'down'];

const ANGLES = {
	// [azimuth(deg from +Z toward +X), elevation(deg)]
	front: [0, 0], back: [180, 0], left: [-90, 0], right: [90, 0],
	top: [0, 89.9], bottom: [0, -89.9], isometric: [45, 30], iso: [45, 30],
};

/**
 * Render a session's model to a PNG Buffer.
 * options: { width=512, height=512, angle='isometric'|[az,el], background=null(transparent)|css,
 *            fov=45, distance(auto), ortho=false, zoom=1 }
 */
export function renderSession(session, options = {}) {
	const { width = 512, height = 512, angle = 'isometric', background = null, fov = 45, ortho = false, zoom = 1 } = options;
	return session.run(() => {
		const project = session.project;

		// Parent meshes under their groups + refresh transforms so matrixWorld is correct
		// (including group/bone transforms) for grouped models.
		session.assembleSceneGraph();

		const root = new THREE.Group();
		const texCache = new Map();
		const box = new THREE.Box3();
		let hasGeometry = false;

		for (const el of project.elements) {
			const mesh = el.mesh;
			if (!mesh || !mesh.geometry || el.visibility === false) continue;
			const geo = mesh.geometry; // Blockbench geometry UVs are already normalized [0,1]
			if (!geo.attributes.position) continue;

			// material(s)
			let material;
			if (el.faces && geo.groups && geo.groups.length > 1) {
				material = FACE_ORDER.map((fk) => materialForFace(el.faces[fk]?.texture, el, texCache, project));
			} else {
				const firstFace = el.faces && Object.values(el.faces)[0];
				material = materialForFace(firstFace?.texture, el, texCache, project);
			}

			const rmesh = new THREE.Mesh(geo, material);
			rmesh.matrixAutoUpdate = false;
			rmesh.matrix.copy(mesh.matrixWorld);
			root.add(rmesh);
			hasGeometry = true;
		}

		root.updateMatrixWorld(true);
		if (hasGeometry) box.setFromObject(root);
		if (box.isEmpty()) box.set(new THREE.Vector3(-8, -8, -8), new THREE.Vector3(8, 8, 8));

		const center = box.getCenter(new THREE.Vector3());
		const size = box.getSize(new THREE.Vector3());
		const radius = Math.max(size.x, size.y, size.z, 1) * 0.5;

		// camera
		const [az, el] = Array.isArray(angle) ? angle : (ANGLES[angle] || ANGLES.isometric);
		const azr = (az * Math.PI) / 180, elr = (el * Math.PI) / 180;
		const dist = options.distance ?? (radius / Math.sin((fov / 2) * Math.PI / 180)) * 1.35;
		const dir = new THREE.Vector3(
			Math.cos(elr) * Math.sin(azr),
			Math.sin(elr),
			Math.cos(elr) * Math.cos(azr),
		);
		let camera;
		if (ortho) {
			const half = (radius * 1.2) / zoom;
			const aspect = width / height;
			camera = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.01, dist * 4 + radius * 4);
		} else {
			camera = new THREE.PerspectiveCamera(fov, width / height, 0.01, dist * 4 + radius * 4);
		}
		camera.position.copy(center).add(dir.multiplyScalar(dist));
		camera.lookAt(center);

		// lights (MeshBasicMaterial ignores them, but harmless + future-proof)
		const scene = new THREE.Scene();
		scene.add(root);
		scene.add(new THREE.AmbientLight(0xffffff, 1));

		const { gl: glctx, renderer } = getRenderer(width, height);
		if (background == null) {
			renderer.setClearColor(0x000000, 0);
		} else {
			renderer.setClearColor(new THREE.Color(background), 1);
		}
		renderer.render(scene, camera);

		// read pixels (bottom-up) -> PNG (top-down)
		const pixels = new Uint8Array(width * height * 4);
		glctx.readPixels(0, 0, width, height, glctx.RGBA, glctx.UNSIGNED_BYTE, pixels);
		const png = new PNG({ width, height });
		for (let y = 0; y < height; y++) {
			png.data.set(pixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
		}

		// cleanup render meshes (geometry is shared with Blockbench, don't dispose it)
		root.clear();
		return PNG.sync.write(png);
	});
}

/** Render several angles at once. Returns { angleName: Buffer }. */
export function renderAngles(session, angles = ['front', 'isometric', 'top'], options = {}) {
	const out = {};
	for (const a of angles) out[a] = renderSession(session, { ...options, angle: a });
	return out;
}
