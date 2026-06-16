// Live browser preview. Starts a tiny HTTP server that serves a three.js viewer (browser
// WebGL2) which builds the model from the session's bbmodel snapshot and hot-reloads over
// SSE whenever the session is edited. No glTF / no server-side rendering — the browser does
// the 3D, so orbit + animation playback are fully interactive.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BB } from './internal/bb.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER_HTML = readFileSync(join(__dirname, 'preview', 'viewer.html'), 'utf8');

const EDIT_EVENTS = [
	'finished_edit', 'finish_edit', 'edit_texture', 'add_texture', 'update_texture',
	'construct_model', 'update_selection', 'select_project', 'new_project',
];

export class PreviewServer {
	constructor(session, { port = 0, host = '127.0.0.1' } = {}) {
		this.session = session;
		this.host = host;
		this._port = port;
		this.clients = new Set();
		this._debounce = null;
		this._boundBroadcast = () => this._scheduleBroadcast();
		this.server = http.createServer((req, res) => this._handle(req, res));
	}

	start() {
		return new Promise((resolve) => {
			this.server.listen(this._port, this.host, () => {
				this.port = this.server.address().port;
				this.url = `http://${this.host}:${this.port}/`;
				for (const ev of EDIT_EVENTS) BB.Blockbench.on(ev, this._boundBroadcast);
				resolve(this);
			});
		});
	}

	_handle(req, res) {
		const url = new URL(req.url, this.url || 'http://localhost/');
		if (url.pathname === '/') {
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end(VIEWER_HTML);
		} else if (url.pathname === '/model.json') {
			let snapshot;
			try { snapshot = this.session.snapshot(); } catch (e) { snapshot = { error: e.message }; }
			res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
			res.end(JSON.stringify(snapshot));
		} else if (url.pathname === '/events') {
			res.writeHead(200, {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			});
			res.write('retry: 1000\n\n');
			res.write('data: update\n\n');
			this.clients.add(res);
			req.on('close', () => this.clients.delete(res));
		} else {
			res.writeHead(404);
			res.end('not found');
		}
	}

	_scheduleBroadcast() {
		// only react to edits on this session's project
		if (BB.Project !== this.session.project) return;
		clearTimeout(this._debounce);
		this._debounce = setTimeout(() => this.broadcast(), 80);
	}

	/** Force-push an update to connected viewers. */
	broadcast() {
		for (const res of this.clients) {
			try { res.write('data: update\n\n'); } catch { this.clients.delete(res); }
		}
	}

	stop() {
		for (const ev of EDIT_EVENTS) BB.Blockbench.removeListener?.(ev, this._boundBroadcast);
		for (const res of this.clients) { try { res.end(); } catch {} }
		this.clients.clear();
		return new Promise((resolve) => this.server.close(resolve));
	}
}

export async function openPreview(session, opts) {
	const server = new PreviewServer(session, opts);
	await server.start();
	return server;
}
