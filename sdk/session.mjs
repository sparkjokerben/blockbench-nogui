// Session: an isolated model project. Blockbench keeps one *active* Project global
// (Blockbench.Project), with many ModelProjects coexisting in ModelProject.all and
// project.select() switching the active one. A Session wraps one ModelProject and runs
// every operation inside select() — a cooperative, single-active concurrency model.
// True parallelism comes from the worker pool (one process per worker).
import { BB, resolveFormat } from './internal/bb.mjs';

export class Session {
	/** @param {any} project a Blockbench ModelProject */
	constructor(project) {
		this.project = project;
		this._closed = false;
	}

	/** Create a new session (project) with the given format id or ModelFormat. */
	static create(format = 'free', { name } = {}) {
		const fmt = resolveFormat(format);
		const project = new BB.ModelProject({ format: fmt });
		const session = new Session(project);
		session.run(() => {
			// Mirror newProject() minus the DOM/camera bits.
			if (fmt.edit_mode) {
				if (BB.Mode.selected !== BB.Modes.options.edit) BB.Modes.options.edit?.select();
			} else if (fmt.paint_mode) {
				if (BB.Modes.options.paint) BB.Modes.options.paint.select();
			}
			if (typeof BB.Format.onSetup === 'function') BB.Format.onSetup(project, true);
			if (name) project.name = name;
			BB.Blockbench.dispatchEvent('new_project', { project });
		});
		return session;
	}

	get id() { return this.project.uuid; }
	get name() { return this.project.name; }
	set name(v) { this.run(() => { this.project.name = v; }); }
	get active() { return BB.Project === this.project; }
	get format() { return this.project.format; }

	/** Make this session's project the active global Project. */
	activate() {
		this._assertOpen();
		if (!this.active) this.project.select();
		return this;
	}

	/** Run fn with this session active; restores nothing (cooperative single-active). */
	run(fn) {
		this.activate();
		return fn(this);
	}

	/** Run fn wrapped in an Undo transaction over the whole project. */
	edit(name, fn, aspects = { elements: [], outliner: true, group: true, textures: [], selection: true }) {
		return this.run(() => {
			BB.Undo.initEdit(aspects);
			let result;
			try {
				result = fn(this);
			} finally {
				BB.Undo.finishEdit(name);
			}
			return result;
		});
	}

	undo() { return this.run(() => BB.Undo.undo()); }
	redo() { return this.run(() => BB.Undo.redo()); }

	// --- model resolution ---
	setResolution(width, height) {
		return this.run(() => {
			this.project.texture_width = width;
			this.project.texture_height = height;
		});
	}

	// --- elements ---
	/** Add a cube. data: {name, from:[x,y,z], to:[x,y,z], origin?, rotation?, autouv?, color?, faces?} */
	addCube(data = {}, { group } = {}) {
		return this.run(() => {
			BB.Undo.initEdit({ outliner: true, elements: [] });
			const cube = new BB.Cube({
				name: data.name ?? 'cube',
				from: data.from ?? [0, 0, 0],
				to: data.to ?? [1, 1, 1],
				origin: data.origin ?? [0, 0, 0],
				rotation: data.rotation ?? [0, 0, 0],
				autouv: data.autouv ?? 1,
				color: data.color ?? 0,
				...(data.faces ? { faces: data.faces } : {}),
			}).init();
			if (group) cube.addTo(this._resolveGroup(group));
			// auto-map per-face UVs from the cube's size (otherwise faces map to a 1px region)
			if (!data.faces && !cube.box_uv) cube.mapAutoUV();
			BB.Undo.finishEdit('Add cube', { outliner: true, elements: [cube] });
			return cube;
		});
	}

	/** Add a group/bone. data: {name, origin?, rotation?} */
	addGroup(data = {}, { parent } = {}) {
		return this.run(() => {
			BB.Undo.initEdit({ outliner: true });
			const group = new BB.Group({
				name: data.name ?? 'group',
				origin: data.origin ?? [0, 0, 0],
				rotation: data.rotation ?? [0, 0, 0],
			}).init();
			if (parent) group.addTo(this._resolveGroup(parent));
			BB.Undo.finishEdit('Add group', { outliner: true, groups: [group] });
			return group;
		});
	}

