// Chase camera: trails the direction of travel, never dips into the snow,
// widens its lens with speed.
import * as THREE from 'three';
import { clamp, lerp, damp } from './util.js';

const _t = new THREE.Vector3();
const _d = new THREE.Vector3();
const _look = new THREE.Vector3();

export class ChaseCam {
  constructor(camera, field) {
    this.camera = camera;
    this.field = field;
    this.dir = new THREE.Vector3(0, 0, 1);
    this.look = new THREE.Vector3();
    this.far = false;
    this.shake = 0;
    this.t = 0;
  }

  snap(rider) {
    this.update(1 / 60, rider, true);
  }

  update(dt, rider, snap = false) {
    this.t += dt;
    const cam = this.camera;
    const sp = rider.speed;
    const mode = rider.mode;
    // Direction to trail
    if (mode === 'wing') _d.copy(rider.vel).normalize();
    else if (sp > 2.5 && mode !== 'crash') _d.set(rider.vel.x, 0, rider.vel.z).normalize();
    else if (mode !== 'crash') _d.set(Math.sin(rider.yaw), 0, Math.cos(rider.yaw));
    else _d.copy(this.dir);
    if (mode !== 'wing') _d.y = 0;
    if (_d.lengthSq() < 1e-6) _d.set(0, 0, 1);
    _d.normalize();
    this.dir.lerp(_d, snap ? 1 : damp(mode === 'wing' ? 2.5 : 3.2, dt)).normalize();

    let dist;
    let height;
    if (mode === 'wing') {
      dist = 7.5 + sp * 0.04;
      height = 1.8;
    } else if (mode === 'chute') {
      dist = 11;
      height = 3.5;
    } else if (mode === 'crash') {
      dist = 8;
      height = 3;
    } else {
      dist = 5.2 + sp * 0.055;
      height = 1.9 + sp * 0.012;
    }
    if (this.far) {
      dist *= 2.1;
      height *= 2.2;
    }
    _t.copy(rider.pos);
    _t.y += mode === 'chute' ? 2.5 : mode === 'crash' ? 0.3 : 1.1;
    const want = _look.copy(_t).addScaledVector(this.dir, -dist);
    want.y += height;
    const g = this.field.height(want.x, want.z) + 1.4;
    if (want.y < g) want.y = g;
    if (mode === 'crash' && !snap) {
      // Hold position, keep watching the tumble.
      cam.position.lerp(want, damp(1.2, dt));
    } else {
      const k = snap ? 1 : damp(mode === 'wing' ? 5 : 7, dt);
      cam.position.lerp(want, k);
    }
    const gy = this.field.height(cam.position.x, cam.position.z) + 1.2;
    if (cam.position.y < gy) cam.position.y = gy;
    const ahead = _t.clone().addScaledVector(this.dir, mode === 'wing' ? 6 : 3.5);
    this.look.lerp(ahead, snap ? 1 : damp(12, dt));
    cam.lookAt(this.look);
    // Speed shake and lens.
    const fast = clamp((sp - 22) / 30);
    this.shake = lerp(this.shake, rider.grounded && mode === 'ski' ? fast : mode === 'wing' ? fast * 0.6 : 0, damp(4, dt));
    if (this.shake > 0.01) {
      const s = this.shake * 0.006;
      cam.rotation.x += Math.sin(this.t * 41) * s;
      cam.rotation.y += Math.sin(this.t * 37 + 1) * s;
    }
    const fov = 58 + clamp((sp - 8) / 45) * 20;
    cam.fov = lerp(cam.fov, fov, snap ? 1 : damp(2, dt));
    cam.updateProjectionMatrix();
  }
}
