// Loads the headless Blockbench bundle once and exposes the global handle.
// The bundle attaches everything to globalThis (window === globalThis in headless runtime).
import '../../dist/headless.js';

/** The Blockbench global namespace (globalThis after the bundle self-exposes). */
export const BB = globalThis;

if (!BB.Blockbench || BB.Blockbench.setup_successful !== true) {
	throw new Error('Headless Blockbench failed to boot. Rebuild with: node ./build.js --target=headless');
}

/** Resolve a format by id or pass through a ModelFormat. Defaults to `free`. */
export function resolveFormat(format) {
	if (!format) return BB.Formats.free;
	if (typeof format === 'string') return BB.Formats[format] ?? BB.Formats.free;
	return format;
}
