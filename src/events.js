// Drop zones and their challenges. Lines are traced over the generated
// mountain at load time, so gates and rings always sit on real terrain.
import * as THREE from 'three';
import { HALF, VILLAGE } from './heightfield.js';
import { clamp, lerp } from './util.js';

/** Displayed altitude: the village sits at 1850 m. */
export function altitude(field, y) {
  return Math.round(1850 + (y - field.height(VILLAGE.x, VILLAGE.z)));
}

// Piste grades follow the European colours; "double black" is off-piste extreme.
export const GRADES = {
  blue: { label: 'Blue', color: '#2f6fd6' },
  red: { label: 'Red', color: '#d8322b' },
  black: { label: 'Black', color: '#15171a' },
  xblack: { label: 'Double black', color: '#15171a', double: true },
};

export const DROPS = [
  {
    id: 'summit',
    name: 'Pointe Varenne',
    kind: 'trick',
    grade: 'xblack',
    hint: [40, -960],
    blurb: 'The summit face. Score tricks off the cliff bands and rollers all the way to the finish arch.',
    medals: [9000, 5000, 2200],
  },
  {
    id: 'couloir',
    name: 'Couloir des Chamois',
    kind: 'race',
    grade: 'black',
    hint: [720, -780],
    blurb: 'Race the east face through the gates. A missed gate costs 3 seconds.',
  },
  {
    id: 'wing',
    name: 'Dent du Loup',
    kind: 'wing',
    grade: 'xblack',
    hint: [-260, -1060],
    blurb: 'Wingsuit off the north tooth. Fly through the rings and stay close to the terrain for proximity points.',
  },
  {
    id: 'combe',
    name: 'Combe Blanche',
    kind: 'trick',
    grade: 'red',
    hint: [-900, -660],
    blurb: 'A wide bowl with soft rollers. Good for learning spins and flips.',
    medals: [5000, 2600, 1100],
  },
  {
    id: 'forest',
    name: 'Bois du Loup',
    kind: 'race',
    grade: 'blue',
    hint: [-640, -60],
    blurb: 'Gates through the spruce forest above the village. Stay off the trees.',
  },
];

function findPeak(field, hx, hz, r = 160) {
  let best = { x: hx, z: hz, h: -1e9 };
  for (let dz = -r; dz <= r; dz += 8) {
    for (let dx = -r; dx <= r; dx += 8) {
      const x = hx + dx;
      const z = hz + dz;
      const h = field.height(x, z);
      if (h > best.h) best = { x, z, h };
    }
  }
  return best;
}

/** Direction (radians, yaw) whose ground at `dist` is lowest. */
function downhill(field, x, z, dist, around = null, spread = Math.PI) {
  let best = 0;
  let bh = Infinity;
  const n = 32;
  for (let i = 0; i < n; i++) {
    const a = around === null ? (i / n) * Math.PI * 2 : around + ((i / (n - 1)) * 2 - 1) * spread;
    const h = field.height(x + Math.sin(a) * dist, z + Math.cos(a) * dist);
    if (h < bh) {
      bh = h;
      best = a;
    }
  }
  return best;
}

/** Find a skiable start just below the summit: slope under ~38 degrees. */
function startBelow(field, peak) {
  const yaw = downhill(field, peak.x, peak.z, 200);
  for (let d = 10; d < 260; d += 6) {
    const x = peak.x + Math.sin(yaw) * d;
    const z = peak.z + Math.cos(yaw) * d;
    if (field.slopeDeg(x, z) < 36) return { x, z, yaw };
  }
  return { x: peak.x + Math.sin(yaw) * 20, z: peak.z + Math.cos(yaw) * 20, yaw };
}

/**
 * Plan a ski line from (x, z) to the village with Dijkstra on a 16 m grid.
 * Edges favour steady fall-line grades, avoid cliffs, trees and climbing.
 */
