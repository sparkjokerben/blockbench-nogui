// Long-running preview demo for visual verification. Prints a fixed URL and stays alive,
// animating an edit every few seconds to exercise live reload.
import { createSession } from '../../sdk/session.mjs';

const s = createSession('java_block', { name: 'preview_live' });
s.setResolution(16, 16);

const body = s.addGroup({ name: 'body', origin: [8, 0, 8] });
const base = s.addCube({ name: 'base', from: [0, 0, 0], to: [16, 6, 16] }, { group: body });
const head = s.addCube({ name: 'head', from: [3, 6, 3], to: [13, 16, 13] }, { group: body });

const tBase = s.addTexture({ name: 'base_tex', width: 16, height: 16, fill: '#3a7d3a' });
const tHead = s.addTexture({ name: 'head_tex', width: 16, height: 16, fill: '#b5651d' });
s.applyTexture(base, tBase);
s.applyTexture(head, tHead);
s.paintFace(tHead, head, 'south', (ctx, { w, h }) => {
	ctx.fillStyle = '#222';
	ctx.fillRect(w * 0.2, h * 0.35, w * 0.15, h * 0.15);
	ctx.fillRect(w * 0.65, h * 0.35, w * 0.15, h * 0.15);
	ctx.fillRect(w * 0.3, h * 0.62, w * 0.4, h * 0.1);
});

const server = await s.openPreview({ port: 8782 });
console.log('PREVIEW_URL=' + server.url);
console.log('serving… (Ctrl+C to stop)');

// keep the process alive
setInterval(() => {}, 1 << 30);
