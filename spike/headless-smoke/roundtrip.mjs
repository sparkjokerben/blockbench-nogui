// Phase 1 verification: build -> export bbmodel -> reload -> modify -> re-export,
// plus a glTF export. Run from repo root: node spike/headless-smoke/roundtrip.mjs
import '../../dist/headless.js';
const g = globalThis;

function section(t) { console.log('\n=== ' + t + ' ==='); }

section('build a model');
const fmt = g.Formats.free;
g.newProject(fmt);
g.Project.name = 'roundtrip_demo';
g.Project.texture_width = 16;
g.Project.texture_height = 16;

const body = new g.Group({ name: 'body' }).init();
const cube1 = new g.Cube({ name: 'torso', from: [-4, 0, -2], to: [4, 12, 2] }).init();
const cube2 = new g.Cube({ name: 'head', from: [-4, 12, -4], to: [4, 20, 4] }).init();
cube1.addTo(body);
cube2.addTo(body);
console.log('elements:', g.Outliner.elements.length, '| groups:', g.Project.groups.length);

section('export bbmodel');
const bbmodel = g.Codecs.project.compile();
const bbStr = typeof bbmodel === 'string' ? bbmodel : JSON.stringify(bbmodel);
console.log('bbmodel bytes:', bbStr.length);
const parsed = JSON.parse(bbStr);
console.log('exported elements:', parsed.elements.map(e => e.name).join(', '));
console.log('exported groups (outliner):', JSON.stringify(parsed.outliner?.map?.(o => o.name ?? o)));

section('reload into a fresh project');
g.newProject(g.Formats.free);
g.Codecs.project.parse(JSON.parse(bbStr), 'roundtrip.bbmodel');
console.log('reloaded name:', g.Project.name);
console.log('reloaded elements:', g.Outliner.elements.map(e => e.name).join(', '));
const reloadedHead = g.Outliner.elements.find(e => e.name === 'head');
console.log('head from/to:', JSON.stringify(reloadedHead?.from), JSON.stringify(reloadedHead?.to));

section('modify + re-export');
reloadedHead.from[1] = 13;
reloadedHead.to[1] = 21;
const bb2 = g.Codecs.project.compile();
const bb2Str = typeof bb2 === 'string' ? bb2 : JSON.stringify(bb2);
const head2 = JSON.parse(bb2Str).elements.find(e => e.name === 'head');
console.log('modified head from/to:', JSON.stringify(head2.from), JSON.stringify(head2.to));

section('export glTF');
let gltfOk = false;
try {
	const gltfCodec = g.Codecs.gltf;
	gltfCodec.compile({}, (content) => {
		const s = typeof content === 'string' ? content : JSON.stringify(content);
		console.log('glTF bytes:', s.length, '| has meshes:', s.includes('"meshes"'));
		gltfOk = s.length > 100;
	});
} catch (err) {
	console.log('glTF export error:', err.message);
}

section('result');
const ok = parsed.elements.length === 2
	&& g.Outliner.elements.length === 2
	&& head2.from[1] === 13;
console.log(ok ? 'OK: bbmodel build/export/reload/modify works.' : 'FAIL');
console.log('glTF export:', gltfOk ? 'OK' : 'not confirmed (may be async)');
process.exit(ok ? 0 : 1);
