// Phase 2 verification: multiple sessions in one process stay isolated.
import { createSession, listSessions } from '../../sdk/session.mjs';

// Create 3 sessions with different content, interleaving operations.
const a = createSession('free', { name: 'A' });
const b = createSession('free', { name: 'B' });
const c = createSession('bedrock', { name: 'C' });

// Interleave edits across sessions to exercise active-state switching.
a.addCube({ name: 'a_cube', from: [0, 0, 0], to: [2, 2, 2] });
b.addCube({ name: 'b_cube1', from: [0, 0, 0], to: [4, 4, 4] });
c.addCube({ name: 'c_cube', from: [0, 0, 0], to: [8, 8, 8] });
b.addCube({ name: 'b_cube2', from: [4, 0, 0], to: [8, 4, 4] });
a.addCube({ name: 'a_cube2', from: [2, 0, 0], to: [4, 2, 2] });

console.log('live sessions:', listSessions().length);
console.log('A elements:', a.elements.map(e => e.name).join(', '));
console.log('B elements:', b.elements.map(e => e.name).join(', '));
console.log('C elements:', c.elements.map(e => e.name).join(', '));

// Export each and check isolation.
const ea = JSON.parse(a.exportProject());
const eb = JSON.parse(b.exportProject());
const ec = JSON.parse(c.exportProject());

console.log('\nexported element counts -> A:', ea.elements.length, 'B:', eb.elements.length, 'C:', ec.elements.length);
console.log('A format:', ea.meta.model_format, '| C format:', ec.meta.model_format);

// Undo test on B only.
b.undo();
console.log('after B.undo, B elements:', b.elements.length, '(A still', a.elements.length + ')');

const ok =
	ea.elements.length === 2 &&
	eb.elements.length === 2 &&            // before undo snapshot
	ec.elements.length === 1 &&
	ea.elements.every(e => e.name.startsWith('a_')) &&
	ec.meta.model_format === 'bedrock' &&
	b.elements.length === 1 &&             // after undo
	a.elements.length === 2;               // A unaffected by B.undo

console.log('\n' + (ok ? 'OK: sessions are isolated.' : 'FAIL: cross-contamination detected.'));
process.exit(ok ? 0 : 1);
