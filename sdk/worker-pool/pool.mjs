// WorkerPool: true parallelism across worker_threads. The pool holds many workers; each
// worker hosts many sessions. A swappable Scheduler decides placement (reuse vs spawn).
// Session operations are routed to the owning worker by affinity. Render/export run in
// parallel across workers, fully isolated.
import { fork } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FixedScheduler } from './scheduler.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, 'worker.mjs');

let _msgSeq = 0;

class WorkerHandle {
	constructor(id, child) {
		this.id = id;
		this.child = child;
		this.sessionCount = 0;
		this.pending = new Map();
		this.ready = new Promise((res) => (this._readyResolve = res));
		child.on('message', (msg) => {
			if (msg.ready) { this._readyResolve(); return; }
			const p = this.pending.get(msg.id);
			if (!p) return;
			this.pending.delete(msg.id);
			if (msg.ok) p.resolve(msg.isBuffer ? Buffer.from(msg.result) : msg.result);
			else p.reject(new Error(msg.error));
		});
		const fail = (err) => {
			for (const p of this.pending.values()) p.reject(err instanceof Error ? err : new Error('worker exited: ' + err));
			this.pending.clear();
		};
		child.on('error', fail);
		child.on('exit', (code) => { if (code) fail('exit code ' + code); });
	}
	send(message) {
		const id = ++_msgSeq;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.child.send({ ...message, id });
		});
	}
}

export class WorkerPool {
	constructor({ maxWorkers = Math.max(1, cpus().length - 1), maxSessionsPerWorker = 8, scheduler } = {}) {
		this.maxWorkers = maxWorkers;
		this.maxSessionsPerWorker = maxSessionsPerWorker;
		this.scheduler = scheduler || new FixedScheduler();
		this.workers = new Map(); // workerId -> WorkerHandle
		this._nextWorkerId = 0;
	}

	get stats() {
		return {
			workers: [...this.workers.values()].map((w) => ({ id: w.id, sessionCount: w.sessionCount })),
			maxWorkers: this.maxWorkers,
			maxSessionsPerWorker: this.maxSessionsPerWorker,
		};
	}

	_spawn() {
		const id = this._nextWorkerId++;
		// 'advanced' serialization lets IPC carry Buffers/TypedArrays (render PNGs) natively.
		const child = fork(WORKER_PATH, [String(id)], { serialization: 'advanced' });
		const handle = new WorkerHandle(id, child);
		this.workers.set(id, handle);
		return handle;
	}

	/** Create a session; the scheduler picks/ spawns its worker. Returns a SessionHandle. */
	async createSession(format = 'free', opts = {}) {
		const decision = await this.scheduler.allocate(this.stats, { format, hint: opts.hint });
		let handle;
		if (decision.spawn || decision.workerId == null) handle = this._spawn();
		else handle = this.workers.get(decision.workerId) || this._spawn();
		await handle.ready;
		const sessionId = await handle.send({ type: 'create', format, opts });
		handle.sessionCount++;
		return new SessionHandle(this, handle, sessionId);
	}

	async shutdown() {
		for (const h of this.workers.values()) h.child.kill();
		this.workers.clear();
	}
}

/** Main-thread proxy for a session living in a worker. Methods return Promises. */
class SessionHandle {
	constructor(pool, workerHandle, id) {
		this.pool = pool;
		this._w = workerHandle;
		this.id = id;
		this.workerId = workerHandle.id;
	}
	exec(op, ...args) { return this._w.send({ type: 'exec', sessionId: this.id, op, args }); }

	setResolution(w, h) { return this.exec('setResolution', w, h); }
	addCube(data, opts) { return this.exec('addCube', data, opts); }
	addGroup(data, opts) { return this.exec('addGroup', data, opts); }
	addTexture(opts) { return this.exec('addTexture', opts); }
	applyTexture(elementId, textureId, opts) { return this.exec('applyTexture', elementId, textureId, opts); }
	/** commands: [{op:'fillRect',x,y,w,h,color}|{op:'fillPixel',x,y,color}|{op:'line',...}] */
	paint(textureId, commands) { return this.exec('paint', textureId, commands); }
	loadProject(model, path) { return this.exec('loadProject', model, path); }
	exportProject() { return this.exec('exportProject'); }
	export(codec, opts) { return this.exec('export', codec, opts); }
	snapshot() { return this.exec('snapshot'); }
	listElements() { return this.exec('listElements'); }
	undo() { return this.exec('undo'); }
	redo() { return this.exec('redo'); }
	/** Returns a PNG Buffer. */
	render(opts) { return this.exec('render', opts); }
	async close() {
		await this._w.send({ type: 'close', sessionId: this.id });
		this._w.sessionCount = Math.max(0, this._w.sessionCount - 1);
	}
}

export { FixedScheduler, AgentScheduler, Scheduler } from './scheduler.mjs';
