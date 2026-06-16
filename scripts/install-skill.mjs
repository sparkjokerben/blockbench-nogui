#!/usr/bin/env node
/**
 * Install the blockbench-headless Claude Code skill globally so it
 * auto-loads in any project that uses this package.
 *
 * Usage:
 *   node scripts/install-skill.mjs
 *   npm run install-skill
 */
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = join(__dirname, '..', '.claude', 'skills', 'blockbench-headless', 'SKILL.md');
const dest = join(homedir(), '.claude', 'skills', 'blockbench-headless', 'SKILL.md');
const destDir = dirname(dest);

if (!existsSync(src)) {
	console.error(`Source not found: ${src}`);
	process.exit(1);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`blockbench-headless skill installed → ${dest}`);
console.log('It will auto-load in any Claude Code session when you work with 3D models or textures.');
