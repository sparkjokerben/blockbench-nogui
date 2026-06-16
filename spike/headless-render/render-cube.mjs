// Phase 0 spike: render a textured cube with THREE r0.129 headlessly (pure node) -> PNG
// Backend under test: headless-gl ("gl"), WebGL1 only. We force THREE to use its WebGL1 path.
import createGL from 'gl';
import * as THREENS from 'three';
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const THREE = THREENS;
const __dirname = dirname(fileURLToPath(import.meta.url));

const WIDTH = 512;
const HEIGHT = 512;

console.log('THREE revision:', THREE.REVISION);

// --- headless-gl context (WebGL1) ---
const glContext = createGL(WIDTH, HEIGHT, { preserveDrawingBuffer: true, antialias: true });
if (!glContext) throw new Error('headless-gl failed to create a context');
console.log('GL_VERSION:', glContext.getParameter(glContext.VERSION));
console.log('GL_RENDERER:', glContext.getParameter(glContext.RENDERER));

// --- minimal canvas shim THREE.WebGLRenderer is happy with ---
const canvas = {
  width: WIDTH,
  height: HEIGHT,
  style: {},
  addEventListener() {},
  removeEventListener() {},
  getContext(type) {
    // Force WebGL1: report no webgl2, hand back the headless-gl context for webgl
    if (type === 'webgl' || type === 'experimental-webgl') return glContext;
    return null;
  },
};

// --- renderer: pass the context explicitly so THREE uses our WebGL1 ctx ---
const renderer = new THREE.WebGLRenderer({
  canvas,
  context: glContext,
  antialias: true,
  alpha: true,
  preserveDrawingBuffer: true,
});
renderer.setSize(WIDTH, HEIGHT, false);
renderer.setClearColor(0x000000, 0); // transparent

// --- scene ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, WIDTH / HEIGHT, 0.1, 1000);
camera.position.set(28, 26, 36);
camera.lookAt(0, 0, 0);

// procedural checker texture (tests texture upload through headless-gl)
const TS = 16;
const texData = new Uint8Array(TS * TS * 4);
for (let y = 0; y < TS; y++) {
  for (let x = 0; x < TS; x++) {
    const i = (y * TS + x) * 4;
    const on = (x + y) % 2 === 0;
    texData[i] = on ? 230 : 60;
    texData[i + 1] = on ? 120 : 90;
    texData[i + 2] = on ? 60 : 200;
    texData[i + 3] = 255;
  }
}
const tex = new THREE.DataTexture(texData, TS, TS, THREE.RGBAFormat);
tex.magFilter = THREE.NearestFilter;
tex.minFilter = THREE.NearestFilter;
tex.needsUpdate = true;

const geo = new THREE.BoxGeometry(16, 16, 16);
const mat = new THREE.MeshBasicMaterial({ map: tex });
const cube = new THREE.Mesh(geo, mat);
scene.add(cube);

// render
renderer.render(scene, camera);

// --- read pixels from default framebuffer (bottom-up) and flip for PNG ---
const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
glContext.readPixels(0, 0, WIDTH, HEIGHT, glContext.RGBA, glContext.UNSIGNED_BYTE, pixels);

const png = new PNG({ width: WIDTH, height: HEIGHT });
for (let y = 0; y < HEIGHT; y++) {
  const srcRow = (HEIGHT - 1 - y) * WIDTH * 4;
  const dstRow = y * WIDTH * 4;
  png.data.set(pixels.subarray(srcRow, srcRow + WIDTH * 4), dstRow);
}

// quick sanity: count non-transparent pixels so the spike self-reports success
let opaque = 0;
for (let i = 3; i < png.data.length; i += 4) if (png.data[i] > 10) opaque++;
console.log('non-transparent pixels:', opaque, `(${((opaque / (WIDTH * HEIGHT)) * 100).toFixed(1)}%)`);

const outPath = join(__dirname, 'out-cube.png');
writeFileSync(outPath, PNG.sync.write(png));
console.log('wrote', outPath);

if (opaque < 1000) {
  console.error('FAIL: almost nothing was drawn — backend likely not rendering.');
  process.exit(1);
}
console.log('OK: cube rendered headlessly.');
