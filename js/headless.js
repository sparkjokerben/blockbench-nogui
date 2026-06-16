// Platform layer for headless mode (counterpart to desktop.js / web.js).
// The build resolves `./desktop` imports to this file when --target=headless.
// Everything here is a no-op/null: lifecycle, recent projects, OS image editors,
// and backups are driven by the SDK in headless mode, not by this layer.

const NULL = null;

// Match the export surface of desktop.js so existing imports resolve.
export {
	NULL as recent_projects,
	NULL as initializeDesktopApp,
	NULL as loadOpenWithBlockbenchFile,
	NULL as updateRecentProjects,
	NULL as addRecentProject,
	NULL as updateRecentProjectData,
	NULL as updateRecentProjectThumbnail,
	NULL as loadDataFromModelMemory,
	NULL as changeImageEditor,
	NULL as isImageEditorValid,
	NULL as openDefaultTexturePath,
	NULL as findExistingFile,
	NULL as createBackup,
};

export function initializeWebApp() {}
export async function loadInfoFromURL() {}

Object.assign(window, {
	initializeWebApp,
	loadInfoFromURL,
});
