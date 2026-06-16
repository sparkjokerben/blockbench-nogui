---
name: blockbench-headless
description: >
  Drive this repo's headless Blockbench SDK to programmatically
  create/edit/paint/render/export low-poly & Minecraft models with NO GUI.
  Use whenever the task is to build or modify a 3D model (cubes/groups/bones),
  draw or edit pixel textures (item/block art via the Image project type or
  UV-located face painting), render a model to PNG headlessly, run a live
  browser preview, batch/parallelize model work across a worker pool, or
  import/export Blockbench formats (.bbmodel, glTF, OBJ, Java/Bedrock) from Node.
  Triggers: build a model, make a Minecraft block/item, draw this texture,
  render the model, export bbmodel/gltf, preview the model, generate N models in parallel.
---

# Blockbench Headless SDK

A fork of Blockbench that runs **headless** (no GUI) in Node.js for AI-first model building,
texture painting, rendering, and batch/parallel work.

**Engine location**: `/Users/jokerben/Documents/WorkSpace/blockbench-nogui`
**Full human docs**: `sdk/README.md` in the engine directory.

## Setup check (do this first)

Before writing any code, verify the tool is ready in your current working directory:

```bash
# 1. Is the engine bundle built?
ls /Users/jokerben/Documents/WorkSpace/blockbench-nogui/dist/headless.js

# 2. Is the package linked in this project?
ls node_modules/blockbench-headless 2>/dev/null || echo "NOT LINKED"
```

If `dist/headless.js` is missing, build it:
```bash
node /Users/jokerben/Documents/WorkSpace/blockbench-nogui/build.js --target=headless
```

If the package is not linked in the current project:
```bash
# Register globally (only needed once ever on this machine):
cd /Users/jokerben/Documents/WorkSpace/blockbench-nogui && npm link
# Link into the current project:
npm link blockbench-headless
```

Only rebuild `dist/headless.js` when files under `js/` in the engine directory change.
The SDK (`sdk/`) is plain ESM - no rebuild needed for SDK edits.

## Import path

**From an external project** (mod project, etc.) - use the package name:
```js
import { createSession, renderSession } from 'blockbench-headless';
```

**From within the engine directory itself** - use the relative path:
```js
import { createSession, renderSession } from './sdk/index.mjs';
```

## Core recipe

```js
import { writeFileSync } from 'node:fs';
import { createSession, renderSession } from 'blockbench-headless';

const s = createSession('java_block', { name: 'block' }); // formats: free, java_block, bedrock, image, ...
s.setResolution(16, 16);

const cube = s.addCube({ name: 'block', from: [0,0,0], to: [16,16,16] }); // coords in model units
const tex  = s.addTexture({ name: 'tex', width: 16, height: 16, fill: '#3a7d3a' });
s.applyTexture(cube, tex);

s.paintFace(tex, cube, 'up', (ctx, { w, h }) => {   // faces: north/east/south/west/up/down
  ctx.fillStyle = '#caa24a'; ctx.fillRect(w/2-1, h/2-1, 2, 2);
});

writeFileSync('block.png', renderSession(s, { angle: 'isometric', background: null }));
writeFileSync('block.bbmodel', s.exportProject());
const gltf = await s.export('gltf', { encoding: 'ascii', embed_textures: true });
```

## API cheatsheet

- **Session**: `createSession(format, {name})`, `listSessions()`. Methods: `setResolution(w,h)`,
  `addCube({name,from,to,origin,rotation})`, `addGroup({name,origin,rotation})` (pass `{group}`/`{parent}`
  to nest), `getElement(idOrName)`, `remove(el)`, `addTexture({name,width,height,fill,dataUrl})`,
  `paint(tex, (ctx,{w,h})=>{})`, `paintFace(tex, el, faceKey, (ctx,{x,y,w,h})=>{})`,
  `applyTexture(el, tex, {faces})`, `exportTexturePNG(tex)`, `exportProject()` (-> .bbmodel string),
  `export(codec, opts)` (-> Promise; gltf/obj/fbx/collada/stl/java_block/bedrock), `loadProject(model)`,
  `snapshot()`, `undo()/redo()`, `openPreview()`, `close()`.
- **Image/paint**: `createImageSession({name,width,height,fill})` -> `{session,texture}`
  for standalone pixel art; `readPixels(session,tex)`; `faceUVRect(session,el,face,tex)`.
- **Render**: `renderSession(s, {width,height,angle,background,ortho,fov,zoom})` -> PNG Buffer.
  `angle`: `front|back|left|right|top|bottom|isometric` or `[azimuthDeg, elevationDeg]`. `background:null`=transparent.
  `renderAngles(s, ['front','isometric','top'], opts)` -> `{name: Buffer}`.
