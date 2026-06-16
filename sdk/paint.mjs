// Painting helpers built on Session. Covers the "Image" project type (standalone pixel
// art for item textures) and UV-located drawing onto model textures.
import { BB } from './internal/bb.mjs';
import { Session, createSession } from './session.mjs';

/**
 * Create an Image project — a standalone canvas for drawing a pixel texture (item icons,
 * block textures), matching Blockbench's "Image" format. Returns { session, texture }.
 */
export function createImageSession({ name = 'image', width = 16, height = 16, fill } = {}) {
	const session = createSession('image', { name });
	const texture = session.addTexture({ name, width, height, fill });
	return { session, texture };
}

/** Compute a cube face's pixel rect [x,y,w,h] on a texture. */
export function faceUVRect(session, element, faceKey, texture) {
	const face = element.faces[faceKey];
	const uv = face.uv;
	const sx = texture.width / session.project.getUVWidth(texture);
	const sy = texture.height / session.project.getUVHeight(texture);
	return [
		Math.min(uv[0], uv[2]) * sx,
		Math.min(uv[1], uv[3]) * sy,
		Math.abs(uv[2] - uv[0]) * sx,
		Math.abs(uv[3] - uv[1]) * sy,
	];
}

/** Read a texture's pixels as a flat RGBA Uint8ClampedArray. */
export function readPixels(session, texture) {
	return session.run(() => {
		const ctx = texture.canvas.getContext('2d');
		return ctx.getImageData(0, 0, texture.canvas.width, texture.canvas.height).data;
	});
}

export { Session, createSession };
