// Headless runtime shim. MUST be imported before ./lib/libs and anything else.
//
// Blockbench code uses bare globals everywhere (Project, Canvas, Settings, ...) and
// relies on the browser invariant `window === globalThis`. In node those differ, so we
// make node's globalThis BE the window: copy jsdom's DOM onto globalThis and point
// window/self back at it. Then globals.js's `window.X = X` exposes bare `X` as expected.
//
// Canvas backends: 2D -> @napi-rs/canvas (texture/painter), WebGL -> headless-gl ("gl")
// (created on demand for rendering in the render package). These + jsdom are marked
// `external` in build.js and required from node_modules at runtime.
import { JSDOM } from 'jsdom';
import { createCanvas, Image as NapiImage, ImageData as NapiImageData } from '@napi-rs/canvas';

const g = globalThis as any;

// Some globals are read-only in modern node (e.g. navigator). Force-define them.
function setGlobal(key: string, value: any) {
	try {
		g[key] = value;
		if (g[key] !== value) throw new Error('assignment ignored');
	} catch {
		Object.defineProperty(g, key, { value, writable: true, configurable: true, enumerable: true });
	}
}

const dom = new JSDOM(
	`<!DOCTYPE html><html><head></head><body><div id="page_wrapper"></div></body></html>`,
	{ pretendToBeVisual: true, url: 'http://localhost/' }
);
const jsdomWindow = dom.window as any;

// --- canvas backend: document.createElement('canvas') -> a napi 2D canvas ---
function makeCanvas(width = 300, height = 150): any {
	const canvas = createCanvas(width, height) as any;
	if (!canvas.style) canvas.style = {};
	if (!canvas.classList) canvas.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; }, replace() {} };
	if (!canvas.dataset) canvas.dataset = {};
	if (!canvas.addEventListener) canvas.addEventListener = () => {};
	if (!canvas.removeEventListener) canvas.removeEventListener = () => {};
	if (!canvas.dispatchEvent) canvas.dispatchEvent = () => false;
	if (!canvas.setAttribute) canvas.setAttribute = () => {};
	if (!canvas.getAttribute) canvas.getAttribute = () => null;
	if (!canvas.removeAttribute) canvas.removeAttribute = () => {};
	if (!canvas.append) canvas.append = () => {};
	if (!canvas.appendChild) canvas.appendChild = (c: any) => c;
	if (!canvas.remove) canvas.remove = () => {};
	if (!canvas.querySelector) canvas.querySelector = () => null;
	if (canvas.parentNode === undefined) canvas.parentNode = null;
	if (canvas.isConnected === undefined) canvas.isConnected = false;
	if (!canvas.getBoundingClientRect) {
		canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: canvas.width, height: canvas.height, right: canvas.width, bottom: canvas.height, x: 0, y: 0 });
	}
	// toBlob: GLTF/image exporters use it. napi canvas has toBuffer; wrap it in a blob-like
	// object FileReader (above) can read via arrayBuffer().
	if (!canvas.toBlob) {
		canvas.toBlob = (cb: any, type = 'image/png', quality?: number) => {
			let buf: Buffer;
			try { buf = canvas.toBuffer(type, quality); } catch { buf = canvas.toBuffer('image/png'); }
			cb({ type, size: buf.length, arrayBuffer: async () => buf, _buf: buf });
		};
	}
	return canvas;
}
const origCreateElement = jsdomWindow.document.createElement.bind(jsdomWindow.document);
jsdomWindow.document.createElement = function (tag: string, ...args: any[]) {
	if (typeof tag === 'string' && tag.toLowerCase() === 'canvas') return makeCanvas();
	return origCreateElement(tag, ...args);
};

