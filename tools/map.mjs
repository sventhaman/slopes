// Renders the heightfield as a shaded relief map (shots/map.png) for quick terrain iteration.
import { createHeightfield, VERTS, CELLS, SUN_DIR } from '../src/heightfield.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const t0 = performance.now();
const f = createHeightfield();
console.log('generated in', Math.round(performance.now() - t0), 'ms');
let min = Infinity, max = -Infinity;
for (const v of f.h) { min = Math.min(min, v); max = Math.max(max, v); }
console.log('height range', min.toFixed(0), max.toFixed(0));
const W = VERTS;
const buf = Buffer.alloc(W * W * 3);
for (let k = 0; k < W * W; k++) {
  const ny = f.nrm[k * 3 + 1];
  const slope = Math.acos(ny) * 180 / Math.PI;
  const lit = 0.35 + 0.65 * f.sun[k] * Math.max(0, f.nrm[k*3]*SUN_DIR[0] + ny*SUN_DIR[1] + f.nrm[k*3+2]*SUN_DIR[2]);
  const rock = slope > 46 ? 1 : 0;
  const hh = (f.h[k] - min) / (max - min);
  let r = 235, g = 240, b = 250;
  if (rock) { r = 110; g = 100; b = 95; }
  if (hh < 0.08 && !rock) { r = 215; g = 230; b = 245; }
  const contour = 1;
  buf[k*3] = r * lit * contour; buf[k*3+1] = g * lit * contour; buf[k*3+2] = b * lit * contour;
}
mkdirSync('shots', { recursive: true });
writeFileSync('shots/map.ppm', Buffer.concat([Buffer.from(`P6 ${W} ${W} 255\n`), buf]));
execSync('convert shots/map.ppm shots/map.png && rm shots/map.ppm');
// slope histogram
const hist = new Array(10).fill(0);
for (let k = 0; k < W*W; k++) hist[Math.min(9, Math.floor(Math.acos(f.nrm[k*3+1])*180/Math.PI/10))]++;
console.log('slope histogram (10deg bins %):', hist.map(c => (100*c/(W*W)).toFixed(1)).join(' '));
const h2 = new Array(10).fill(0); let cnt = 0;
for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
  const x = -1536 + i*4, z = -1536 + j*4;
  if (Math.abs(x) > 1100 || Math.abs(z) > 1200) continue;
  const k = j*W+i; cnt++;
  h2[Math.min(9, Math.floor(Math.acos(f.nrm[k*3+1])*180/Math.PI/10))]++;
}
console.log('inner slope histogram %:', h2.map(c => (100*c/cnt).toFixed(1)).join(' '));