- **Live preview**: `const srv = await s.openPreview();` then open `srv.url`
  in a browser (three.js viewer, orbit/anim, hot-reloads on edits). `await srv.stop()`.
- **Parallel**: `new WorkerPool({maxWorkers,maxSessionsPerWorker,scheduler})`,
  `await pool.createSession(format)` -> async SessionHandle (same methods, all return Promises;
  `render()` -> Buffer). Painting uses declarative commands:
  `await h.paint(texId, [{op:'fillRect',x,y,w,h,color}, {op:'fillPixel',x,y,color}, {op:'line',...}])`.
  Swappable scheduler: `FixedScheduler` (default) or `AgentScheduler(async (state,req)=>({workerId,spawn}))`.
- **Discovery**: `await listFormats()`, `await listCodecs()`. Escape hatch: `import { BB }` -> Blockbench globals.

## Gotchas (learned the hard way - honor these)

- **Texture size vs faces**: auto-UV packs all 6 cube faces; a 16x16 texture can't hold 6 distinct
  8x8 faces, so they overlap (paint shows on multiple faces). Use a larger texture, separate
  textures per cube, or explicit `faces` UV for distinct per-face art.
- **Worker pool = child processes** (not worker_threads): `headless-gl` deadlocks on a 2nd GL
  context in a thread. Each `render()` inside a worker is fine. Pool startup is ~1-2s per worker.
- **Render fidelity**: uses plain materials + DataTexture bridge (not Blockbench's custom shaders),
  so lighting/shading differs slightly from desktop, but geometry, UVs, and textures match.
- **glTF/OBJ export** needs `session.assembleSceneGraph()` (export() calls it automatically). For
  glTF with textures use `{ encoding:'ascii', embed_textures:true }`.
- **Sessions are cooperative single-active** in one process (one active at a time). For true
  parallelism use the WorkerPool.
- After editing anything in `js/` of the engine directory, **rebuild** `dist/headless.js`.

## Using via MCP (Cowork / sandbox environments)

An MCP server is available at `mcp/server.mjs`. It wraps the SDK so you can use it
without a local shell — ideal for Cowork agents or any sandboxed environment.

**MCP tools:**
- `check_setup` — verify dist/headless.js exists and env is ready (call first)
- `run_script` — execute JS or TS code; write outputs to `process.env.BB_OUTPUT_DIR`
  and they are returned automatically (text as UTF-8, PNG/binary as base64)
- `build_engine` — rebuild dist/headless.js if js/ files changed
- `list_files` — list a directory
- `read_file` — read any file (binary -> base64)

**Example run_script payload (TypeScript):**
```ts
import { writeFileSync } from 'node:fs';
import { createSession, renderSession } from 'blockbench-headless';

const s = createSession('java_block', { name: 'stone' });
const cube = s.addCube({ name: 'block', from: [0,0,0], to: [16,16,16] });
const tex = s.addTexture({ name: 'tex', width: 16, height: 16, fill: '#888' });
s.applyTexture(cube, tex);

const outDir = process.env.BB_OUTPUT_DIR!;
writeFileSync(`${outDir}/stone.png`, renderSession(s, { angle: 'isometric' }));
writeFileSync(`${outDir}/stone.bbmodel`, s.exportProject());
s.close();
```

**MCP config** (already in `.claude/settings.json` for this project):
```json
{
  "mcpServers": {
    "blockbench-headless": {
      "command": "node",
      "args": ["/Users/jokerben/Documents/WorkSpace/blockbench-nogui/mcp/server.mjs"]
    }
  }
}
```

For HTTP/SSE mode (remote clients): `BB_MCP_PORT=7821 node mcp/server.mjs`
Then connect to `http://localhost:7821/sse`.

## Verify the tool works

Run these from the engine directory to confirm everything is working:

```bash
cd /Users/jokerben/Documents/WorkSpace/blockbench-nogui
node examples/showcase.mjs          # end-to-end: build -> paint -> render -> export
node spike/sdk-test/render.mjs      # headless render to PNG
node spike/sdk-test/sessions.mjs    # multi-session isolation
node spike/sdk-test/pool.mjs        # parallel pool + scheduler A->B
```

To eyeball a render: use the `Read` tool on a PNG output (e.g. `examples/out/golem-isometric.png`).

Engine bundle log spam is harmless; filter with:
`grep -vE "Vue warn|development mode|ObjectRef|Downgrading"`.
