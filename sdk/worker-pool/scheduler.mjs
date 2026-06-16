// Swappable scheduler. The pool calls scheduler.allocate(state, request) to decide which
// worker a new session lands on (reuse an existing worker or spawn a new one). Phase-A is a
// deterministic fixed-logic impl; Phase-B is an agent-backed impl with the SAME interface,
// so the pool code never changes when you swap strategies.

/**
 * @typedef {{ id:number, sessionCount:number }} WorkerState
 * @typedef {{ workers: WorkerState[], maxWorkers:number, maxSessionsPerWorker:number }} PoolState
 * @typedef {{ format:string, hint?:any }} AllocRequest
 * @typedef {{ workerId:number|null, spawn:boolean }} AllocResult   // workerId null + spawn:true => create new
 */

export class Scheduler {
	/** @returns {Promise<AllocResult>|AllocResult} */
	allocate(_state, _request) {
		throw new Error('Scheduler.allocate not implemented');
	}
}

/**
 * Phase A — fixed logic: fill existing workers up to capacity (least-loaded first); spawn a
 * new worker when all are at capacity and we're under maxWorkers; otherwise pile onto the
 * least-loaded worker. Predictable and easy to test.
 */
export class FixedScheduler extends Scheduler {
	allocate(state, _request) {
		const { workers, maxWorkers, maxSessionsPerWorker } = state;
		const withCapacity = workers
			.filter((w) => w.sessionCount < maxSessionsPerWorker)
			.sort((a, b) => a.sessionCount - b.sessionCount);
		if (withCapacity.length) return { workerId: withCapacity[0].id, spawn: false };
		if (workers.length < maxWorkers) return { workerId: null, spawn: true };
		// over capacity everywhere: least-loaded overflow
		const leastLoaded = [...workers].sort((a, b) => a.sessionCount - b.sessionCount)[0];
		return { workerId: leastLoaded ? leastLoaded.id : null, spawn: workers.length === 0 };
	}
}

/**
 * Phase B — agent-backed: delegates the placement decision to a user-supplied async function
 * (which could call an LLM / management agent). Falls back to FixedScheduler on error or if
 * the decision is invalid. Same interface as FixedScheduler, so the pool is unchanged.
 */
export class AgentScheduler extends Scheduler {
	/** @param {(state:PoolState, request:AllocRequest)=>Promise<AllocResult>} decide */
	constructor(decide, { fallback = new FixedScheduler() } = {}) {
		super();
		this.decide = decide;
		this.fallback = fallback;
	}
	async allocate(state, request) {
		try {
			const result = await this.decide(state, request);
			if (result && (result.spawn || state.workers.some((w) => w.id === result.workerId))) {
				return result;
			}
		} catch (err) {
			// fall through to deterministic placement
			console.warn('[AgentScheduler] decide() failed, falling back:', err?.message);
		}
		return this.fallback.allocate(state, request);
	}
}
