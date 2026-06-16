// Minimal headless boot — replaces boot_loader.js (which builds the full DOM/WebGL UI).
// Sets up just enough of the 3D scene + materials + UI stubs so the data layer
// (ModelProject / ModelFormat / Mode / Outliner) works in pure node. The DOM/WebGL Preview
// stack (initCanvas) is intentionally NOT built; the render package (Phase 4) creates an
// offscreen renderer on demand.
import { Blockbench } from "../api";

const g = globalThis as any;
const THREE = g.THREE;
const Canvas = g.Canvas;

// `deepDummy` absorbs arbitrary chained reads/writes/calls — used for Vue panels and gizmos
// that the DOM boot would create (e.g. Panels.animations.inside_vue.$data.x = y).
function deepDummy(): any {
	const fn = function () { return proxy; };
	const proxy: any = new Proxy(fn, {
		get(_t, prop) {
			if (prop === Symbol.toPrimitive) return () => '';
			if (prop === Symbol.iterator) return function* () {};
			return proxy;
		},
		set() { return true; },
		apply() { return proxy; },
		has() { return true; },
	});
	return proxy;
}

// --- 3D scene + materials (pure THREE; shaders compile lazily at first GL render) ---
if (Canvas && THREE) {
	if (!Canvas.scene) {
		const scene = new THREE.Scene();
		scene.name = 'scene';
		g.scene = scene;
		Canvas.scene = scene;

		Canvas.outlines = new THREE.Object3D();
		Canvas.outlines.name = 'outline_group';
		scene.add(Canvas.outlines);
		if (Array.isArray(Canvas.gizmos)) Canvas.gizmos.push(Canvas.outlines);
	}
	try {
		Canvas.setup(); // lights + grid/north materials + emptyMaterials (no DOM)
	} catch (err) {
		console.warn('[headless] Canvas.setup failed:', (err as Error).message);
		try { Canvas.updateMarkerColorMaterials(); } catch {}
	}
}

// --- gizmo + UI singleton stubs (built by initCanvas / Vue boot, which we skip) ---
if (typeof g.Transformer === 'undefined' || !g.Transformer) g.Transformer = deepDummy();
if (typeof g.SplineGizmos === 'undefined' || !g.SplineGizmos) g.SplineGizmos = deepDummy();
// No real Preview headlessly (Phase 4 swaps in an offscreen one). Stub so camera/preset
// calls in newProject and elsewhere no-op.
if (g.Preview && !g.Preview.selected) g.Preview.selected = deepDummy();

const Interface = (g.Interface = g.Interface || {});
// DOM anchors boot_loader wires; getElementById returns the null-safe DUMMY (with .style etc.)
Interface.page_wrapper = document.getElementById('page_wrapper');
Interface.work_screen = document.getElementById('work_screen');
Interface.center_screen = document.getElementById('center');
Interface.right_bar = document.getElementById('right_bar');
Interface.left_bar = document.getElementById('left_bar');
Interface.preview = document.getElementById('preview');
if (!Interface.tab_bar) {
	Interface.tab_bar = { $data: { new_tab: { visible: false } }, new_tab: { visible: false, close() {} } };
}
const PanelsDummy = deepDummy();
g.Panels = PanelsDummy;
Interface.Panels = PanelsDummy;
if (!Interface.status_bar) Interface.status_bar = {};
if (!Interface.status_bar.vue) Interface.status_bar.vue = deepDummy();
// Methods normally assigned in setupInterface() (which we skip).
if (typeof Interface.addSuggestedModifierKey !== 'function') Interface.addSuggestedModifierKey = () => {};
if (typeof Interface.removeSuggestedModifierKey !== 'function') Interface.removeSuggestedModifierKey = () => {};

if (g.UVEditor && !g.UVEditor.panel) g.UVEditor.panel = { inside_vue: deepDummy() };
if (g.ColorPanel && !g.ColorPanel.panel) g.ColorPanel.panel = { vue: deepDummy() };
// Many singletons expose a `.vue` Vue instance wired during the DOM boot. Stub them.
for (const name of ['Outliner', 'Toolbox', 'Animator', 'Timeline', 'Modes', 'Settings', 'Interface']) {
	const o = g[name];
	if (o && typeof o === 'object' && !o.vue) {
		try { o.vue = deepDummy(); } catch { /* getter-only */ }
	}
}

// --- build actions + toolbars so derived globals (Toolbox, BarItems, tools) exist ---
try { g.BARS?.setupActions?.(); } catch (err) { console.warn('[headless] setupActions:', (err as Error).message); }
try { g.BARS?.setupToolbars?.(); } catch (err) { console.warn('[headless] setupToolbars:', (err as Error).message); }

Blockbench.setup_successful = true;
try { Blockbench.dispatchEvent('headless_ready', {}); } catch {}

export {};
