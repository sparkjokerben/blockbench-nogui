// Phase 0 spike (2D path): prove @napi-rs/canvas works for the painter/Texture path,
// and that its pixels bridge into a THREE texture (headless-gl needs raw {width,height,data}).
import { createCanvas, ImageData } from '@napi-rs/canvas';
import * as THREE from 'three';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 1) draw a 16x16 "item-like" sprite with the 2D canvas API (what painter.js uses)
const S = 16;
const canvas = createCanvas(S, S);
const ctx = canvas.getContext('2d');
ctx.clearRect(0, 0, S, S);
ctx.fillStyle = '#3b5dc9';
ctx.fillRect(2, 2, 12, 12);
ctx.fillStyle = '#ffd23f';
ctx.fillRect(5, 5, 6, 6);
ctx.fillStyle = '#000000';
ctx.fillRect(6, 6, 1, 1);
ctx.fillRect(9, 6, 1, 1);

// 2) read pixels back (painter.js relies on getImageData/putImageData round-trips)
const imgData = ctx.getImageData(0, 0, S, S);
console.log('getImageData ok, bytes:', imgData.data.length, 'expected:', S * S * 4);

// 3) putImageData round-trip (edit a pixel, write it back)
imgData.data[0] = 255; imgData.data[1] = 0; imgData.data[2] = 0; imgData.data[3] = 255;
ctx.putImageData(new ImageData(imgData.data, S, S), 0, 0);

// 4) export the 2D canvas directly to PNG (Image project / texture export path)
const pngBuf = canvas.toBuffer('image/png');
writeFileSync(join(__dirname, 'out-sprite.png'), pngBuf);
console.log('wrote out-sprite.png', pngBuf.length, 'bytes');

// 5) bridge to a THREE texture via raw bytes (the integration headless-gl actually needs)
const tex = new THREE.DataTexture(
  new Uint8Array(ctx.getImageData(0, 0, S, S).data),
  S, S, THREE.RGBAFormat,
);
tex.needsUpdate = true;
console.log('THREE DataTexture from canvas pixels:', tex.image.width + 'x' + tex.image.height);

console.log('OK: 2D canvas path + canvas->THREE texture bridge works.');
