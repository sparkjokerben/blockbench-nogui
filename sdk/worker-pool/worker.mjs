// Worker process (child_process.fork): runs the full headless SDK and hosts many sessions.
// We use a child PROCESS rather than a worker_thread because headless-gl ("gl") is a native
// addon that is not safe to instantiate across multiple worker threads in one process — the
// 2nd GL context hangs. Separate processes each get their own native GL. The main thread
// routes each session's operations here by sessionId (affinity). Ops are command-based so all
// args/results cross the IPC boundary as plain data (no functions/object handles).
import { createSession } from '../session.mjs';
import { renderSession } from '../render.mjs';

const WORKER_ID = Number(process.argv[2] ?? 0);
const sessions = new Map(); // sessionId -> Session

const findTex = (s, id) => s.textures.find((t) => t.uuid === id);
const resolveOpts = (s, opts = {}) => {
	const out = { ...opts };
	if (opts.group) out.group = s.groups.find((g) => g.uuid === opts.group);
	if (opts.parent) out.parent = s.groups.find((g) => g.uuid === opts.parent);
	return out;
};

function runPaint(session, texture, commands) {
	session.paint(texture, (ctx) => {
		for (const c of commands) {
			switch (c.op) {
				case 'fillRect': ctx.fillStyle = c.color; ctx.fillRect(c.x, c.y, c.w, c.h); break;
				case 'clearRect': ctx.clearRect(c.x, c.y, c.w, c.h); break;
				case 'fillPixel': ctx.fillStyle = c.color; ctx.fillRect(c.x | 0, c.y | 0, 1, 1); break;
				case 'line':
					ctx.strokeStyle = c.color; ctx.lineWidth = c.width || 1;
					ctx.beginPath(); ctx.moveTo(c.x1, c.y1); ctx.lineTo(c.x2, c.y2); ctx.stroke(); break;
				default: break;
			}
		}
	});
}

const ops = {
	setResolution: (s, [w, h]) => { s.setResolution(w, h); return true; },
	addCube: (s, [data, opts]) => { const c = s.addCube(data, resolveOpts(s, opts)); return { uuid: c.uuid, name: c.name }; },
	addGroup: (s, [data, opts]) => { const g = s.addGroup(data, resolveOpts(s, opts)); return { uuid: g.uuid, name: g.name }; },
	addTexture: (s, [opts]) => { const t = s.addTexture(opts); return { uuid: t.uuid, name: t.name }; },
	applyTexture: (s, [elementId, textureId, opts]) => { s.applyTexture(s.getElement(elementId), findTex(s, textureId), opts || {}); return true; },
	paint: (s, [textureId, commands]) => { runPaint(s, findTex(s, textureId), commands); return true; },
	loadProject: (s, [model, path]) => { s.loadProject(model, path); return true; },
	exportProject: (s) => s.exportProject(),
	export: (s, [codec, opts]) => s.export(codec, opts),
	snapshot: (s) => s.snapshot(),
	listElements: (s) => s.elements.map((e) => ({ uuid: e.uuid, name: e.name })),
	undo: (s) => { s.undo(); return true; },
	redo: (s) => { s.redo(); return true; },
	render: (s, [opts]) => renderSession(s, opts), // returns a Buffer
};

process.on('message', async (msg) => {
	const { id, type } = msg;
	try {
		if (type === 'create') {
			const session = createSession(msg.format, msg.opts);
			sessions.set(session.id, session);
			reply(id, session.id);
		} else if (type === 'exec') {
			const session = sessions.get(msg.sessionId);
			if (!session) throw new Error(`Unknown session ${msg.sessionId} on worker ${WORKER_ID}`);
			const op = ops[msg.op];
			if (!op) throw new Error(`Unknown op ${msg.op}`);
			const result = await op(session, msg.args || []);
			reply(id, result);
		} else if (type === 'close') {
			const session = sessions.get(msg.sessionId);
			session?.close();
			sessions.delete(msg.sessionId);
			reply(id, true);
		} else if (type === 'stats') {
			reply(id, { workerId: WORKER_ID, sessionCount: sessions.size });
		} else {
			throw new Error(`Unknown message type ${type}`);
		}
	} catch (err) {
		process.send({ id, ok: false, error: err?.message || String(err) });
	}
});

function reply(id, result) {
	// child_process IPC with 'advanced' serialization transfers Buffers natively
	if (Buffer.isBuffer(result)) {
		process.send({ id, ok: true, result, isBuffer: true });
	} else {
		process.send({ id, ok: true, result });
	}
}

process.send({ ready: true, workerId: WORKER_ID });