export function traceSkiLine(field, obstacles, x, z, yaw, maxLen = 2600) {
  const C = 16;
  const N = Math.floor((HALF * 2) / C);
  const idx = (i, j) => j * N + i;
  const toW = (i) => -HALF + (i + 0.5) * C;
  const hs = new Float32Array(N * N);
  const pen = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const wx = toW(i);
      const wz = toW(j);
      hs[idx(i, j)] = field.height(wx, wz);
      const sl = field.slopeDeg(wx, wz);
      const edge = Math.abs(wx) > HALF - 140 || Math.abs(wz) > HALF - 140;
      pen[idx(i, j)] = Math.max(0, sl - 36) * 0.35 + obstacles.density(wx, wz) * 0.25 + (edge ? 50 : 0);
    }
  }
  const si = clamp(Math.floor((x + HALF) / C), 0, N - 1);
  const sj = clamp(Math.floor((z + HALF) / C), 0, N - 1);
  const dist = new Float32Array(N * N).fill(Infinity);
  const prev = new Int32Array(N * N).fill(-1);
  const heap = [];
  const push = (d, k) => {
    heap.push([d, k]);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heap[p][0] <= heap[c][0]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let m = c;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  const start = idx(si, sj);
  dist[start] = 0;
  push(0, start);
  const gi = Math.floor((VILLAGE.x + HALF) / C);
  const gj = Math.floor((VILLAGE.z - 90 + HALF) / C);
  let goal = -1;
  while (heap.length) {
    const [d, k] = pop();
    if (d > dist[k]) continue;
    const i = k % N;
    const j = (k / N) | 0;
    if (Math.hypot(i - gi, j - gj) < 5) {
      goal = k;
      break;
    }
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nk = idx(ni, nj);
        const len = C * Math.hypot(di, dj);
        const dh = hs[nk] - hs[k];
        const grade = -dh / len;
        let cost = len * (1 + pen[nk]);
        if (grade < 0.05) cost += len * (0.05 - grade) * 40;
        if (grade > 0.8) cost += len * (grade - 0.8) * 25;
        const nd = d + cost;
        if (nd < dist[nk]) {
          dist[nk] = nd;
          prev[nk] = k;
          push(nd, nk);
        }
      }
    }
  }
  const raw = [];
  for (let k = goal; k !== -1; k = prev[k]) raw.push([toW(k % N), toW((k / N) | 0)]);
  raw.reverse();
  raw[0] = [x, z];
  // Smooth the grid staircase, then resample every 18 m.
  let pts = raw;
  for (let it = 0; it < 4; it++) {
    pts = pts.map((p, n) => {
      if (n === 0 || n === pts.length - 1) return p;
      const a = pts[n - 1];
      const b = pts[n + 1];
      return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
    });
  }
  const out = [];
  let acc = 0;
  let len = 0;
  out.push({ x, z, h: field.height(x, z), yaw });
  for (let n = 1; n < pts.length && len < maxLen; n++) {
    const [ax, az] = pts[n - 1];
    const [bx, bz] = pts[n];
    const seg = Math.hypot(bx - ax, bz - az);
    acc += seg;
    len += seg;
    if (acc >= 18 || n === pts.length - 1) {
      acc = 0;
      out.push({ x: bx, z: bz, h: field.height(bx, bz), yaw: 0 });
    }
  }
  for (let n = 0; n < out.length; n++) {
    const a = out[Math.max(0, n - 1)];
    const b = out[Math.min(out.length - 1, n + 1)];
    out[n].yaw = Math.atan2(b.x - a.x, b.z - a.z);
  }
  return { pts: out, len };
}

/** Trace a wingsuit line: rings along gullies, always reachable at about 2:1 glide. */
export function traceWingLine(field, x, z, y, yaw) {
  const GLIDE = 2.1;
  const rings = [];
  const vh = field.height(VILLAGE.x, VILLAGE.z);
  for (let i = 0; i < 24; i++) {
    const L = i === 0 ? 140 : 75;
    let best = null;
    for (let k = -7; k <= 7; k++) {
      const a = yaw + k * 0.08;
      // The flattest path we can fly drops 1 m per GLIDE m; the terrain must stay under it.
      let ok = true;
      let maxG = -Infinity;
      for (let t = 0.1; t <= 1.0001; t += 0.1) {
        const g = field.height(x + Math.sin(a) * L * t, z + Math.cos(a) * L * t);
        maxG = Math.max(maxG, g);
        if (g + 12 > y - (L * t) / GLIDE) ok = false;
      }
      if (!ok) continue;
      const nx = x + Math.sin(a) * L;
      const nz = z + Math.cos(a) * L;
      if (Math.abs(nx) > HALF - 150 || Math.abs(nz) > HALF - 150) continue;
      const gEnd = field.height(nx, nz);
      const ny = Math.max(gEnd + 16, Math.min(y - L / GLIDE, gEnd + 34));
      // Prefer low ground ahead (gullies), and straight lines.
      const ax = nx + Math.sin(a) * 150;
      const az = nz + Math.cos(a) * 150;
      const cost = gEnd + field.height(ax, az) * 0.5 + Math.abs(k) * 3;
      if (!best || cost < best.cost) best = { cost, a, nx, nz, ny };
    }
    if (!best) break;
    x = best.nx;
    z = best.nz;
    y = best.ny;
    yaw = best.a;
    rings.push({ x, y, z, yaw });
    if (y - vh < 70) break;
  }
  return rings;
}

