// Phase 3 verification: image project pixel art + UV-located cube-face painting.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createSession } from '../../sdk/session.mjs';
import { createImageSession, readPixels } from '../../sdk/paint.mjs';

const outDir = dirname(fileURLToPath(import.meta.url));

// 1) Image project: draw a tiny 16x16 "sword" item icon.
console.log('=== image project (item icon) ===');
const { session: img, texture: icon } = createImageSession({ name: 'sword', width: 16, height: 16, fill: 'rgba(0,0,0,0)' });
img.paint(icon, (ctx) => {
	ctx.fillStyle = '#8a8a8a';            // blade
	for (let i = 0; i < 7; i++) ctx.fillRect(9 - i, 2 + i, 2, 2);
	ctx.fillStyle = '#5a3a1a';            // handle
	ctx.fillRect(3, 11, 3, 3);
	ctx.fillStyle = '#caa24a';            // guard
	ctx.fillRect(4, 9, 5, 2);
});
const iconPng = img.exportTexturePNG(icon);
writeFileSync(join(outDir, 'out-icon.png'), iconPng);
const iconPixels = readPixels(img, icon);
let iconOpaque = 0;
for (let i = 3; i < iconPixels.length; i += 4) if (iconPixels[i] > 0) iconOpaque++;
console.log('icon PNG bytes:', iconPng.length, '| opaque px:', iconOpaque);

// 2) Model + texture: paint a specific cube face.
console.log('\n=== model face painting ===');
const m = createSession('java_block', { name: 'painted_block' });
m.setResolution(16, 16);
const cube = m.addCube({ name: 'block', from: [0, 0, 0], to: [16, 16, 16] });
const tex = m.addTexture({ name: 'block_tex', width: 16, height: 16, fill: '#3a7d3a' });
m.applyTexture(cube, tex);
// paint the "up" face red with a yellow dot
m.paintFace(tex, cube, 'up', (ctx, { w, h }) => {
	ctx.fillStyle = '#c0392b';
	ctx.fillRect(0, 0, w, h);
	ctx.fillStyle = '#f1c40f';
	ctx.fillRect(w / 2 - 1, h / 2 - 1, 2, 2);
});
const texPng = m.exportTexturePNG(tex);
writeFileSync(join(outDir, 'out-block-tex.png'), texPng);

// verify the up-face rect actually changed to red
const upFace = cube.faces.up.uv; // [x1,y1,x2,y2]
const px = readPixels(m, tex);
const W = tex.canvas.width;
const cx = Math.floor((Math.min(upFace[0], upFace[2]) + Math.abs(upFace[2] - upFace[0]) / 2));
const cy = Math.floor((Math.min(upFace[1], upFace[3]) + Math.abs(upFace[3] - upFace[1]) / 2));
const idx = (cy * W + cx) * 4;
console.log('block tex PNG bytes:', texPng.length);
console.log('up-face center pixel rgba:', px[idx], px[idx + 1], px[idx + 2], px[idx + 3], '(at', cx + ',' + cy + ')');

const ok = iconPng.length > 100 && iconOpaque > 10 && texPng.length > 100 && (px[idx] > 180 || (px[idx] > 180 && px[idx+1] > 180));
console.log('\n' + (ok ? 'OK: image + face painting works. Wrote out-icon.png, out-block-tex.png' : 'FAIL'));
process.exit(ok ? 0 : 1);
