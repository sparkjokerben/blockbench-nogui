// Phase 5 verification: preview server serves model + viewer, and pushes SSE on edit.
import http from 'node:http';
import { createSession } from '../../sdk/session.mjs';

const s = createSession('java_block', { name: 'preview_demo' });
s.setResolution(16, 16);
const cube = s.addCube({ name: 'block', from: [0, 0, 0], to: [16, 16, 16] });
const tex = s.addTexture({ name: 'tex', width: 16, height: 16, fill: '#3a7d3a' });
s.applyTexture(cube, tex);

const server = await s.openPreview({ port: 0 });
console.log('preview url:', server.url);

function get(path) {
	return new Promise((resolve, reject) => {
		http.get(server.url.replace(/\/$/, '') + path, (res) => {
			let body = '';
			res.on('data', (d) => (body += d));
			res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
		}).on('error', reject);
	});
}

const html = await get('/');
const model = await get('/model.json');
const modelJson = JSON.parse(model.body);
console.log('GET / ->', html.status, html.body.includes('Headless Preview') ? '(viewer html ok)' : '(BAD html)');
console.log('GET /model.json ->', model.status, '| elements:', modelJson.elements.length, '| textures:', modelJson.textures.length);

// SSE: connect, then make an edit and confirm a push arrives.
let pushed = 0;
await new Promise((resolve) => {
	const req = http.get(server.url.replace(/\/$/, '') + '/events', (res) => {
		res.on('data', (chunk) => {
			const str = chunk.toString();
			if (str.includes('data: update')) {
				pushed++;
				if (pushed === 2) { req.destroy(); resolve(); } // initial + post-edit
			}
		});
	});
	// give SSE a moment, then edit
	setTimeout(() => s.addCube({ name: 'block2', from: [0, 16, 0], to: [16, 24, 16] }), 200);
	setTimeout(resolve, 2000); // safety timeout
});

console.log('SSE pushes received:', pushed, '(expect >=2: initial + edit)');
const model2 = JSON.parse((await get('/model.json')).body);
console.log('after edit, elements:', model2.elements.length);

await server.stop();
const ok = html.status === 200 && html.body.includes('importmap') && modelJson.elements.length === 1 && pushed >= 2 && model2.elements.length === 2;
console.log('\n' + (ok ? 'OK: preview server works (serve + live push).' : 'FAIL'));
process.exit(ok ? 0 : 1);
