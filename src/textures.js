import * as THREE from 'three';
import { rng } from './util.js';

/** Tileable value noise, a different pattern in each of R, G, B. */
export function noiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const r = rng(99);
  const channel = (c) => {
    const acc = new Float32Array(size * size);
    let amp = 1;
    let total = 0;
    for (let cells = 4; cells <= 64; cells *= 2) {
      const lat = new Float32Array(cells * cells);
      for (let i = 0; i < lat.length; i++) lat[i] = r();
      const cs = size / cells;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const gx = x / cs;
          const gy = y / cs;
          const x0 = Math.floor(gx);
          const y0 = Math.floor(gy);
          let fx = gx - x0;
          let fy = gy - y0;
          fx = fx * fx * (3 - 2 * fx);
          fy = fy * fy * (3 - 2 * fy);
          const x1 = (x0 + 1) % cells;
          const y1 = (y0 + 1) % cells;
          const a = lat[y0 * cells + x0];
          const b = lat[y0 * cells + x1];
          const cc = lat[y1 * cells + x0];
          const d = lat[y1 * cells + x1];
          acc[y * size + x] += amp * (a + (b - a) * fx + (cc - a) * fy + (a - b - cc + d) * fx * fy);
        }
      }
      total += amp;
      amp *= 0.55;
    }
    for (let i = 0; i < acc.length; i++) data[i * 4 + c] = Math.round((acc[i] / total) * 255);
  };
  channel(0);
  channel(1);
  channel(2);
  for (let i = 0; i < size * size; i++) data[i * 4 + 3] = 255;
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Soft round puff for snow spray. */
export function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
