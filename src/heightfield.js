// The mountain: a 3 km square heightfield sampled every 4 m.
// x runs east, z runs south, y is up. The main face falls from the summit
// ridge in the north to the resort village in the valley floor to the south.
// Pure data (no three.js) so tools can render it in Node.
import { simplex, smoothstep, lerp, clamp, fract } from './util.js';

export const HALF = 1536;
export const SIZE = HALF * 2;
export const CELLS = 768;
export const STEP = SIZE / CELLS;
export const VERTS = CELLS + 1;

// Sun from the west-southwest, low afternoon light.
export const SUN_DIR = (() => {
  const el = (34 * Math.PI) / 180;
  const az = (242 * Math.PI) / 180; // compass bearing the sun shines from
  const v = [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
  return v;
})();

// Named summits: [x, z, height above valley, base radius].
const PEAKS = [
  [40, -960, 1250, 1750],
  [-780, -760, 930, 1200],
  [720, -860, 1040, 1300],
  [1020, 180, 380, 800],
  [-1040, 280, 340, 800],
  [-360, -1160, 820, 950],
];

/** Where the village sits; the terrain is flattened around it. */
export const VILLAGE = { x: 60, z: 1060, r: 260 };

export function createHeightfield(seed = 7) {
  const n1 = simplex(seed);
  const n2 = simplex(seed + 101);
  const n3 = simplex(seed + 202);
  const n4 = simplex(seed + 303);

  function fbm(nf, x, z, oct) {
    let s = 0;
    let a = 0.5;
    let f = 1;
    for (let i = 0; i < oct; i++) {
      s += a * nf(x * f, z * f);
      f *= 2.02;
      a *= 0.5;
    }
    return s;
  }

  function ridged(x, z, oct) {
    let s = 0;
    let a = 0.55;
    let f = 1;
    let w = 1;
    for (let i = 0; i < oct; i++) {
      let r = 1 - Math.abs(n1(x * f, z * f));
      r *= r;
      s += r * a * w;
      w = clamp(r * 1.6);
      f *= 2.07;
      a *= 0.5;
    }
    return s;
  }

  function raw(x, z) {
    const wx = x + 150 * fbm(n2, x * 0.0006, z * 0.0006, 3);
    const wz = z + 150 * fbm(n2, x * 0.0006 + 31.7, z * 0.0006 - 17.3, 3);

    // Peaks combined with a smooth max so ridges form between them.
    let acc = 0;
    const k = 0.012;
    for (const [px, pz, ph, pr] of PEAKS) {
      const d = Math.hypot(wx - px, wz - pz) / pr;
      const c = ph * Math.pow(Math.max(0, 1 - d), 1.35);
      acc += Math.exp(k * c);
    }
    let m = Math.log(acc) / k;
    // Backbone ridge across the north.
    m = Math.max(m, 650 * Math.exp(-(((wz + 900) / 520) ** 2)) * smoothstep(1700, 500, Math.abs(wx)));
    // General tilt: the whole range drains south.
    m += 300 * smoothstep(1400, -1400, z);

    // Ridges and couloirs, rugged up high and soft down low.
    const alt = smoothstep(60, 1100, m);
    const rd = ridged(wx / 780, wz / 780, 4);
    const amp = lerp(14, 170, alt);
    let h = m + (rd - 0.45) * amp;

    // Rolling snow features: rollers and wind lips to jump off.
    h += fbm(n3, x / 85, z / 85, 2) * lerp(3, 1.5, alt);
    h += Math.max(0, n4(x / 46, z / 46)) ** 2 * 4.5 * (1 - alt);

    // Cliff bands at mid altitude.
    const mask = smoothstep(0.45, 0.8, n4(x / 520 + 9.1, z / 520 - 3.3)) * smoothstep(220, 520, h) * (1 - smoothstep(1100, 1300, h));
    if (mask > 0) {
      const step = 26;
      const t = h / step;
      const terr = (Math.floor(t) + smoothstep(0.55, 0.85, fract(t))) * step;
      h = lerp(h, terr, mask * 0.55);
    }

    // Outer ranges so the valley is enclosed.
    const edge = Math.max(Math.abs(x), Math.abs(z) * 1.05);
    const rim = smoothstep(1100, HALF + 120, edge);
    if (rim > 0) h += rim ** 1.7 * (180 + 380 * ridged(x / 520 + 7, z / 520 - 5, 3));

    // Valley floor.
    h = Math.max(h, 10 + 0.06 * (HALF - z));
    return h;
  }

  const h = new Float32Array(VERTS * VERTS);
  for (let j = 0; j < VERTS; j++) {
    const z = -HALF + j * STEP;
    for (let i = 0; i < VERTS; i++) h[j * VERTS + i] = raw(-HALF + i * STEP, z);
  }

  // Two light thermal-erosion-ish blurs on steep cells keep slopes skiable
  // while leaving cliffs.
  smoothPass(h, 0.5);
  smoothPass(h, 0.5);

  // Level a shelf for the village.
  const hv = heightAt(h, VILLAGE.x, VILLAGE.z);
  for (let j = 0; j < VERTS; j++) {
    for (let i = 0; i < VERTS; i++) {
      const x = -HALF + i * STEP;
      const z = -HALF + j * STEP;
      const vb = smoothstep(VILLAGE.r * 1.6, VILLAGE.r * 0.7, Math.hypot(x - VILLAGE.x, z - VILLAGE.z));
      if (vb > 0) h[j * VERTS + i] = lerp(h[j * VERTS + i], hv + 0.03 * (VILLAGE.z - z), vb);
    }
  }

  const nrm = new Float32Array(VERTS * VERTS * 3);
  for (let j = 0; j < VERTS; j++) {
    for (let i = 0; i < VERTS; i++) {
      const hl = h[j * VERTS + Math.max(0, i - 1)];
      const hr = h[j * VERTS + Math.min(CELLS, i + 1)];
      const hd = h[Math.max(0, j - 1) * VERTS + i];
      const hu = h[Math.min(CELLS, j + 1) * VERTS + i];
      const nx = hl - hr;
      const nz = hd - hu;
      const ny = 2 * STEP;
      const l = Math.hypot(nx, ny, nz);
      const o = (j * VERTS + i) * 3;
      nrm[o] = nx / l;
      nrm[o + 1] = ny / l;
      nrm[o + 2] = nz / l;
    }
  }

  const sun = bakeSun(h);
  // Wind-scoured crests: convex spots lose snow.
  const expo = new Float32Array(VERTS * VERTS);
  for (let j = 2; j < VERTS - 2; j++) {
    for (let i = 2; i < VERTS - 2; i++) {
      const c = h[j * VERTS + i];
      const avg = (h[j * VERTS + i - 2] + h[j * VERTS + i + 2] + h[(j - 2) * VERTS + i] + h[(j + 2) * VERTS + i]) / 4;
      expo[j * VERTS + i] = clamp((c - avg) / 6, -1, 1);
    }
  }

  // Snow cover from the slope of a blurred surface, so rock edges follow
  // landforms rather than individual triangles.
  const hb = h.slice();
  for (let pass = 0; pass < 3; pass++) {
    const c = hb.slice();
    for (let j = 1; j < CELLS; j++) {
      for (let i = 1; i < CELLS; i++) {
        const k = j * VERTS + i;
        hb[k] = (c[k] * 2 + c[k - 1] + c[k + 1] + c[k - VERTS] + c[k + VERTS]) / 6;
      }
    }
  }
  const cover = new Float32Array(VERTS * VERTS);
  for (let j = 1; j < CELLS; j++) {
    for (let i = 1; i < CELLS; i++) {
      const k = j * VERTS + i;
      const gx = (hb[k + 1] - hb[k - 1]) / (2 * STEP);
      const gz = (hb[k + VERTS] - hb[k - VERTS]) / (2 * STEP);
      const deg = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
      cover[k] = clamp(smoothstep(50, 41, deg) - Math.max(0, expo[k]) * 0.35);
    }
  }

  const field = { h, nrm, sun, expo, cover, raw };
  field.height = (x, z) => heightAt(h, x, z);
  field.normal = (x, z, out) => normalAt(nrm, x, z, out);
  field.sunAt = (x, z) => scalarAt(sun, x, z);
  field.slopeDeg = (x, z) => {
    const o = [0, 0, 0];
    normalAt(nrm, x, z, o);
    return (Math.acos(clamp(o[1], -1, 1)) * 180) / Math.PI;
  };
  return field;
}

function smoothPass(h, amt) {
  const c = h.slice();
  for (let j = 1; j < CELLS; j++) {
    for (let i = 1; i < CELLS; i++) {
      const k = j * VERTS + i;
      const avg = (c[k - 1] + c[k + 1] + c[k - VERTS] + c[k + VERTS]) * 0.25;
      h[k] = lerp(c[k], avg, amt);
    }
  }
}

/** Fraction of direct sun each vertex gets, by marching the heightfield toward the sun. */
function bakeSun(h) {
  const out = new Float32Array(VERTS * VERTS);
  const [sx, sy, sz] = SUN_DIR;
  const hl = Math.hypot(sx, sz);
  const dx = sx / hl;
  const dz = sz / hl;
  const rise = sy / hl; // metres up per metre along the ground
  const S = 2; // bake on every 2nd vertex, fill the rest
  for (let j = 0; j < VERTS; j += S) {
    for (let i = 0; i < VERTS; i += S) {
      const x0 = -HALF + i * STEP;
      const z0 = -HALF + j * STEP;
      const h0 = h[j * VERTS + i] + 1.5;
      let vis = 1;
      let d = 6;
      while (d < 2600) {
        const x = x0 + dx * d;
        const z = z0 + dz * d;
        if (x < -HALF || x > HALF || z < -HALF || z > HALF) break;
        const ray = h0 + d * rise;
        const th = heightAt(h, x, z);
        const gap = ray - th;
        if (gap < 0) {
          vis = 0;
          break;
        }
        // Soft penumbra close to the occluder.
        vis = Math.min(vis, gap / (d * 0.03 + 2));
        d += Math.max(4, d * 0.04);
      }
      out[j * VERTS + i] = clamp(vis);
    }
  }
  for (let j = 0; j < VERTS; j++) {
    for (let i = 0; i < VERTS; i++) {
      if (j % S === 0 && i % S === 0) continue;
      const i0 = i - (i % S);
      const j0 = j - (j % S);
      const i1 = Math.min(CELLS - (CELLS % S), i0 + S);
      const j1 = Math.min(CELLS - (CELLS % S), j0 + S);
      const fx = i1 === i0 ? 0 : (i - i0) / S;
      const fz = j1 === j0 ? 0 : (j - j0) / S;
      const a = out[j0 * VERTS + i0];
      const b = out[j0 * VERTS + i1];
      const c = out[j1 * VERTS + i0];
      const e = out[j1 * VERTS + i1];
      out[j * VERTS + i] = lerp(lerp(a, b, fx), lerp(c, e, fx), fz);
    }
  }
  return out;
}

function cell(x, z) {
  const fx = clamp((x + HALF) / STEP, 0, CELLS - 1e-4);
  const fz = clamp((z + HALF) / STEP, 0, CELLS - 1e-4);
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  return [i, j, fx - i, fz - j];
}

export function scalarAt(a, x, z) {
  const [i, j, u, v] = cell(x, z);
  const k = j * VERTS + i;
  return lerp(lerp(a[k], a[k + 1], u), lerp(a[k + VERTS], a[k + VERTS + 1], u), v);
}

/** Height on the rendered triangle (matches the mesh diagonal i,j -> i+1,j+1). */
export function heightAt(h, x, z) {
  const [i, j, u, v] = cell(x, z);
  const k = j * VERTS + i;
  const h00 = h[k];
  const h10 = h[k + 1];
  const h01 = h[k + VERTS];
  const h11 = h[k + VERTS + 1];
  if (u > v) return h00 + (h10 - h00) * u + (h11 - h10) * v;
  return h00 + (h11 - h01) * u + (h01 - h00) * v;
}

export function normalAt(nrm, x, z, out) {
  const [i, j, u, v] = cell(x, z);
  const k = (j * VERTS + i) * 3;
  const r = VERTS * 3;
  for (let c = 0; c < 3; c++) {
    out[c] = lerp(lerp(nrm[k + c], nrm[k + 3 + c], u), lerp(nrm[k + r + c], nrm[k + r + 3 + c], u), v);
  }
  const l = Math.hypot(out[0], out[1], out[2]);
  out[0] /= l;
  out[1] /= l;
  out[2] /= l;
  return out;
}
