// Sky, distant ranges, forest, boulders, the village and its chairlift.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HALF, VILLAGE, SUN_DIR } from './heightfield.js';
import { simplex, rng, smoothstep, clamp, lerp } from './util.js';

export const SKY = {
  zenith: new THREE.Color('#2f6fc0'),
  horizon: new THREE.Color('#d6e4f1'),
  sun: new THREE.Vector3(...SUN_DIR).normalize(),
};

export function createSky() {
  const geo = new THREE.SphereGeometry(11000, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: SKY.zenith },
      horizon: { value: SKY.horizon },
      sunDir: { value: SKY.sun },
    },
    vertexShader: `varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: `uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(horizon, zenith, pow(h, 0.55));
        col = mix(col, horizon * 0.92, smoothstep(0.0, -0.2, d.y));
        float s = max(dot(d, sunDir), 0.0);
        col += vec3(1.0, 0.85, 0.6) * pow(s, 8.0) * 0.25;
        col += vec3(1.0, 0.95, 0.85) * pow(s, 900.0) * 6.0;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = -1;
  return m;
}

/** A ring of far peaks so the horizon is never empty. */
export function createRange(material) {
  const n = simplex(55);
  const A = 560;
  const R = 70;
  const pos = [];
  const bake = [];
  const idx = [];
  const ridged = (x, z) => {
    let s = 0;
    let a = 0.6;
    let f = 1;
    for (let i = 0; i < 4; i++) {
      const r = 1 - Math.abs(n(x * f, z * f));
      s += r * r * a;
      a *= 0.5;
      f *= 2.1;
    }
    return s;
  };
  for (let j = 0; j < R; j++) {
    const t = j / (R - 1);
    const rad = lerp(1400, 11000, Math.pow(t, 1.7));
    for (let i = 0; i < A; i++) {
      const a = (i / A) * Math.PI * 2;
      const x = Math.cos(a) * rad;
      const z = Math.sin(a) * rad;
      const lift = smoothstep(2400, 4600, rad) * (1 - smoothstep(8000, 11000, rad));
      const h = 80 + lift * (450 + 1250 * ridged(x / 2400, z / 2400));
      pos.push(x, h, z);
      bake.push(1, 0, 1);
    }
  }
  for (let j = 0; j < R - 1; j++) {
    for (let i = 0; i < A; i++) {
      const a = j * A + i;
      const b = j * A + ((i + 1) % A);
      const c = a + A;
      const d = b + A;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nr = g.attributes.normal;
  for (let i = 0; i < nr.count; i++) bake[i * 3 + 2] = smoothstep(0.6, 0.78, nr.getY(i));
  g.setAttribute('aBake', new THREE.Float32BufferAttribute(bake, 3));
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = false;
  return m;
}

/** Merge after dropping uvs and indices, which these flat-coloured meshes don't need. */
function merge(parts) {
  return mergeGeometries(
    parts.map((p) => {
      const g = p.index ? p.toNonIndexed() : p;
      if (g.attributes.uv) g.deleteAttribute('uv');
      if (!g.attributes.normal) g.computeVertexNormals();
      return g;
    }),
  );
}

function colorize(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function spruceGeometry() {
  const parts = [colorize(new THREE.CylinderGeometry(0.12, 0.2, 2.2, 6).translate(0, 1.1, 0), '#4a3527')];
  const tiers = [
    [0.9, 2.6, 4.2],
    [2.6, 2.1, 3.6],
    [4.2, 1.6, 3.1],
    [5.6, 1.1, 2.6],
    [6.8, 0.65, 2.0],
  ];
  for (const [y, r, h] of tiers) {
    const g = new THREE.ConeGeometry(r, h, 7, 1).translate(0, y + h / 2, 0).toNonIndexed();
    g.computeVertexNormals();
    // Dark needles with snow on the upward-facing slopes.
    const nrm = g.attributes.normal;
    const col = new Float32Array(nrm.count * 3);
    const dark = new THREE.Color('#1c3326');
    const snow = new THREE.Color('#e9eef5');
    const tmp = new THREE.Color();
    for (let i = 0; i < nrm.count; i++) {
      const k = smoothstep(0.42, 0.62, nrm.getY(i) + ((i * 37) % 11) * 0.012);
      tmp.copy(dark).lerp(snow, k * 0.85);
      col[i * 3] = tmp.r;
      col[i * 3 + 1] = tmp.g;
      col[i * 3 + 2] = tmp.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g);
  }
  return merge(parts);
}

function boulderGeometry() {
  const g = new THREE.DodecahedronGeometry(1, 1);
  const p = g.attributes.position;
  const r = rng(4);
  const n = simplex(8);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 1 + 0.25 * n(x * 1.7 + 3, z * 1.7 + y) + (r() - 0.5) * 0.05;
    p.setXYZ(i, x * k * 1.2, y * k * 0.75, z * k);
  }
  g.computeVertexNormals();
  return colorize(g.toNonIndexed(), '#57524d');
}

/** Spatial hash of round obstacles for collision and near-miss checks. */
export class Obstacles {
  constructor(cell = 16) {
    this.cell = cell;
    this.map = new Map();
  }
  key(i, j) {
    return i * 100003 + j;
  }
  add(o) {
    const i = Math.floor(o.x / this.cell);
    const j = Math.floor(o.z / this.cell);
    const k = this.key(i, j);
    let a = this.map.get(k);
    if (!a) this.map.set(k, (a = []));
    a.push(o);
  }
  near(x, z, out) {
    out.length = 0;
    const i0 = Math.floor(x / this.cell);
    const j0 = Math.floor(z / this.cell);
    for (let j = j0 - 1; j <= j0 + 1; j++) {
      for (let i = i0 - 1; i <= i0 + 1; i++) {
        const a = this.map.get(this.key(i, j));
        if (a) for (const o of a) out.push(o);
      }
    }
    return out;
  }
  density(x, z) {
    const a = this.near(x, z, []);
    return a.length;
  }
}

/** Split instances into a grid of InstancedMeshes so each can be frustum culled. */
function chunked(geo, mat, items, cell = 384, shadows = true) {
  const group = new THREE.Group();
  const buckets = new Map();
  for (const it of items) {
    const k = `${Math.floor(it.x / cell)},${Math.floor(it.z / cell)}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(it);
  }
  for (const list of buckets.values()) {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => {
      mesh.setMatrixAt(i, it.m);
      if (it.c) mesh.setColorAt(i, it.c);
    });
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}

export function createForest(field, obstacles) {
  const n = simplex(21);
  const r = rng(77);
  const geo = spruceGeometry();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
  const max = 9000;
  const items = [];
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let tries = 0;
  while (items.length < max && tries < 200000) {
    tries++;
    const x = (r() * 2 - 1) * (HALF - 40);
    const z = (r() * 2 - 1) * (HALF - 40);
    const h = field.height(x, z);
    const line = 470 + 110 * n(x / 400, z / 400);
    if (h > line) continue;
    const slope = field.slopeDeg(x, z);
    if (slope > 36) continue;
    const d = n(x / 210 + 40, z / 210) * 0.7 + n(x / 60, z / 60) * 0.3;
    const thresh = 0.05 + smoothstep(line - 160, line, h) * 0.5;
    if (d < thresh) continue;
    const vd = Math.hypot(x - VILLAGE.x, z - VILLAGE.z);
    if (vd < VILLAGE.r * 0.9) continue;
    const sc = lerp(0.9, 2.1, r()) * lerp(1, 0.6, smoothstep(line - 200, line, h));
    p.set(x, h - 0.4, z);
    q.setFromAxisAngle(up, r() * 6.28);
    s.set(sc, sc * lerp(0.9, 1.2, r()), sc);
    const m = new THREE.Matrix4().compose(p, q, s);
    const sun = field.sunAt(x, z);
    const v = lerp(0.55, 1.0, sun) * lerp(0.85, 1.1, r());
    items.push({ x, z, m, c: new THREE.Color(v, v, v * 1.04) });
    obstacles.add({ x, z, r: 0.55 * sc + 0.3, top: h + 7.5 * s.y, kind: 'tree' });
  }
  return chunked(geo, mat, items);
}

export function createBoulders(field, obstacles) {
  const n = simplex(31);
  const r = rng(12);
  const geo = boulderGeometry();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  const items = [];
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  let tries = 0;
  while (items.length < 900 && tries < 60000) {
    tries++;
    const x = (r() * 2 - 1) * (HALF - 60);
    const z = (r() * 2 - 1) * (HALF - 60);
    const slope = field.slopeDeg(x, z);
    if (slope < 22 || slope > 44) continue;
    if (n(x / 150, z / 150) < 0.35) continue;
    const h = field.height(x, z);
    if (h < 300) continue;
    const sc = lerp(0.8, 3.2, r() ** 2);
    e.set((r() - 0.5) * 0.4, r() * 6.28, (r() - 0.5) * 0.4);
    q.setFromEuler(e);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, h - sc * 0.25, z), q, new THREE.Vector3(sc, sc, sc));
    items.push({ x, z, m });
    obstacles.add({ x, z, r: sc * 1.05, top: h + sc * 0.6, kind: 'rock' });
  }
  return chunked(geo, mat, items);
}

function chaletGeometry() {
  const parts = [];
  const body = colorize(new THREE.BoxGeometry(10, 6, 8).translate(0, 3, 0), '#6b4a33');
  const base = colorize(new THREE.BoxGeometry(10.4, 1.6, 8.4).translate(0, 0.8, 0), '#8c8780');
  // Pitched roof with deep eaves, snow on top.
  const roof = new THREE.BufferGeometry();
  const w = 6.6;
  const L = 6.0;
  const y0 = 5.6;
  const y1 = 9.2;
  const v = [
    -w, y0, -L, 0, y1, -L, 0, y1, L, -w, y0, -L, 0, y1, L, -w, y0, L,
    w, y0, -L, w, y0, L, 0, y1, L, w, y0, -L, 0, y1, L, 0, y1, -L,
  ];
  roof.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  roof.computeVertexNormals();
  colorize(roof, '#f1f4f8');
  const gable = new THREE.BufferGeometry();
  gable.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-5, 6, 4, 5, 6, 4, 0, 9, 4, 5, 6, -4, -5, 6, -4, 0, 9, -4], 3),
  );
  gable.computeVertexNormals();
  colorize(gable, '#5a3d2a');
  const win = colorize(new THREE.BoxGeometry(1.4, 1.4, 0.2), '#ffd59a');
  const wins = [];
  for (const x of [-3, 0, 3]) {
    wins.push(win.clone().translate(x, 3.4, 4.05));
    wins.push(win.clone().translate(x, 3.4, -4.05));
  }
  const balcony = colorize(new THREE.BoxGeometry(10.6, 0.3, 1.4).translate(0, 4.6, 4.7), '#4d3322');
  parts.push(body, base, roof, gable, balcony, ...wins);
  return merge(parts);
}

export function createVillage(field, obstacles) {
  const group = new THREE.Group();
  const geo = chaletGeometry();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
  const spots = [];
  const r = rng(5);
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2;
    const d = lerp(70, VILLAGE.r * 1.05, Math.sqrt(r()));
    const x = VILLAGE.x + Math.cos(a) * d;
    const z = VILLAGE.z + Math.sin(a) * d * 0.8 + 30;
    if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 22)) continue;
    spots.push({ x, z });
  }
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  spots.forEach((sp, i) => {
    const h = field.height(sp.x, sp.z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.round(r() * 4) * (Math.PI / 2) + (r() - 0.5) * 0.3);
    const sc = lerp(0.8, 1.3, r());
    s.set(sc, sc, sc);
    m.compose(new THREE.Vector3(sp.x, h - 0.5, sp.z), q, s);
    mesh.setMatrixAt(i, m);
    obstacles.add({ x: sp.x, z: sp.z, r: 6.5 * sc, top: h + 9 * sc, kind: 'chalet' });
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

/** A fixed-grip chairlift from the village up the lower mountain, chairs moving. */
export function createLift(field) {
  const group = new THREE.Group();
  const a = new THREE.Vector3(VILLAGE.x - 40, 0, VILLAGE.z - 150);
  const b = new THREE.Vector3(-330, 0, 150);
  a.y = field.height(a.x, a.z);
  b.y = field.height(b.x, b.z);
  const dir = new THREE.Vector3().subVectors(b, a).setY(0);
  const len = dir.length();
  dir.normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  const steel = new THREE.MeshStandardMaterial({ color: '#7d8590', roughness: 0.5, metalness: 0.6 });
  const towerGeo = new THREE.CylinderGeometry(0.35, 0.5, 1, 8);
  const armGeo = new THREE.BoxGeometry(7, 0.4, 0.5);
  const nT = Math.ceil(len / 110);
  const cable = [];
  for (let i = 0; i <= nT; i++) {
    const t = i / nT;
    const x = lerp(a.x, b.x, t);
    const z = lerp(a.z, b.z, t);
    const g = field.height(x, z);
    const top = g + (i === 0 || i === nT ? 7 : 13);
    const tower = new THREE.Mesh(towerGeo, steel);
    tower.scale.y = top - g + 1;
    tower.position.set(x, g + (top - g) / 2 - 0.5, z);
    tower.castShadow = true;
    const arm = new THREE.Mesh(armGeo, steel);
    arm.position.set(x, top, z);
    arm.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI / 2;
    group.add(tower, arm);
    cable.push(new THREE.Vector3(x, top - 0.3, z));
  }
  const pts = [];
  for (const sgn of [-1, 1]) {
    for (let i = 0; i < cable.length - 1; i++) {
      pts.push(cable[i].clone().addScaledVector(side, sgn * 3.3), cable[i + 1].clone().addScaledVector(side, sgn * 3.3));
    }
  }
  const lines = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: '#3a3f46' }),
  );
  group.add(lines);
  // Chairs
  const chairGeo = merge([
    new THREE.BoxGeometry(0.08, 2.2, 0.08).translate(0, -1.1, 0),
    new THREE.BoxGeometry(1.8, 0.12, 0.6).translate(0, -2.2, 0.1),
    new THREE.BoxGeometry(1.8, 0.7, 0.1).translate(0, -1.85, -0.2),
  ]);
  const chairMat = new THREE.MeshStandardMaterial({ color: '#c33d2b', roughness: 0.6 });
  const nChairs = Math.floor((len * 2) / 28);
  const chairs = new THREE.InstancedMesh(chairGeo, chairMat, nChairs);
  chairs.castShadow = true;
  group.add(chairs);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dir.x, dir.z));
  const qb = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-dir.x, -dir.z));
  const s = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  const along = (u, sgn) => {
    const f = clamp(u) * (cable.length - 1);
    const i = Math.min(cable.length - 2, Math.floor(f));
    p.lerpVectors(cable[i], cable[i + 1], f - i).addScaledVector(side, sgn * 3.3);
    p.y -= Math.sin((f - i) * Math.PI) * 1.5;
    return p;
  };
  function update(t) {
    for (let c = 0; c < nChairs; c++) {
      let u = ((t * 2.3) / (len * 2) + c / nChairs) % 1;
      const upHill = u < 0.5;
      u = upHill ? u * 2 : 2 - u * 2;
      along(u, upHill ? 1 : -1);
      m.compose(p, upHill ? q : qb, s);
      chairs.setMatrixAt(c, m);
    }
    chairs.instanceMatrix.needsUpdate = true;
  }
  update(0);
  return { group, update };
}
