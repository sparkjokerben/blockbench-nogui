// Blockbench Headless SDK — AI-first, headless, parallel.
//
// Quick start (single process):
//   import { createSession, renderSession } from './sdk/index.mjs';
//   const s = createSession('java_block', { name: 'thing' });
//   s.setResolution(16, 16);
//   const cube = s.addCube({ name: 'block', from: [0,0,0], to: [16,16,16] });
//   const tex  = s.addTexture({ name: 'tex', width: 16, height: 16, fill: '#3a7d3a' });
//   s.applyTexture(cube, tex);
//   import { writeFileSync } from 'node:fs';
//   writeFileSync('out.png', renderSession(s, { angle: 'isometric' }));
//   writeFileSync('out.bbmodel', s.exportProject());
//
// Parallel (many sessions across CPU cores):
//   import { WorkerPool } from './sdk/index.mjs';
//   const pool = new WorkerPool({ maxWorkers: 4 });
//   const h = await pool.createSession('java_block');
//   await h.addCube({ name: 'c', from: [0,0,0], to: [8,8,8] });
//   const png = await h.render({ angle: 'front' });
//   await pool.shutdown();
//
// Live preview (browser viewer with orbit + live reload):
//   const server = await s.openPreview();   // -> open server.url in a browser
//
// Read-only access to the underlying Blockbench globals (advanced):
//   import { BB } from './sdk/index.mjs';   // BB.Formats, BB.Codecs, BB.Cube, ...

export { BB, resolveFormat } from './internal/bb.mjs';
export { Session, createSession, listSessions } from './session.mjs';
export { createImageSession, faceUVRect, readPixels } from './paint.mjs';
export { renderSession, renderAngles } from './render.mjs';
export { openPreview, PreviewServer } from './preview-server.mjs';
export { WorkerPool } from './worker-pool/pool.mjs';
export { Scheduler, FixedScheduler, AgentScheduler } from './worker-pool/scheduler.mjs';

/** List available format ids (e.g. 'java_block', 'bedrock', 'image', 'free', ...). */
export function listFormats() {
	// lazy import to avoid loading the bundle for callers that only want types
	return import('./internal/bb.mjs').then(({ BB }) => Object.keys(BB.Formats));
}
/** List available codec ids (e.g. 'project', 'gltf', 'obj', 'java_block', 'bedrock', ...). */
export function listCodecs() {
	return import('./internal/bb.mjs').then(({ BB }) => Object.keys(BB.Codecs));
}
