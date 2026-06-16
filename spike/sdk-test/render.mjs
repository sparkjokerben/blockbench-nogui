// Phase 4 verification: build a textured model and render it headlessly to PNG.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createSession } from '../../sdk/session.mjs';
import { renderSession, renderAngles } from '../../sdk/render.mjs';

const outDir = dirname(fileURLToPath(import.meta.url));

const s = createSession('java_block', { name: 'render_demo' });
s.setResolution(16, 16);

// a 2-part model: a green base + a head group, each textured
const base = s.addCube({ name: 'base', from: [0, 0, 0], to: [16, 6, 16] });
const head = s.addCube({ name: 'head', from: [3, 6, 3], to: [13, 14, 13] });

const tBase = s.addTexture({ name: 'base_tex', width: 16, height: 16, fill: '#3a7d3a' });
const tHead = s.addTexture({ name: 'head_tex', width: 16, height: 16, fill: '#b5651d' });
s.applyTexture(base, tBase);
s.applyTexture(head, tHead);
// draw a face pattern on the head's front
s.paintFace(tHead, head, 'north', (ctx, { w, h }) => {
	ctx.fillStyle = '#222';
	ctx.fillRect(w * 0.2, h * 0.3, w * 0.15, h * 0.15); // left eye
	ctx.fillRect(w * 0.65, h * 0.3, w * 0.15, h * 0.15); // right eye
	ctx.fillRect(w * 0.3, h * 0.65, w * 0.4, h * 0.1);   // mouth
});

console.log('rendering...');
const iso = renderSession(s, { angle: 'isometric', width: 400, height: 400 });
writeFileSync(join(outDir, 'render-iso.png'), iso);

const front = renderSession(s, { angle: 'front', width: 400, height: 400, background: '#dfe6ee' });
writeFileSync(join(outDir, 'render-front.png'), front);

const top = renderSession(s, { angle: 'top', width: 400, height: 400 });
writeFileSync(join(outDir, 'render-top.png'), top);

// self-check: count opaque pixels in the iso render
import { PNG } from 'pngjs';
const parsed = PNG.sync.read(iso);
let opaque = 0;
for (let i = 3; i < parsed.data.length; i += 4) if (parsed.data[i] > 10) opaque++;
const pct = (opaque / (parsed.width * parsed.height) * 100).toFixed(1);
console.log(`iso render: ${iso.length} bytes, ${pct}% opaque`);
console.log('wrote render-iso.png, render-front.png, render-top.png');

const ok = iso.length > 1000 && opaque > 2000;
console.log('\n' + (ok ? 'OK: headless render works.' : 'FAIL: render looks empty.'));
process.exit(ok ? 0 : 1);
