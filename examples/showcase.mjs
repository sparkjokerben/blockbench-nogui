// End-to-end SDK showcase: build a small character with self-painted textures,
// render it from several angles, and export to .bbmodel + glTF.
//
//   node examples/showcase.mjs
//
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createSession, renderSession, renderAngles } from '../sdk/index.mjs';

const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(out, { recursive: true });

// --- build ---
const s = createSession('java_block', { name: 'golem' });
s.setResolution(32, 32);

const root = s.addGroup({ name: 'golem', origin: [8, 0, 8] });
const legs = s.addCube({ name: 'legs', from: [3, 0, 4], to: [13, 5, 12] }, { group: root });
const body = s.addCube({ name: 'body', from: [2, 5, 3], to: [14, 14, 13] }, { group: root });
const head = s.addCube({ name: 'head', from: [4, 14, 4], to: [12, 22, 12] }, { group: root });

// --- paint ---
const skin = s.addTexture({ name: 'skin', width: 32, height: 32, fill: '#7a8c52' });
[legs, body, head].forEach((el) => s.applyTexture(el, skin));

// face on the head's south side
s.paintFace(skin, head, 'south', (ctx, { w, h }) => {
	ctx.fillStyle = '#2b2b2b';
	ctx.fillRect(w * 0.22, h * 0.30, w * 0.16, h * 0.16);  // eye
	ctx.fillRect(w * 0.62, h * 0.30, w * 0.16, h * 0.16);  // eye
	ctx.fillStyle = '#4a3b2a';
	ctx.fillRect(w * 0.30, h * 0.60, w * 0.40, h * 0.12);  // mouth
});
// a belt stripe on the body's south side
s.paintFace(skin, body, 'south', (ctx, { w, h }) => {
	ctx.fillStyle = '#c0392b';
	ctx.fillRect(0, h * 0.55, w, h * 0.15);
});

console.log('model:', s.elements.map((e) => e.name).join(', '), '| textures:', s.textures.length);

// --- render ---
const angles = renderAngles(s, ['front', 'isometric', 'left'], { width: 360, height: 360, background: '#e9eef3' });
for (const [name, png] of Object.entries(angles)) {
	writeFileSync(join(out, `golem-${name}.png`), png);
	console.log(`rendered ${name}: ${png.length} bytes`);
}

// --- export ---
writeFileSync(join(out, 'golem.bbmodel'), s.exportProject());
console.log('wrote golem.bbmodel');

const gltf = await s.export('gltf', { encoding: 'ascii', embed_textures: true });
const gltfStr = typeof gltf === 'string' ? gltf : JSON.stringify(gltf);
writeFileSync(join(out, 'golem.gltf'), gltfStr);
console.log('wrote golem.gltf:', gltfStr.length, 'bytes (embedded textures:', gltfStr.includes('data:image') + ')');

console.log('\nAll outputs in examples/out/. Done.');
process.exit(0);