	_resolveGroup(g) {
		if (!g) return undefined;
		if (typeof g === 'string') return this.project.groups.find(gr => gr.uuid === g || gr.name === g);
		return g;
	}

	/** All outliner elements (cubes, meshes, locators, ...). */
	get elements() { return this.run(() => this.project.elements.slice()); }
	/** All groups. */
	get groups() { return this.run(() => this.project.groups.slice()); }

	getElement(idOrName) {
		return this.run(() => this.project.elements.find(e => e.uuid === idOrName || e.name === idOrName));
	}

	remove(el) {
		return this.run(() => {
			const target = typeof el === 'string' ? this.getElement(el) : el;
			if (!target) return;
			BB.Undo.initEdit({ outliner: true, elements: [target] });
			target.remove?.();
			BB.Undo.finishEdit('Remove element', { outliner: true, elements: [] });
		});
	}

	// --- textures / painting ---
	get textures() { return this.run(() => this.project.textures.slice()); }

	/**
	 * Create a blank (or filled) texture and add it to the project.
	 * opts: {name, width, height, fill (css color), dataUrl}
	 */
	addTexture(opts = {}) {
		return this.run(() => {
			const width = opts.width ?? this.project.texture_width ?? 16;
			const height = opts.height ?? this.project.texture_height ?? 16;
			const texture = new BB.Texture({ name: opts.name ?? 'texture' });
			if (opts.dataUrl) {
				texture.fromDataURL(opts.dataUrl);
			} else {
				// blank canvas of the requested size
				texture.canvas.width = width;
				texture.canvas.height = height;
				texture.width = width;
				texture.height = height;
				texture.source = texture.canvas.toDataURL('image/png', 1);
			}
			texture.add(false);
			if (!opts.dataUrl && opts.fill) {
				this.paint(texture, (ctx) => {
					ctx.fillStyle = opts.fill;
					ctx.fillRect(0, 0, width, height);
				});
			}
			return texture;
		});
	}

	/**
	 * Paint on a texture. fn receives (ctx, {width,height,texture}). Pixel-perfect: image
	 * smoothing is disabled. Wrapped in an Undo transaction unless {undo:false}.
	 */
	paint(texture, fn, { undo = true, name = 'Paint texture' } = {}) {
		return this.run(() => {
			texture.edit((canvas) => {
				const ctx = canvas.getContext('2d');
				ctx.imageSmoothingEnabled = false;
				fn(ctx, { width: canvas.width, height: canvas.height, texture });
			}, undo ? { edit_name: name } : { no_undo: true });
			return texture;
		});
	}

	/** Assign a texture to an element's faces (all faces by default). */
	applyTexture(element, texture, { faces } = {}) {
		return this.run(() => {
			BB.Undo.initEdit({ elements: [element] });
			const keys = faces || Object.keys(element.faces || {});
			keys.forEach((k) => { if (element.faces[k]) element.faces[k].texture = texture.uuid; });
			element.preview_controller?.updateFaces?.(element);
			element.preview_controller?.updateUV?.(element);
			BB.Undo.finishEdit('Apply texture');
			return element;
		});
	}

	/**
	 * Paint within a cube face's UV region. fn receives (ctx, {x,y,w,h}) already translated &
	 * clipped to the face's pixel rect, so (0,0) is the face's top-left.
	 */
	paintFace(texture, element, faceKey, fn, opts = {}) {
		return this.run(() => {
			const face = element.faces?.[faceKey];
			if (!face) throw new Error(`No face '${faceKey}' on element`);
			const uv = face.uv; // [x1,y1,x2,y2] in project UV units
			const sx = texture.width / this.project.getUVWidth(texture);
			const sy = texture.height / this.project.getUVHeight(texture);
			const x = Math.min(uv[0], uv[2]) * sx;
			const y = Math.min(uv[1], uv[3]) * sy;
			const w = Math.abs(uv[2] - uv[0]) * sx;
			const h = Math.abs(uv[3] - uv[1]) * sy;
			this.paint(texture, (ctx) => {
				ctx.save();
				ctx.translate(x, y);
				ctx.beginPath();
				ctx.rect(0, 0, w, h);
				ctx.clip();
				fn(ctx, { x, y, w, h });
				ctx.restore();
			}, { name: 'Paint face', ...opts });
			return texture;
		});
	}