// --- null-safe DOM: many interface modules wire events to elements at module-load.
// Those elements don't exist headlessly. Return a chainable no-op dummy instead of null
// so the modules load without DOM surgery. We never run the UI, so load-time is the only
// concern. (If a future code path branches on element existence at runtime, revisit.)
function makeDummyElement(): any {
	const noop = function () { return proxy; };
	const base: any = {
		nodeType: 1, tagName: 'DIV', nodeName: 'DIV',
		children: [], childNodes: [], attributes: [],
		firstChild: null, lastChild: null, parentNode: null, nextSibling: null,
		value: '', textContent: '', innerHTML: '', innerText: '', id: '', className: '',
		clientWidth: 0, clientHeight: 0, offsetWidth: 0, offsetHeight: 0, scrollWidth: 0, scrollHeight: 0, scrollTop: 0, scrollLeft: 0,
		classList: { add() {}, remove() {}, toggle() {}, contains() { return false; }, replace() {} },
		style: new Proxy({}, {
			get: (_t, p) => (p === 'setProperty' || p === 'getPropertyValue' || p === 'removeProperty' || p === 'item') ? (() => '') : '',
			set: () => true,
		}),
		dataset: {},
		getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }),
	};
	const proxy: any = new Proxy(noop, {
		get(_t, prop) {
			if (prop === Symbol.iterator) return function* () {};
			if (prop === Symbol.toPrimitive) return () => '';
			if (prop === 'length') return 0;
			if (prop in base) return base[prop];
			return proxy; // every method/property is chainable & callable
		},
		set() { return true; },
		apply() { return proxy; },
		has() { return true; },
	});
	return proxy;
}
const DUMMY = makeDummyElement();

const origGetElementById = jsdomWindow.document.getElementById.bind(jsdomWindow.document);
jsdomWindow.document.getElementById = (id: string) => origGetElementById(id) || DUMMY;
const origQuerySelector = jsdomWindow.document.querySelector.bind(jsdomWindow.document);
jsdomWindow.document.querySelector = (sel: string) => {
	try { return origQuerySelector(sel) || DUMMY; } catch { return DUMMY; }
};

// --- copy jsdom DOM surface onto node globalThis (which becomes `window`) ---
// Broad copy: pull every DOM global jsdom defines that node lacks (HTML*Element, Event,
// Blob, FileReader, ...). Constructors are copied UNBOUND so `new`/`instanceof` work.
// Skip node core (already present) and things we set explicitly below.
const DOM_DENYLIST = new Set([
	'window', 'self', 'top', 'parent', 'globalThis', 'global', 'frames', 'frameElement',
	'document', 'navigator', 'location', 'history', 'external', 'eval', 'Function',
	'Image', 'ImageData',
]);
for (const key of Object.getOwnPropertyNames(jsdomWindow)) {
	if (DOM_DENYLIST.has(key)) continue;
	if (key in g) continue; // never clobber node built-ins
	try {
		setGlobal(key, jsdomWindow[key]);
	} catch { /* getter-only / unsupported — ignore */ }
}
// these must be the real (unbound) values
setGlobal('document', jsdomWindow.document);
setGlobal('navigator', jsdomWindow.navigator);
setGlobal('location', jsdomWindow.location);
setGlobal('history', jsdomWindow.history);
setGlobal('getComputedStyle', jsdomWindow.getComputedStyle.bind(jsdomWindow));

// window-level event target: delegate to jsdom's window so DOM-ready etc. work
setGlobal('addEventListener', jsdomWindow.addEventListener.bind(jsdomWindow));
setGlobal('removeEventListener', jsdomWindow.removeEventListener.bind(jsdomWindow));
setGlobal('dispatchEvent', jsdomWindow.dispatchEvent.bind(jsdomWindow));

// make globalThis act as the window
setGlobal('window', g);
setGlobal('self', g);
setGlobal('top', g);
setGlobal('parent', g);

