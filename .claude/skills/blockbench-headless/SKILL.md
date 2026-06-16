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

This repo is a fork of Blockbench rebuilt to run **headless** (no GUI) and be driven from
Node.js — for AI-first model building, texture painting, rendering, and batch/parallel work.
It runs the real Blockbench engine in a node runtime shim, so output matches the desktop app.

Full human docs: `sdk/README.md`. Background/gotchas: the project memory files.

## Setup (once)

```bash
npm install
node ./build.js --target=headless   # builds dist/headless.js (the engine bundle)
```
Rebuild `dist/headless.js` ONLY when you change files under `js/` (engine/runtime). The SDK
under `sdk/` is plain ESM — edits there need no rebuild.

## Core recipe

```js
import { writeFileSync } from 'node:fs';
import { createSession, renderSession } from './sdk/index.mjs';

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

## API cheatsheet (`sdk/index.mjs`)

- **Session**: `createSession(format, {name})`, `listSessions()`. Methods: `setResolution(w,h)`,
  `addCube({name,from,to,origin,rotation})`, `addGroup({name,origin,rotation})` (pass `{group}`/`{parent}`
  to nest), `getElement(idOrName)`, `remove(el)`, `addTexture({name,width,height,fill,dataUrl})`,
  `paint(tex, (ctx,{w,h})=>{})`, `paintFace(tex, el, faceKey, (ctx,{x,y,w,h})=>{})`,
  `applyTexture(el, tex, {faces})`, `exportTexturePNG(tex)`, `exportProject()` (→ .bbmodel string),
  `export(codec, opts)` (→ Promise; gltf/obj/fbx/collada/stl/java_block/bedrock), `loadProject(model)`,
  `snapshot()`, `undo()/redo()`, `openPreview()`, `close()`.
- **Image/paint** (`sdk/paint.mjs`): `createImageSession({name,width,height,fill})` → `{session,texture}`
  for standalone pixel art; `readPixels(session,tex)`; `faceUVRect(session,el,face,tex)`.
- **Render** (`sdk/render.mjs`): `renderSession(s, {width,height,angle,background,ortho,fov,zoom})` → PNG Buffer.
  `angle`: `front|back|left|right|top|bottom|isometric` or `[azimuthDeg, elevationDeg]`. `background:null`=transparent.
  `renderAngles(s, ['front','isometric','top'], opts)` → `{name: Buffer}`.
- **Live preview** (`sdk/preview-server.mjs`): `const srv = await s.openPreview();` then open `srv.url`
  in a browser (three.js viewer, orbit/anim, hot-reloads on edits). `await srv.stop()`.
- **Parallel** (`sdk/worker-pool/`): `new WorkerPool({maxWorkers,maxSessionsPerWorker,scheduler})`,
  `await pool.createSession(format)` → async SessionHandle (same methods, all return Promises;
  `render()` → Buffer). Painting across the pool uses declarative commands:
  `await h.paint(texId, [{op:'fillRect',x,y,w,h,color}, {op:'fillPixel',x,y,color}, {op:'line',...}])`.
  Swappable scheduler: `FixedScheduler` (default) or `AgentScheduler(async (state,req)=>({workerId,spawn}))`.
- **Discovery**: `await listFormats()`, `await listCodecs()`. Escape hatch: `import { BB }` → Blockbench globals.

## Gotchas (learned the hard way — honor these)

- **Texture size vs faces**: auto-UV packs all 6 cube faces; a 16×16 texture can't hold 6 distinct
  8×8 faces, so they overlap (paint shows on multiple faces). Use a larger texture, separate
  textures per cube, or explicit `faces` UV for distinct per-face art.
- **Worker pool = child processes** (not worker_threads): `headless-gl` deadlocks on a 2nd GL
  context in a thread. Each `render()` inside a worker is fine. Pool startup is ~1–2s per worker.
- **Render fidelity**: the renderer uses plain materials + a DataTexture bridge (not Blockbench's
  custom shaders), so lighting/shading differ slightly from desktop, but geometry, UVs, and
  textures match. Don't expect pixel-identical shading.
- **glTF/OBJ export** needs `session.assembleSceneGraph()` (export() calls it automatically). For
  glTF with textures use `{ encoding:'ascii', embed_textures:true }`.
- **Sessions are cooperative single-active** in one process (one active at a time). For true
  parallelism use the WorkerPool.
- After editing anything in `js/`, **rebuild** `dist/headless.js`.

## Verify changes

```bash
node examples/showcase.mjs                       # end-to-end: build → paint → render → export
node spike/sdk-test/sessions.mjs                 # multi-session isolation
node spike/sdk-test/painting.mjs                 # image + face painting
node spike/sdk-test/render.mjs                   # headless render to PNG
node spike/sdk-test/preview.mjs                  # preview server (serve + live push)
node spike/sdk-test/pool.mjs                     # parallel pool + scheduler A→B
node spike/headless-smoke/roundtrip.mjs          # bbmodel build/export/reload/modify
```
To eyeball a render: `Read` the output PNG (e.g. `examples/out/golem-isometric.png`). For the
live viewer, run `node spike/sdk-test/preview-serve.mjs` and open the printed URL.

Engine bundle log spam is harmless; filter with:
`grep -vE "Vue warn|development mode|ObjectRef|Downgrading"`.