	/** Export a texture as a PNG Buffer. */
	exportTexturePNG(texture) {
		return this.run(() => {
			// napi canvas -> PNG buffer directly (no DOM)
			if (typeof texture.canvas.toBuffer === 'function') {
				return texture.canvas.toBuffer('image/png');
			}
			const dataUrl = texture.canvas.toDataURL('image/png', 1);
			return Buffer.from(dataUrl.split(',')[1], 'base64');
		});
	}

	/**
	 * Parent each element/group THREE mesh under its outliner parent's mesh and refresh
	 * transforms, so geometry exporters (glTF/OBJ/...) and grouped renders see the full
	 * scene graph. The SDK builds elements with .init() (cheap), which doesn't do this.
	 */
	assembleSceneGraph() {
		return this.run(() => {
			const Canvas = BB.Canvas;
			const root3d = this.project.model_3d || Canvas.scene;
			this.project.groups.forEach((g) => g.preview_controller?.updateTransform?.(g));
			this.project.elements.forEach((el) => {
				el.preview_controller?.updateTransform?.(el);
				el.preview_controller?.updateGeometry?.(el);
			});
			const place = (node) => {
				if (!node.mesh) return;
				const parent = node.parent;
				const parentObj = (parent && parent !== 'root' && parent.mesh) ? parent.mesh : root3d;
				if (parentObj && node.mesh.parent !== parentObj) parentObj.add(node.mesh);
			};
			this.project.groups.forEach(place);
			this.project.elements.forEach(place);
			root3d?.updateMatrixWorld?.(true);
		});
	}

	// --- IO ---
	/** Export the project as a .bbmodel string. */
	exportProject() {
		return this.run(() => {
			const out = BB.Codecs.project.compile();
			return typeof out === 'string' ? out : JSON.stringify(out);
		});
	}

	/**
	 * Export via any codec by id (e.g. 'gltf','obj','java_block','bedrock'). Returns a Promise
	 * because some codecs (gltf) compile via callback. options is codec-specific.
	 */
	export(codecId, options = {}) {
		return new Promise((resolve, reject) => {
			this.run(() => {
				const codec = BB.Codecs[codecId];
				if (!codec) return reject(new Error(`Unknown codec: ${codecId}`));
				// geometry exporters walk the THREE scene graph; make sure it's assembled
				if (['gltf', 'obj', 'fbx', 'collada', 'stl'].includes(codecId)) this.assembleSceneGraph();
				try {
					// gltf/collada style: compile(options, callback)
					if (codec.compile.length >= 2) {
						codec.compile(options, (content) => resolve(content));
					} else {
						resolve(codec.compile(options));
					}
				} catch (err) {
					reject(err);
				}
			});
		});
	}

	/** Load a .bbmodel (string or object) into this session, replacing content. */
	loadProject(model, path = 'model.bbmodel') {
		return this.run(() => {
			const data = typeof model === 'string' ? JSON.parse(model) : model;
			BB.Codecs.project.parse(data, path);
			return this;
		});
	}

	/** Snapshot the model as a bbmodel object (for preview / inspection). */
	snapshot() {
		return this.run(() => {
			const out = BB.Codecs.project.compile();
			return typeof out === 'string' ? JSON.parse(out) : out;
		});
	}

	/** Start a live browser preview server bound to this session. Returns a PreviewServer. */
	async openPreview(opts) {
		const { openPreview } = await import('./preview-server.mjs');
		return openPreview(this, opts);
	}

	/** Close and free the project. */
	close() {
		if (this._closed) return;
		this.run(() => {
			try { this.project.close(true); } catch { /* best effort */ }
		});
		this._closed = true;
	}

	_assertOpen() {
		if (this._closed) throw new Error('Session is closed');
	}
}

/** Convenience factory. */
export function createSession(format = 'free', opts) {
	return Session.create(format, opts);
}

/** List all live project sessions in this process. */
export function listSessions() {
	return BB.ModelProject.all.map((p) => new Session(p));
}
