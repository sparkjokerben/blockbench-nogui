// Native APIs for headless (pure node) mode.
// Unlike the web stub, headless runs in real node, so expose real fs/path/zlib/etc.
// Electron-only surfaces (clipboard, shell, ipc, dialog, windows) are nulled or no-op'd.
import * as fsModule from 'node:fs';
import * as PathModuleNS from 'node:path';
import * as osModule from 'node:os';
import * as zlibModule from 'node:zlib';
import * as httpsModule from 'node:https';
import * as childProcessModule from 'node:child_process';
import { createRequire } from 'node:module';

const NULL = null;

const fs = fsModule as any;
const PathModule = PathModuleNS as any;
const os = osModule as any;
const zlib = zlibModule as any;
const https = httpsModule as any;
const child_process = childProcessModule as any;
const NodeBuffer = Buffer as any;
const proc = process as any;

// no-op ipc so modules that send/listen don't crash
const ipcRenderer = {
	send() {},
	on() {},
	once() {},
	removeListener() {},
	removeAllListeners() {},
	invoke: async () => null,
	sendSync: () => null,
};

/** @internal */
export {
	NULL as electron,
	NULL as clipboard,
	NULL as shell,
	NULL as nativeImage,
	ipcRenderer,
	NULL as webUtils,
	NULL as app,
	fs,
	NodeBuffer,
	zlib,
	child_process,
	https,
	PathModule,
	os,
	NULL as currentwindow,
	NULL as dialog,
	proc as process,
};

export const SystemInfo = {
	arch: process.arch,
	platform: process.platform,
	node: process.versions.node,
};

export function getPluginScopedRequire() {
	// In headless we trust the host; hand back a plain require.
	return createRequire(import.meta.url);
}

export function revokePluginPermissions(): string[] {
	return [];
}

export function exposeNativeApisInDevTools() {}

export function openFileInEditor() {}

export function openDevTools() {}

export function getPCUsername() {
	try {
		return os.userInfo().username || '';
	} catch {
		return '';
	}
}

// @ts-ignore
window.SystemInfo = SystemInfo;
