// Terrain mesh: 12 x 12 chunks, each built at three levels of detail with
// skirts to hide cracks. Snow and rock are blended per pixel by slope; the
// baked sun term darkens faces in the shadow of other peaks.
import * as THREE from 'three';
import { HALF, CELLS, STEP, VERTS } from './heightfield.js';
import { noiseTexture } from './textures.js';

const CHUNK = 64;
const NC = CELLS / CHUNK;
const LODS = [1, 2, 4];
const LOD_DIST = [520, 1300];

export function createTerrainMaterial() {
  const tNoise = noiseTexture();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tNoise = { value: tNoise };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 aBake;\nvarying vec3 vWP;\nvarying vec3 vWN;\nvarying vec3 vBake;',
      )
      .replace(
        '#include <fog_vertex>',
        '#include <fog_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);\nvBake = aBake;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D tNoise;
        varying vec3 vWP;
        varying vec3 vWN;
        varying vec3 vBake;
        float vSunVis;
        vec3 perturbSnow(vec3 p, vec3 n, vec2 dH, float face) {
          vec3 sx = dFdx(p);
          vec3 sy = dFdy(p);
          vec3 r1 = cross(sy, n);
          vec3 r2 = cross(n, sx);
          float det = dot(sx, r1) * face;
          vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
          return normalize(abs(det) * n - grad);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float n1 = texture2D(tNoise, vWP.xz / 41.0).r;
        float n2 = texture2D(tNoise, vWP.xz / 230.0).g;
        float n3 = texture2D(tNoise, vWP.xz / 3.7).b;
        float up = normalize(vWN).y;
        float snow = smoothstep(0.32, 0.6, vBake.z + (n1 - 0.5) * 0.55 + (n2 - 0.5) * 0.35) * smoothstep(0.45, 0.6, up + (n3 - 0.5) * 0.08);
        vec2 strata = vec2(vWP.x * 0.6 + vWP.z * 0.4, vWP.y * 2.6);
        float rn = texture2D(tNoise, strata / 37.0).r * 0.6 + texture2D(tNoise, vWP.xz / 9.0).g * 0.4;
        vec3 rock = mix(vec3(0.20, 0.185, 0.18), vec3(0.42, 0.39, 0.36), rn);
        // Snow caught on ledges.
        rock = mix(rock, vec3(0.85, 0.88, 0.93), smoothstep(0.55, 0.62, up + (n3 - 0.5) * 0.2) * 0.7);
        vec3 snowC = vec3(0.93, 0.95, 0.99) * (0.95 + 0.05 * n3);
        diffuseColor.rgb = mix(rock, snowC, snow);
        vSunVis = vBake.x;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // Wind-packed ripples and grain in the snow, faded out with distance.
          float fade = smoothstep(80.0, 15.0, length(vViewPosition));
          if (fade > 0.0) {
            float b1 = texture2D(tNoise, vWP.xz / 2.3).r;
            float b2 = texture2D(tNoise, vWP.xz / 0.55 + 0.37).g;
            float b3 = texture2D(tNoise, vec2(vWP.x * 0.12 + vWP.z * 0.05, vWP.z * 0.5) / 1.4).b;
            float H = (b1 * 0.07 + b2 * 0.006 * fade + b3 * 0.05 * snow) * fade;
            normal = perturbSnow(-vViewPosition, normal, vec2(dFdx(H), dFdy(H)), faceDirection);
          }
        }`,
      )
      .replace(
        '#include <lights_fragment_begin>',
        THREE.ShaderChunk.lights_fragment_begin.replace(
          'getDirectionalLightInfo( directionalLight, directLight );',
          'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= vSunVis;',
        ),
      );
  };
  return mat;
}

function buildChunk(field, ci, cj, step) {
  const n = CHUNK / step;
  const gv = n + 1;
  const skirt = 4 * gv;
  const count = gv * gv + skirt;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const bake = new Float32Array(count * 3);
  const idx = [];
  const i0 = ci * CHUNK;
  const j0 = cj * CHUNK;
  const put = (v, i, j, drop) => {
    const k = j * VERTS + i;
    pos[v * 3] = -HALF + i * STEP;
    pos[v * 3 + 1] = field.h[k] - drop;
    pos[v * 3 + 2] = -HALF + j * STEP;
    nor[v * 3] = field.nrm[k * 3];
    nor[v * 3 + 1] = field.nrm[k * 3 + 1];
    nor[v * 3 + 2] = field.nrm[k * 3 + 2];
    bake[v * 3] = field.sun[k];
    bake[v * 3 + 1] = field.expo[k];
    bake[v * 3 + 2] = field.cover[k];
  };
  for (let b = 0; b < gv; b++) {
    for (let a = 0; a < gv; a++) put(b * gv + a, i0 + a * step, j0 + b * step, 0);
  }
  for (let b = 0; b < n; b++) {
    for (let a = 0; a < n; a++) {
      const v00 = b * gv + a;
      const v10 = v00 + 1;
      const v01 = v00 + gv;
      const v11 = v01 + 1;
      idx.push(v00, v11, v10, v00, v01, v11);
    }
  }
  // Skirts: a curtain hanging below each edge.
  let s = gv * gv;
  const edge = (list) => {
    const start = s;
    for (const [a, b] of list) put(s++, i0 + a * step, j0 + b * step, 12 * step);
    for (let e = 0; e < list.length - 1; e++) {
      const [a, b] = list[e];
      const [a2, b2] = list[e + 1];
      const t0 = b * gv + a;
      const t1 = b2 * gv + a2;
      const d0 = start + e;
      const d1 = start + e + 1;
      idx.push(t0, d0, t1, t1, d0, d1, t0, t1, d0, t1, d1, d0);
    }
  };
  const top = [];
  const bot = [];
  const lef = [];
  const rig = [];
  for (let a = 0; a < gv; a++) {
    top.push([a, 0]);
    bot.push([a, n]);
    lef.push([0, a]);
    rig.push([n, a]);
  }
  edge(top);
  edge(bot);
  edge(lef);
  edge(rig);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aBake', new THREE.BufferAttribute(bake, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export function createTerrain(field) {
  const material = createTerrainMaterial();
  const group = new THREE.Group();
  const chunks = [];
  for (let cj = 0; cj < NC; cj++) {
    for (let ci = 0; ci < NC; ci++) {
      const lods = LODS.map((s) => buildChunk(field, ci, cj, s));
      const mesh = new THREE.Mesh(lods[0], material);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      mesh.matrixAutoUpdate = false;
      const c = new THREE.Vector3();
      lods[0].boundingBox.getCenter(c);
      chunks.push({ mesh, lods, center: c, lod: 0 });
      group.add(mesh);
    }
  }
  function update(cam) {
    for (const ch of chunks) {
      const d = Math.hypot(cam.x - ch.center.x, cam.z - ch.center.z, (cam.y - ch.center.y) * 0.5);
      const l = d < LOD_DIST[0] ? 0 : d < LOD_DIST[1] ? 1 : 2;
      if (l !== ch.lod) {
        ch.lod = l;
        ch.mesh.geometry = ch.lods[l];
      }
    }
  }
  return { group, update, material };
}
