# Blockbench Headless SDK

An AI-first, **headless** (no GUI), **parallel** way to drive Blockbench from Node.js:
create/edit models, draw pixel textures, render to PNG, live-preview in a browser, and
import/export every Blockbench format — all programmatically.

It runs the real Blockbench engine (data model, codecs, undo, THREE.js geometry) inside a
node runtime shim, so output is identical to the desktop app.

## Setup

```bash
npm install                      # install deps (three, esbuild, gl, @napi-rs/canvas, jsdom, pngjs)
node ./build.js --target=headless   # build dist/headless.js (the engine bundle)
```

Then import the SDK (plain ESM, no build step for the SDK itself):

```js
import { createSession, renderSession } from './sdk/index.mjs';
```

## Quick start

```js
import { writeFileSync } from 'node:fs';
import { createSession, renderSession } from './sdk/index.mjs';

const s = createSession('java_block', { name: 'block' });
s.setResolution(16, 16);

const cube = s.addCube({ name: 'block', from: [0, 0, 0], to: [16, 16, 16] });
const tex  = s.addTexture({ name: 'tex', width: 16, height: 16, fill: '#3a7d3a' });
s.applyTexture(cube, tex);

// draw on a specific face (coords are local to the face)
s.paintFace(tex, cube, 'up', (ctx, { w, h }) => {
  ctx.fillStyle = '#caa24a';
  ctx.fillRect(w/2 - 1, h/2 - 1, 2, 2);
});

writeFileSync('block.png', renderSession(s, { angle: 'isometric' }));
writeFileSync('block.bbmodel', s.exportProject());
```

## Sessions

A `Session` is an isolated project. Many sessions can coexist in one process; each operation
runs with its session active (cooperative single-active model — for true parallelism use the
worker pool below).

```js
const a = createSession('free');
const b = createSession('bedrock');
a.addCube({ from: [0,0,0], to: [8,8,8] });   // independent of b
a.undo();                                     // per-session undo
const bbmodel = a.exportProject();            // .bbmodel string
a.export('gltf', { encoding: 'ascii', embed_textures: true }); // -> Promise
a.loadProject(bbmodel);                        // load a .bbmodel (string or object)
```

Key methods: `setResolution`, `addCube`, `addGroup`, `getElement`, `remove`, `addTexture`,
`paint`, `paintFace`, `applyTexture`, `exportTexturePNG`, `exportProject`, `export(codec)`,
`loadProject`, `snapshot`, `openPreview`, `undo`/`redo`, `close`.

## Image projects & painting

```js
import { createImageSession } from './sdk/index.mjs';
const { session, texture } = createImageSession({ name: 'icon', width: 16, height: 16 });
session.paint(texture, (ctx) => { ctx.fillStyle = '#8a8a8a'; ctx.fillRect(2,2,12,12); });
writeFileSync('icon.png', session.exportTexturePNG(texture));
```

`paint(texture, fn)` gives you a 2D canvas context (image smoothing off). `paintFace(texture,
element, faceKey, fn)` translates/clips to that face's UV rect so `(0,0)` is the face corner.

## Rendering

```js
renderSession(s, {
  width: 512, height: 512,
  angle: 'isometric',           // front|back|left|right|top|bottom|isometric, or [azimuthDeg, elevationDeg]
  background: null,             // null = transparent, or a CSS color
  ortho: false, fov: 45,
});                              // -> PNG Buffer
renderAngles(s, ['front','isometric','top']); // -> { angleName: Buffer }
```

Rendering is fully headless via `headless-gl` (WebGL1) + THREE r129.

## Live browser preview

```js
const server = await s.openPreview();   // -> { url }
console.log(server.url);                 // open in a browser
// edits to the session hot-reload the viewer over SSE
await server.stop();
```

The viewer (three.js, browser WebGL2) builds the model from the session snapshot with orbit
controls, animation playback, and a grid.

## Parallelism (worker pool)

True parallelism uses **child processes** (each gets its own native GL — `headless-gl` is not
safe across worker threads). Many workers, each hosting many sessions. Operations are routed
to the owning worker by affinity.

```js
import { WorkerPool, FixedScheduler } from './sdk/index.mjs';

const pool = new WorkerPool({ maxWorkers: 4, maxSessionsPerWorker: 8 });
const h = await pool.createSession('java_block');
await h.addCube({ name: 'c', from: [0,0,0], to: [8,8,8] });
const png = await h.render({ angle: 'front' });   // PNG Buffer
const bbmodel = await h.exportProject();
await pool.shutdown();
```

Painting across the worker boundary uses declarative commands (functions can't be serialized):

```js
await h.paint(textureId, [
  { op: 'fillRect', x: 0, y: 0, w: 16, h: 16, color: '#3a7d3a' },
  { op: 'fillPixel', x: 8, y: 8, color: '#fff' },
]);
```

### Swappable scheduler (placement strategy)

`pool.createSession()` asks a `Scheduler` where to place each session. Two implementations
ship with the **same interface**, so you can swap strategies without touching pool code:

- `FixedScheduler` — deterministic: fill workers to capacity, then spawn (default).
- `AgentScheduler(decide)` — delegates placement to your async `decide(state, request)`
  (e.g. an LLM/management agent), falling back to fixed logic on error.

```js
const pool = new WorkerPool({
  maxWorkers: 4,
  scheduler: new AgentScheduler(async (state, req) => {
    // decide which worker (or spawn) for this new `req.format` session
    return { workerId: null, spawn: true };
  }),
});
```

## Formats & codecs

```js
import { listFormats, listCodecs } from './sdk/index.mjs';
await listFormats();  // ['free','java_block','bedrock','image', ...]
await listCodecs();   // ['project','gltf','obj','java_block','bedrock', ...]
```

## Notes & limitations

- Auto-UV packs all six faces of a cube; on a small texture the regions overlap. Use a larger
  texture, separate textures, or explicit `faces` UV for distinct per-face art.
- The headless renderer uses plain materials + a `DataTexture` bridge (not Blockbench's custom
  shaders), so shading/lighting differs slightly from the desktop preview, but geometry, UVs,
  and textures match.
- The cooperative single-active model means in-process sessions don't run truly concurrently;
  use the worker pool for parallel CPU/GPU work.

See `examples/showcase.mjs` for an end-to-end build → paint → render → export, and
`spike/sdk-test/*` for focused verification scripts.
