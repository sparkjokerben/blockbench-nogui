// Phase 6 verification: worker pool parallelism + isolation + swappable scheduler.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WorkerPool, FixedScheduler, AgentScheduler } from '../../sdk/worker-pool/pool.mjs';

const outDir = dirname(fileURLToPath(import.meta.url));

async function buildAndRender(handle, color, n) {
	await handle.setResolution(16, 16);
	const cube = await handle.addCube({ name: `c${n}`, from: [0, 0, 0], to: [16, 16, 16] });
	const tex = await handle.addTexture({ name: `t${n}`, width: 16, height: 16, fill: color });
	await handle.applyTexture(cube.uuid, tex.uuid);
	const bb = await handle.exportProject();
	const png = await handle.render({ angle: 'isometric', width: 200, height: 200 });
	return { workerId: handle.workerId, sessionId: handle.id, elements: JSON.parse(bb).elements.length, png };
}

console.log('=== Phase A: FixedScheduler, 2 workers x 2 sessions ===');
const t0 = Date.now();
const pool = new WorkerPool({ maxWorkers: 2, maxSessionsPerWorker: 2, scheduler: new FixedScheduler() });
const colors = ['#c0392b', '#27ae60', '#2980b9', '#f39c12'];
const handles = [];
for (let i = 0; i < 4; i++) handles.push(await pool.createSession('java_block', { name: 'p' + i }));

// run all 4 builds+renders in parallel
const results = await Promise.all(handles.map((h, i) => buildAndRender(h, colors[i], i)));
const dt = Date.now() - t0;

const workerSpread = {};
results.forEach((r) => { workerSpread[r.workerId] = (workerSpread[r.workerId] || 0) + 1; });
console.log('worker spread (sessions per worker):', JSON.stringify(workerSpread));
console.log('pool stats:', JSON.stringify(pool.stats.workers));
results.forEach((r, i) => console.log(`  session ${i}: worker=${r.workerId} elements=${r.elements} png=${r.png.length}b`));
writeFileSync(join(outDir, 'pool-0.png'), results[0].png);
console.log('wrote pool-0.png; total parallel time:', dt + 'ms');

const renderOk = results.every((r) => r.png.length > 500 && r.elements === 1);
const spreadOk = Object.keys(workerSpread).length === 2; // both workers used

await pool.shutdown();

console.log('\n=== Phase B: AgentScheduler (same interface) ===');
// an "agent" that decides placement; here: always spawn until maxWorkers, then round-robin
let rr = 0;
const decide = async (state) => {
	if (state.workers.length < state.maxWorkers) return { workerId: null, spawn: true };
	const w = state.workers[rr++ % state.workers.length];
	return { workerId: w.id, spawn: false };
};
const pool2 = new WorkerPool({ maxWorkers: 3, maxSessionsPerWorker: 10, scheduler: new AgentScheduler(decide) });
const h2 = [];
for (let i = 0; i < 5; i++) h2.push(await pool2.createSession('free', { name: 'a' + i }));
const spread2 = {};
h2.forEach((h) => { spread2[h.workerId] = (spread2[h.workerId] || 0) + 1; });
console.log('agent-scheduled worker spread:', JSON.stringify(spread2));
const agentOk = Object.keys(spread2).length === 3; // spawned 3 workers as the agent decided
await pool2.shutdown();

console.log('\n' + (renderOk && spreadOk && agentOk
	? 'OK: pool parallel render/export, isolation, and A→B scheduler swap all work.'
	: `FAIL (render=${renderOk} spread=${spreadOk} agent=${agentOk})`));
process.exit(renderOk && spreadOk && agentOk ? 0 : 1);
