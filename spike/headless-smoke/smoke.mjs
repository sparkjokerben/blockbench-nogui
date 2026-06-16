// Phase 1 smoke test: load the headless bundle, build a tiny model, export bbmodel.
// Run from repo root: node spike/headless-smoke/smoke.mjs
import '../../dist/headless.js';

const g = globalThis;

console.log('--- bundle loaded ---');
console.log('Blockbench:', typeof g.Blockbench, 'version', g.Blockbench?.version);
console.log('setup_successful:', g.Blockbench?.setup_successful);
console.log('THREE r', g.THREE?.REVISION);
console.log('Formats:', g.Formats ? Object.keys(g.Formats).length + ' formats' : 'MISSING');
console.log('Codecs:', g.Codecs ? Object.keys(g.Codecs).length + ' codecs' : 'MISSING');
console.log('Cube:', typeof g.Cube, 'Group:', typeof g.Group, 'ModelProject:', typeof g.ModelProject);
console.log('Canvas.scene:', !!g.Canvas?.scene, 'emptyMaterials:', g.Canvas?.emptyMaterials?.length);

console.log('\n--- creating a project ---');
const fmt = g.Formats.free || g.Formats.bedrock || Object.values(g.Formats)[0];
console.log('using format:', fmt?.id);
const project = g.newProject ? g.newProject(fmt) : null;
console.log('newProject ->', !!project, 'Project active:', !!g.Project, g.Project?.uuid);

console.log('\n--- adding a cube ---');
const cube = new g.Cube({ name: 'test_cube', from: [0, 0, 0], to: [8, 8, 8] }).init();
console.log('cube:', cube?.name, 'uuid:', !!cube?.uuid, 'mesh:', !!cube?.mesh, 'in Outliner:', g.Outliner?.elements?.length);

console.log('\n--- exporting bbmodel (compile) ---');
const codec = g.Codecs.project;
const compiled = codec.compile();
const out = typeof compiled === 'string' ? compiled : JSON.stringify(compiled);
console.log('bbmodel length:', out.length);
const parsed = JSON.parse(out);
console.log('elements in export:', parsed.elements?.length, '| first:', parsed.elements?.[0]?.name);

if (parsed.elements?.length === 1 && parsed.elements[0].name === 'test_cube') {
	console.log('\nOK: headless create + export works.');
} else {
	console.error('\nFAIL: export did not contain the expected cube.');
	process.exit(1);
}