function bannerTexture(text, bg, fg) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 96);
  g.fillStyle = fg;
  g.font = '800 64px "Big Shoulders Display", "Arial Narrow", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const x of [128, 384]) g.fillText(text, x, 52);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const POLE = new THREE.CylinderGeometry(0.09, 0.09, 1, 6).translate(0, 0.5, 0);

function makeGate(field, g, color, w) {
  const grp = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, emissive: color, emissiveIntensity: 0 });
  const side = new THREE.Vector3(Math.cos(g.yaw), 0, -Math.sin(g.yaw));
  const hp = 4.2;
  for (const s of [-1, 1]) {
    const x = g.x + side.x * (w / 2) * s;
    const z = g.z + side.z * (w / 2) * s;
    const h = field.height(x, z);
    const pole = new THREE.Mesh(POLE, m);
    pole.scale.y = hp + 0.6;
    pole.position.set(x, h - 0.6, z);
    pole.castShadow = true;
    grp.add(pole);
  }
  const h0 = field.height(g.x + side.x * (w / 2), g.z + side.z * (w / 2));
  const h1 = field.height(g.x - side.x * (w / 2), g.z - side.z * (w / 2));
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.1), m);
  panel.position.set(g.x, Math.max(h0, h1) + hp - 0.6, g.z);
  panel.rotation.y = g.yaw;
  panel.material.side = THREE.DoubleSide;
  panel.castShadow = true;
  grp.add(panel);
  return { grp, mat: m };
}

function makeArch(field, p, w, text) {
  const grp = new THREE.Group();
  const tex = bannerTexture(text, '#15171a', '#ffd447');
  const arch = new THREE.Mesh(
    new THREE.TorusGeometry(w / 2, 1.1, 10, 40, Math.PI),
    new THREE.MeshStandardMaterial({ color: '#ffd447', roughness: 0.5 }),
  );
  const h = field.height(p.x, p.z);
  arch.position.set(p.x, h - 1, p.z);
  arch.rotation.y = p.yaw;
  arch.castShadow = true;
  const ban = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.6, w * 0.11), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  ban.position.set(p.x, h - 1 + w / 2 - w * 0.06, p.z);
  ban.rotation.y = p.yaw;
  grp.add(arch, ban);
  return grp;
}

function makeRing(r) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffb21e', emissive: '#ff8a00', emissiveIntensity: 0.4, roughness: 0.4 });
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(9, 0.45, 8, 40), m);
  mesh.position.set(r.x, r.y, r.z);
  mesh.rotation.y = r.yaw;
  return { mesh, mat: m };
}

/** Crossing test: did the segment a->b pass through the vertical plane of the gate, and where. */
function crossing(a, b, g) {
  const fx = Math.sin(g.yaw);
  const fz = Math.cos(g.yaw);
  const da = (a.x - g.x) * fx + (a.z - g.z) * fz;
  const db = (b.x - g.x) * fx + (b.z - g.z) * fz;
  if (da < 0 && db >= 0) {
    const t = da / (da - db);
    const x = lerp(a.x, b.x, t);
    const y = lerp(a.y, b.y, t);
    const z = lerp(a.z, b.z, t);
    const lat = (x - g.x) * fz - (z - g.z) * fx;
    return { lat, x, y, z };
  }
  return null;
}