// imaging / canvas
// napi Image lacks DOM methods Blockbench's Texture poke at; patch the prototype.
const ImgProto: any = (NapiImage as any).prototype;
if (ImgProto) {
	if (!ImgProto.setAttribute) ImgProto.setAttribute = function () {};
	if (!ImgProto.removeAttribute) ImgProto.removeAttribute = function () {};
	if (!ImgProto.getAttribute) ImgProto.getAttribute = function () { return null; };
	if (!ImgProto.addEventListener) ImgProto.addEventListener = function (type: string, cb: any) {
		if (type === 'load') this.onload = cb; else if (type === 'error') this.onerror = cb;
	};
	if (!ImgProto.removeEventListener) ImgProto.removeEventListener = function () {};
	if (!ImgProto.classList) ImgProto.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
}
setGlobal('Image', NapiImage);
setGlobal('ImageData', NapiImageData);
setGlobal('createHeadlessCanvas', makeCanvas);

// animation frame (timer-driven; no vsync in node)
setGlobal('requestAnimationFrame', (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 16) as unknown as number);
setGlobal('cancelAnimationFrame', (id: any) => clearTimeout(id));

// localStorage: simple in-memory store
const ls_store = new Map<string, string>();
setGlobal('localStorage', {
	getItem: (k: string) => (ls_store.has(k) ? ls_store.get(k)! : null),
	setItem: (k: string, v: string) => void ls_store.set(k, String(v)),
	removeItem: (k: string) => void ls_store.delete(k),
	clear: () => ls_store.clear(),
	key: (i: number) => Array.from(ls_store.keys())[i] ?? null,
	get length() { return ls_store.size; },
});

// observer stubs (jsdom lacks ResizeObserver / IntersectionObserver)
class ObserverStub {
	constructor(_cb?: any) {}
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() { return []; }
}
if (!g.ResizeObserver) setGlobal('ResizeObserver', ObserverStub);
if (!g.IntersectionObserver) setGlobal('IntersectionObserver', ObserverStub);
if (!g.MutationObserver) setGlobal('MutationObserver', jsdomWindow.MutationObserver || ObserverStub);

// FileReader: jsdom's only accepts jsdom Blobs; the GLTF exporter feeds it napi-canvas blobs.
// Provide a tolerant reader that accepts anything with arrayBuffer()/Buffer/{data}.
class HeadlessFileReader {
	result: any = null;
	error: any = null;
	onload: any = null;
	onloadend: any = null;
	onerror: any = null;
	readyState = 0;
	async _read(blob: any, kind: string) {
		try {
			let buf: Buffer;
			if (blob && typeof blob.arrayBuffer === 'function') buf = Buffer.from(await blob.arrayBuffer());
			else if (Buffer.isBuffer(blob)) buf = blob;
			else if (blob instanceof Uint8Array) buf = Buffer.from(blob);
			else if (blob && blob.data) buf = Buffer.from(blob.data);
			else throw new Error('FileReader: unsupported blob');
			const type = (blob && blob.type) || 'application/octet-stream';
			if (kind === 'dataurl') this.result = `data:${type};base64,${buf.toString('base64')}`;
			else if (kind === 'arraybuffer') this.result = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
			else this.result = buf.toString('utf8');
			this.readyState = 2;
			this.onload?.({ target: this });
			this.onloadend?.({ target: this });
		} catch (e) {
			this.error = e;
			this.onerror?.({ target: this });
		}
	}
	readAsDataURL(b: any) { this._read(b, 'dataurl'); }
	readAsArrayBuffer(b: any) { this._read(b, 'arraybuffer'); }
	readAsText(b: any) { this._read(b, 'text'); }
	addEventListener(type: string, cb: any) { (this as any)['on' + type] = cb; }
	removeEventListener(type: string) { (this as any)['on' + type] = null; }
}
setGlobal('FileReader', HeadlessFileReader);

// misc shims some modules reach for
if (typeof g.matchMedia !== 'function') {
	setGlobal('matchMedia', () => ({ matches: false, media: '', onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } }));
}
if (typeof g.fetch !== 'function') {
	setGlobal('fetch', async () => { throw new Error('fetch is not available in headless mode'); });
}

export { dom };
export const window = g;
