/**
 * MCP server for blockbench-headless SDK.
 *
 * Tools:
 *   run_script     — execute JS/TS code with SDK access; output files returned automatically
 *   check_setup    — verify engine bundle exists and env is ready
 *   build_engine   — rebuild dist/headless.js after js/ edits
 *   list_files     — list a directory
 *   read_file      — read any file (text or base64 for binary)
 *
 * Transports:
 *   stdio (default)  — set as MCP server in Claude Code / Cowork settings
 *   HTTP/SSE         — set BB_MCP_PORT=7821 to expose over HTTP for remote clients
 *
 * The script runner always executes from ENGINE_DIR so "blockbench-headless"
 * resolves via npm link, and BB_OUTPUT_DIR is injected as an env var so
 * scripts can write files and have them returned in the tool response.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import {
  writeFileSync, readFileSync, mkdirSync, existsSync,
  readdirSync, statSync, rmSync,
} from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = '/Users/jokerben/Documents/WorkSpace/blockbench-nogui';
const ENGINE_BUNDLE = join(ENGINE_DIR, 'dist', 'headless.js');

// File types that must be returned as base64
const BINARY_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.glb', '.zip']);
const isBinary = (p) => BINARY_EXTS.has(extname(p).toLowerCase());

function collectFiles(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...collectFiles(full, base));
    else out.push({ abs: full, rel: full.slice(base.length + 1) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Script runner
// ---------------------------------------------------------------------------
async function runScript(code, language, timeoutMs) {
  const id = randomUUID().slice(0, 8);
  const workDir = join(tmpdir(), `bb-mcp-${id}`);
  const outDir = join(workDir, 'out');
  mkdirSync(outDir, { recursive: true });

  const isTs = language === 'ts';
  const scriptPath = join(workDir, isTs ? 'script.ts' : 'script.mjs');
  writeFileSync(scriptPath, code, 'utf8');

  // TypeScript: Node 22+ --experimental-strip-types (no extra deps)
  // JavaScript: plain node
  const nodeArgs = isTs
    ? ['--experimental-strip-types', '--no-warnings=ExperimentalWarning', scriptPath]
    : [scriptPath];

  let stdout = '', stderr = '', exitCode = 0;
  try {
    stdout = execFileSync(process.execPath, nodeArgs, {
      cwd: ENGINE_DIR,
      env: { ...process.env, BB_OUTPUT_DIR: outDir },
      timeout: timeoutMs,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (err) {
    stdout = err.stdout || '';
    stderr = err.stderr || err.message || '';
    exitCode = err.status || 1;
    if (err.code === 'ETIMEDOUT') stderr += `\n[MCP] timed out after ${timeoutMs}ms`;
  }

  const files = collectFiles(outDir).map(({ abs, rel }) => {
    const buf = readFileSync(abs);
    return {
      name: rel,
      size: buf.length,
      encoding: isBinary(abs) ? 'base64' : 'utf8',
      content: isBinary(abs) ? buf.toString('base64') : buf.toString('utf8'),
    };
  });

  try { rmSync(workDir, { recursive: true, force: true }); } catch {}
  return { stdout, stderr, exitCode, files };
}

// ---------------------------------------------------------------------------
// MCP server factory
// ---------------------------------------------------------------------------
function makeMcpServer() {
  const srv = new Server(
    { name: 'blockbench-headless', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  srv.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'run_script',
        description:
          'Execute a JS (.mjs) or TypeScript (.ts) script that uses the blockbench-headless SDK. ' +
          'Import from "blockbench-headless". ' +
          'Write output files to process.env.BB_OUTPUT_DIR — they are returned automatically in the response. ' +
          'Stdout/stderr and exit code are also returned.',
        inputSchema: {
          type: 'object',
          required: ['code'],
          properties: {
            code: { type: 'string', description: 'Source code to execute' },
            language: {
              type: 'string', enum: ['mjs', 'ts'], default: 'mjs',
              description: 'mjs = plain ESM JS (default), ts = TypeScript via Node --experimental-strip-types',
            },
            timeout_ms: { type: 'number', default: 60000, description: 'Execution timeout in ms' },
          },
        },
      },
      {
        name: 'check_setup',
        description:
          'Check if the blockbench-headless engine bundle (dist/headless.js) exists and is ready. ' +
          'Call this before the first run_script of a session.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'build_engine',
        description:
          'Rebuild dist/headless.js from source. Only needed after editing files under js/ in the engine directory. Takes ~15-30s.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'list_files',
        description: 'List files and subdirectories at a given path on the local machine.',
        inputSchema: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', description: 'Absolute directory path' },
          },
        },
      },
      {
        name: 'read_file',
        description:
          'Read a file. Text files (.mjs, .json, .bbmodel, etc.) returned as UTF-8 string. ' +
          'Binary files (.png, .glb, etc.) returned as base64.',
        inputSchema: {
          type: 'object',
          required: ['path'],
          properties: {
            path: { type: 'string', description: 'Absolute file path' },
          },
        },
      },
    ],
  }));

  srv.setRequestHandler(CallToolRequestSchema, async ({ params: { name, arguments: a } }) => {
    try {
      // ---- check_setup ----
      if (name === 'check_setup') {
        const bundleOk = existsSync(ENGINE_BUNDLE);
        const info = bundleOk ? statSync(ENGINE_BUNDLE) : null;
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              engine_dir: ENGINE_DIR,
              bundle: bundleOk
                ? `OK (${Math.round(info.size / 1024)} KB, ${info.mtime.toISOString()})`
                : 'MISSING — call build_engine first',
              node_version: process.version,
              ts_support: '--experimental-strip-types (Node 22+)',
            }, null, 2),
          }],
        };
      }

      // ---- build_engine ----
      if (name === 'build_engine') {
        try {
          const out = execFileSync(
            process.execPath, ['./build.js', '--target=headless'],
            { cwd: ENGINE_DIR, encoding: 'utf8', timeout: 120000, maxBuffer: 5e6 },
          );
          return { content: [{ type: 'text', text: `Build succeeded.\n${out}` }] };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Build failed:\n${err.stderr || ''}\n${err.stdout || ''}` }],
            isError: true,
          };
        }
      }

      // ---- run_script ----
      if (name === 'run_script') {
        const result = await runScript(a.code, a.language ?? 'mjs', a.timeout_ms ?? 60000);
        const parts = [`exit: ${result.exitCode}`];
        if (result.stdout) parts.push(`\n--- stdout ---\n${result.stdout.trimEnd()}`);
        if (result.stderr) parts.push(`\n--- stderr ---\n${result.stderr.trimEnd()}`);
        for (const f of result.files) {
          parts.push(`\n--- file: ${f.name} (${f.size}B, ${f.encoding}) ---\n${f.content}`);
        }
        return { content: [{ type: 'text', text: parts.join('') }] };
      }

      // ---- list_files ----
      if (name === 'list_files') {
        if (!existsSync(a.path)) {
          return { content: [{ type: 'text', text: `Not found: ${a.path}` }], isError: true };
        }
        const entries = readdirSync(a.path, { withFileTypes: true }).map((e) => ({
          name: e.name,
          type: e.isDirectory() ? 'dir' : 'file',
          ...(e.isFile() ? { size: statSync(join(a.path, e.name)).size } : {}),
        }));
        return { content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }] };
      }

      // ---- read_file ----
      if (name === 'read_file') {
        if (!existsSync(a.path)) {
          return { content: [{ type: 'text', text: `Not found: ${a.path}` }], isError: true };
        }
        const buf = readFileSync(a.path);
        return {
          content: [{
            type: 'text',
            text: isBinary(a.path) ? buf.toString('base64') : buf.toString('utf8'),
          }],
        };
      }

      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };

    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error in ${name}: ${err.message}\n${err.stack ?? ''}` }],
        isError: true,
      };
    }
  });

  return srv;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------
const httpPort = process.env.BB_MCP_PORT ? parseInt(process.env.BB_MCP_PORT) : null;

if (httpPort) {
  // HTTP/SSE mode — for Cowork or any remote client
  const sseTransports = new Map();
  const mcpServer = makeMcpServer();

  const http = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${httpPort}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

    if (req.method === 'GET' && url.pathname === '/sse') {
      const transport = new SSEServerTransport('/message', res);
      sseTransports.set(transport.sessionId, transport);
      transport.onclose = () => sseTransports.delete(transport.sessionId);
      await mcpServer.connect(transport);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/message') {
      const t = sseTransports.get(url.searchParams.get('sessionId'));
      if (t) { await t.handlePostMessage(req, res); return; }
      res.writeHead(404).end('session not found');
      return;
    }

    if (url.pathname === '/health') { res.writeHead(200).end('ok'); return; }
    res.writeHead(404).end();
  });

  http.listen(httpPort, () =>
    process.stderr.write(`[blockbench-headless MCP] HTTP/SSE on http://localhost:${httpPort}/sse\n`),
  );
} else {
  // stdio mode — standard for Claude Code / Cowork MCP config
  const transport = new StdioServerTransport();
  await makeMcpServer().connect(transport);
}