export class Challenge {
  constructor(def, field, obstacles) {
    this.def = def;
    this.field = field;
    this.group = new THREE.Group();
    const peak = findPeak(field, def.hint[0], def.hint[1], def.id === 'forest' ? 30 : 160);
    this.peak = peak;
    if (def.kind === 'wing') {
      // Exit 30 m above the summit; take the heading that gives the longest flight.
      let bestRings = [];
      let bestYaw = 0;
      for (let k = 0; k < 24; k++) {
        const yaw = (k / 24) * Math.PI * 2;
        const rings = traceWingLine(field, peak.x + Math.sin(yaw) * 15, peak.z + Math.cos(yaw) * 15, peak.h + 30, yaw);
        if (rings.length > bestRings.length) {
          bestRings = rings;
          bestYaw = yaw;
        }
      }
      this.start = new THREE.Vector3(peak.x + Math.sin(bestYaw) * 15, peak.h + 30, peak.z + Math.cos(bestYaw) * 15);
      this.rings = bestRings.map((r, i) => ({ ...r, i, state: 0 }));
      this.yaw = this.rings.length ? Math.atan2(this.rings[0].x - this.start.x, this.rings[0].z - this.start.z) : bestYaw;
      for (const r of this.rings) {
        const { mesh, mat } = makeRing(r);
        r.mesh = mesh;
        r.mat = mat;
        this.group.add(mesh);
      }
      const len = this.rings.length;
      this.medals = def.medals || [len * 250 * 0.85 + 5500, len * 250 * 0.65 + 2500, len * 250 * 0.4 + 600].map((v) => Math.round(v / 100) * 100);
      this.length = len * 70;
    } else {
      // Plan from the top, then start where the line first settles onto a real slope.
      const top = def.id === 'forest' ? { x: def.hint[0], z: def.hint[1] } : peak;
      const full = traceSkiLine(field, obstacles, top.x, top.z, 0, 99999).pts;
      let si = 0;
      for (let i = 1; i < full.length - 8; i++) {
        const sl = field.slopeDeg(full[i].x, full[i].z);
        if (full[0].h - full[i].h > 10 && sl > 14 && sl < 36 && full[i + 6].h < full[i].h - 12) {
          si = i;
          break;
        }
      }
      const maxLen = def.kind === 'race' ? 1700 : 2600;
      this.line = [];
      let len = 0;
      for (let i = si; i < full.length && len < maxLen; i++) {
        if (i > si) len += Math.hypot(full[i].x - full[i - 1].x, full[i].z - full[i - 1].z);
        this.line.push(full[i]);
      }
      this.length = len;
      const s = this.line[0];
      this.start = new THREE.Vector3(s.x, field.height(s.x, s.z), s.z);
      this.yaw = s.yaw;
      this.gates = [];
      if (def.kind === 'race') {
        const every = 5;
        let side = 1;
        for (let i = every; i < this.line.length - 3; i += every) {
          const p = this.line[i];
          const off = 4.5 * side;
          side = -side;
          const g = { x: p.x + Math.cos(p.yaw) * off, z: p.z - Math.sin(p.yaw) * off, yaw: p.yaw, w: 11, i: this.gates.length, state: 0 };
          const made = makeGate(field, g, this.gates.length % 2 ? '#2f6fd6' : '#d8322b', g.w);
          g.grp = made.grp;
          g.mat = made.mat;
          this.group.add(made.grp);
          this.gates.push(g);
        }
        // Medal times from the line: average speeds of 22, 18 and 14 m/s.
        this.medals = [22, 18, 14].map((v) => Math.round((this.length / v) * 10) / 10);
      } else {
        this.medals = def.medals;
      }
      const end = this.line[this.line.length - 1];
      this.finish = { x: end.x, z: end.z, yaw: end.yaw, w: 34 };
      this.group.add(makeArch(field, this.finish, 34, 'FINISH'));
    }
    this.group.visible = false;
    this.startAlt = altitude(field, this.start.y);
    this.drop = Math.round(this.start.y - (this.line ? this.line[this.line.length - 1].h : this.rings.length ? field.height(this.rings[this.rings.length - 1].x, this.rings[this.rings.length - 1].z) : this.start.y));
    this.maxSlope = this.line ? Math.round(Math.max(...this.line.map((p) => field.slopeDeg(p.x, p.z)))) : null;
  }

  begin() {
    this.time = 0;
    this.running = false;
    this.done = false;
    this.penalty = 0;
    this.next = 0;
    this.hits = 0;
    this.prev = null;
    for (const g of this.gates || []) this.setGate(g, 0);
    for (const r of this.rings || []) this.setRing(r, 0);
    this.group.visible = true;
  }

  end() {
    this.group.visible = false;
  }

  setGate(g, state) {
    g.state = state;
    g.mat.emissiveIntensity = state === 0 ? 0.25 : 0;
    g.mat.opacity = state === 0 ? 1 : 0.35;
    g.mat.transparent = state !== 0;
  }

  setRing(r, state) {
    r.state = state;
    r.mat.emissiveIntensity = state === 0 ? 0.5 : 0.05;
    r.mat.color.set(state === 1 ? '#7be08a' : state === 2 ? '#7d7f86' : '#ffb21e');
    r.mat.emissive.set(state === 1 ? '#2a8a3a' : state === 2 ? '#000000' : '#ff8a00');
  }

