// Snow spray particles and ski tracks.
import * as THREE from 'three';
import { puffTexture } from './textures.js';

export class Spray {
  constructor(max = 2400) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max).fill(1e9);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.head = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { tex: { value: puffTexture() }, scale: { value: 600 } },
      vertexShader: `attribute float aSize; attribute float aAlpha; uniform float scale; varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * scale / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
          vA = aAlpha;
        }`,
      fragmentShader: `uniform sampler2D tex; varying float vA;
        void main() {
          vec4 c = texture2D(tex, gl_PointCoord);
          gl_FragColor = vec4(vec3(0.97, 0.98, 1.0), c.a * vA);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.geo = g;
    this.acc = 0;
  }

  emit(x, y, z, vx, vy, vz, size, life) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.age[i] = 0;
    this.size[i] = size;
  }

  /** Continuous spray from the skis; amount 0..1. */
  spray(dt, p, vel, side, amount) {
    this.acc += dt * Math.min(amount, 0.8) * 220;
    while (this.acc >= 1) {
      this.acc -= 1;
      const s = (Math.random() - 0.5) * 1.2;
      const k = 0.35 + Math.random() * 0.4;
      this.emit(
        p.x + side.x * s + (Math.random() - 0.5) * 0.4,
        p.y + 0.1,
        p.z + side.z * s + (Math.random() - 0.5) * 0.4,
        vel.x * k + side.x * (Math.random() - 0.5) * 6 + (Math.random() - 0.5) * 1.5,
        1.2 + Math.random() * 2.8 * amount,
        vel.z * k + side.z * (Math.random() - 0.5) * 6 + (Math.random() - 0.5) * 1.5,
        0.3 + Math.random() * 0.45,
        0.45 + Math.random() * 0.6,
      );
    }
  }

  burst(p, vel, n, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 4 * power;
      this.emit(
        p.x + Math.cos(a) * 0.5,
        p.y + 0.2,
        p.z + Math.sin(a) * 0.5,
        vel.x * 0.4 + Math.cos(a) * r,
        1 + Math.random() * 3.5 * power,
        vel.z * 0.4 + Math.sin(a) * r,
        0.5 + Math.random() * 0.7 * power,
        0.6 + Math.random() * 0.8,
      );
    }
  }

  update(dt) {
    const drag = Math.exp(-2.2 * dt);
    for (let i = 0; i < this.max; i++) {
      const a = (this.age[i] += dt);
      if (a > this.life[i]) {
        this.alpha[i] = 0;
        continue;
      }
      const k = i * 3;
      this.vel[k] *= drag;
      this.vel[k + 1] = this.vel[k + 1] * drag - 5.5 * dt;
      this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const t = a / this.life[i];
      this.alpha[i] = (1 - t) * Math.min(1, a * 12) * 0.85;
      this.size[i] += dt * 0.7;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

/** A groove pressed into the snow behind one ski. */
export class Track {
  constructor(n = 900) {
    this.n = n;
    this.pos = new Float32Array(n * 2 * 3);
    this.alpha = new Float32Array(n * 2);
    this.head = 0;
    this.last = null;
    this.drawing = false;
    const idx = [];
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      const b = ((i + 1) % n) * 2;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
      uniforms: { color: { value: new THREE.Color('#9fb3cf') } },
      vertexShader: `attribute float aAlpha; varying float vA;
        void main() { vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 color; varying float vA;
        void main() { gl_FragColor = vec4(color, vA * 0.55);
        #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.geo = g;
  }

  /** Add a point (ground position, side vector, half width) or break the line. */
  add(p, side, hw, on) {
    if (!on) {
      // Cap the line with an invisible point so no ribbon spans the gap.
      if (this.drawing) this.write(this.last, side, 0, 0);
      this.drawing = false;
      return;
    }
    if (this.drawing && this.last.distanceToSquared(p) < 0.36) return;
    this.write(p, side, hw, this.drawing ? 1 : 0);
    this.drawing = true;
    this.last = (this.last || new THREE.Vector3()).copy(p);
  }

  write(p, side, hw, a) {
    const i = this.head;
    this.head = (this.head + 1) % this.n;
    const k = i * 6;
    this.pos[k] = p.x + side.x * hw;
    this.pos[k + 1] = p.y + 0.03;
    this.pos[k + 2] = p.z + side.z * hw;
    this.pos[k + 3] = p.x - side.x * hw;
    this.pos[k + 4] = p.y + 0.03;
    this.pos[k + 5] = p.z - side.z * hw;
    this.alpha[i * 2] = a;
    this.alpha[i * 2 + 1] = a;
    // The slot after the head holds the oldest point; hide the joint back to it.
    this.alpha[this.head * 2] = 0;
    this.alpha[this.head * 2 + 1] = 0;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }

  clear() {
    this.alpha.fill(0);
    this.drawing = false;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}