  /** The next target the HUD should point at. */
  target() {
    if (this.done) return null;
    if (this.rings) {
      const r = this.rings[this.next];
      return r ? new THREE.Vector3(r.x, r.y, r.z) : null;
    }
    if (this.gates && this.next < this.gates.length) {
      const g = this.gates[this.next];
      return new THREE.Vector3(g.x, this.field.height(g.x, g.z) + 3, g.z);
    }
    return new THREE.Vector3(this.finish.x, this.field.height(this.finish.x, this.finish.z) + 6, this.finish.z);
  }

  /** Per-frame update. Returns events for the HUD and score. */
  update(dt, rider) {
    const out = [];
    if (this.done) return out;
    const p = rider.pos.clone();
    if (!this.running) {
      if (rider.speed > 1.5 || rider.mode !== 'ski') this.running = true;
      else {
        this.prev = p;
        return out;
      }
    }
    if (rider.mode !== 'crash') this.time += dt;
    const a = this.prev || p;
    this.prev = p;
    if (this.rings) {
      // A ring counts if you pass its plane within the hoop; passing it outside misses it.
      for (let i = this.next; i < Math.min(this.rings.length, this.next + 3); i++) {
        const r = this.rings[i];
        const c = crossing(a, p, r);
        if (!c) continue;
        const d = Math.hypot(c.lat, c.y - r.y);
        if (d < 9.5) {
          this.setRing(r, 1);
          this.hits++;
          out.push({ type: 'gate', ok: true, text: 'Ring', pts: 250 });
        } else {
          this.setRing(r, 2);
          out.push({ type: 'gate', ok: false, text: 'Missed ring', pts: 0 });
        }
        for (let j = this.next; j < i; j++) this.setRing(this.rings[j], 2);
        this.next = i + 1;
        if (this.next >= this.rings.length) {
          this.done = true;
          out.push({ type: 'finish' });
        }
        break;
      }
      return out;
    }
    if (this.gates) {
      for (let i = this.next; i < Math.min(this.gates.length, this.next + 2); i++) {
        const g = this.gates[i];
        const c = crossing(a, p, g);
        if (!c) continue;
        for (let j = this.next; j < i; j++) {
          this.setGate(this.gates[j], 2);
          this.penalty += 3;
          out.push({ type: 'gate', ok: false, text: 'Missed gate +3 s' });
        }
        if (Math.abs(c.lat) < g.w / 2 + 0.5) {
          this.setGate(g, 1);
          this.hits++;
          if (this.def.kind === 'race') out.push({ type: 'gate', ok: true, text: `Gate ${i + 1}/${this.gates.length}`, split: this.time + this.penalty });
        } else {
          this.setGate(g, 2);
          this.penalty += 3;
          out.push({ type: 'gate', ok: false, text: 'Missed gate +3 s' });
        }
        this.next = i + 1;
        break;
      }
    }
    const c = crossing(a, p, this.finish);
    if (c && Math.abs(c.lat) < this.finish.w / 2 + 6) {
      if (this.gates) {
        for (let j = this.next; j < this.gates.length; j++) {
          this.setGate(this.gates[j], 2);
          this.penalty += 3;
        }
        this.next = this.gates.length;
      }
      this.done = true;
      out.push({ type: 'finish' });
    }
    return out;
  }

  medalFor(value) {
    const m = this.medals;
    if (!m) return null;
    const better = this.def.kind === 'race' ? (a, b) => a <= b : (a, b) => a >= b;
    if (better(value, m[0])) return 'gold';
    if (better(value, m[1])) return 'silver';
    if (better(value, m[2])) return 'bronze';
    return null;
  }
}

export function freeRideStart(field, x, z) {
  // Nudge to a skiable spot and face downhill.
  let best = { x, z };
  let bs = field.slopeDeg(x, z);
  for (let r = 6; r < 80 && bs > 36; r += 6) {
    for (let a = 0; a < 6.28; a += 0.5) {
      const nx = x + Math.cos(a) * r;
      const nz = z + Math.sin(a) * r;
      const s = field.slopeDeg(nx, nz);
      if (s < bs) {
        bs = s;
        best = { x: nx, z: nz };
      }
    }
  }
  const yaw = downhill(field, best.x, best.z, 60);
  return { x: clamp(best.x, -HALF + 150, HALF - 150), z: clamp(best.z, -HALF + 150, HALF - 150), yaw };
}
