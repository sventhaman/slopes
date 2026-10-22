// Rider physics. Modes:
//   ski    carving on the snow or airborne off it (spins, flips, grabs)
//   wing   wingsuit flight
//   chute  under canopy, lands back on skis
//   crash  tumbling ragdoll until it settles
import * as THREE from 'three';
import { clamp, lerp, damp } from './util.js';
import { HALF } from './heightfield.js';

const G = 9.81;
const GRAV = new THREE.Vector3(0, -G, 0);
const UP = new THREE.Vector3(0, 1, 0);
const STICK = 0.07;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _n = [0, 0, 0];
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

export class Rider {
  constructor(field, obstacles) {
    this.field = field;
    this.obstacles = obstacles;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.normal = new THREE.Vector3(0, 1, 0);
    this.quat = new THREE.Quaternion();
    this.near = [];
    this.history = [];
    this.histT = 0;
    this.reset(new THREE.Vector3(0, 0, 0), 0, 'ski');
  }

  reset(pos, yaw, mode = 'ski', speed = 0) {
    this.mode = mode;
    this.pos.copy(pos);
    this.yaw = yaw;
    this.vel.set(Math.sin(yaw) * speed, 0, Math.cos(yaw) * speed);
    this.grounded = mode === 'ski';
    if (this.grounded) this.pos.y = this.field.height(pos.x, pos.z);
    this.air = 0;
    this.spin = 0;
    this.flip = 0;
    this.spinRate = 0;
    this.flipRate = 0;
    this.grab = 0;
    this.grabTime = 0;
    this.grabKind = 0;
    this.charge = 0;
    this.lean = 0;
    this.pitch = mode === 'wing' ? -0.3 : 0;
    this.roll = 0;
    this.chuteT = 0;
    this.crashT = 0;
    this.crashReason = '';
    this.spray = 0;
    this.brake = 0;
    this.tuck = 0;
    this.clearance = 0;
    this.prevSteer = 0;
    this.nearMissed = new Set();
    this.angVel = new THREE.Vector3();
    this.tumble = null;
    this.settled = false;
    this.impact = 0;
    this.wingSpeed = speed;
    this.takeoffUp = new THREE.Vector3(0, 1, 0);
    this.latch = { steer: false, fwd: false, back: false };
    this.lastInp = null;
    this.history.length = 0;
    this.histT = 0;
    this.field.normal(this.pos.x, this.pos.z, _n);
    this.normal.set(_n[0], _n[1], _n[2]);
    this.updateQuat(1);
  }

  get speed() {
    return this.vel.length();
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** Advance by dt seconds. Returns a list of events for scoring and effects. */
  step(dt, inp) {
    const events = [];
    const sub = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      if (this.mode === 'ski') this.stepSki(h, inp, events);
      else if (this.mode === 'wing') this.stepWing(h, inp, events);
      else if (this.mode === 'chute') this.stepChute(h, inp, events);
      else this.stepCrash(h, events);
      inp = { ...inp, jumpPressed: false, jumpReleased: false, wingPressed: false };
    }
    this.bounds();
    this.updateQuat(dt);
    this.record(dt);
    return events;
  }

  bounds() {
    const lim = HALF - 20;
    if (Math.abs(this.pos.x) > lim || Math.abs(this.pos.z) > lim) {
      this.pos.x = clamp(this.pos.x, -lim, lim);
      this.pos.z = clamp(this.pos.z, -lim, lim);
      this.vel.multiplyScalar(0.5);
    }
  }

  groundAt(x, z) {
    this.field.normal(x, z, _n);
    return this.field.height(x, z);
  }

  stepSki(dt, inp, events) {
    if (this.grounded) this.lastInp = inp;
    const f = this.forward(_v);
    const steer = inp.steer;
    if (this.grounded) {
      this.groundAt(this.pos.x, this.pos.z);
      const n = this.normal.set(_n[0], _n[1], _n[2]);
      // Ski direction on the slope plane, and the edge direction.
      f.addScaledVector(n, -f.dot(n)).normalize();
      const s = _w.crossVectors(n, f).normalize();
      this.vel.addScaledVector(GRAV, dt);
      const speed = this.vel.length();
      this.tuck = lerp(this.tuck, inp.fwd > 0.2 && speed > 4 ? 1 : 0, damp(8, dt));
      this.brake = lerp(this.brake, inp.back > 0.2 ? 1 : 0, damp(10, dt));
      // Turning: quick at low speed, longer arcs when fast.
      const rate = speed < 3 ? 2.4 : lerp(2.5, 1.35, clamp(speed / 38)) * (1 - this.tuck * 0.35);
      const yawRate = -steer * rate;
      this.yaw += yawRate * dt;
      // Carve: lateral velocity is redirected along the ski, a little is lost to the skid.
      const vf = this.vel.dot(f);
      const vs = this.vel.dot(s);
      const grip = lerp(7.5, 2.2, this.brake);
      const vsNew = vs * Math.exp(-grip * dt);
      const lost = vs * vs - vsNew * vsNew;
      const keep = lerp(0.82, 0.0, this.brake);
      const sign = vf < 0 ? -1 : 1;
      const vfNew = sign * Math.sqrt(Math.max(0, vf * vf + lost * keep));
      this.vel.copy(f).multiplyScalar(vfNew).addScaledVector(s, vsNew);
      // Friction, drag and the hockey-stop brake.
      const sp = this.vel.length();
      const drag = lerp(0.0046, 0.0027, this.tuck);
      const decel = 0.04 * G * n.y + drag * sp * sp + this.brake * 7.5;
      if (sp > 1e-4) this.vel.multiplyScalar(Math.max(0, sp - decel * dt) / sp);
      // Skating on the flat.
      if (inp.fwd > 0.2 && sp < 8) this.vel.addScaledVector(f, 3.2 * dt * sign);
      this.spray = clamp(Math.abs(vs) * 0.18 + this.brake * sp * 0.08 + Math.abs(steer) * sp * 0.01);
      this.lean = lerp(this.lean, clamp(-yawRate * sp / G, -0.85, 0.85) * (1 - this.brake * 0.6), damp(8, dt));
      // Jump: hold to load, release to pop.
      if (inp.jump) this.charge = Math.min(1, this.charge + dt * 2.2);
      if (inp.jumpReleased && this.charge > 0) {
        this.vel.addScaledVector(n, 2.6 + this.charge * 3.4);
        this.pos.addScaledVector(n, STICK * 2);
        this.charge = 0;
        this.takeoff(n, events, true);
      }
      this.pos.addScaledVector(this.vel, dt);
      if (this.grounded) {
        const nh = this.groundAt(this.pos.x, this.pos.z);
        this.normal.set(_n[0], _n[1], _n[2]);
        if (this.pos.y <= nh + STICK) {
          this.pos.y = nh;
          const vn = this.vel.dot(this.normal);
          if (vn < 0 || this.pos.y - nh < STICK) this.vel.addScaledVector(this.normal, -vn);
        } else {
          this.takeoff(this.normal, events, false);
        }
      }
      this.collide(events);
      return;
    }

    // Airborne
    this.air += dt;
    this.vel.addScaledVector(GRAV, dt);
    const sp = this.vel.length();
    this.vel.multiplyScalar(1 - 0.0025 * sp * dt);
    // Inputs still held from the ground don't start tricks: let go and press again.
    const L = this.latch;
    if (L.steer && Math.abs(steer) < 0.2) L.steer = false;
    if (L.fwd && inp.fwd < 0.2) L.fwd = false;
    if (L.back && inp.back < 0.2) L.back = false;
    const tSteer = L.steer ? 0 : steer;
    const tFlip = (L.back ? 0 : inp.back) - (L.fwd ? 0 : inp.fwd);
    this.spinRate = lerp(this.spinRate, -tSteer * 7.2, damp(9, dt));
    this.flipRate = lerp(this.flipRate, tFlip * 6.2, damp(9, dt));
    this.yaw += this.spinRate * dt;
    this.spin += this.spinRate * dt;
    this.flip += this.flipRate * dt;
    this.grab = inp.grab ? 1 : 0;
    if (inp.grab) {
      this.grabTime += dt;
      if (this.grabTime < dt * 1.5) this.grabKind = inp.fwd > 0.3 ? 2 : inp.back > 0.3 ? 1 : 0;
    }
    this.lean = lerp(this.lean, 0, damp(4, dt));
    this.spray = 0;
    this.tuck = lerp(this.tuck, 0, damp(6, dt));
    this.pos.addScaledVector(this.vel, dt);
    const gh = this.groundAt(this.pos.x, this.pos.z);
    this.clearance = this.pos.y - gh;
    if (inp.wingPressed && this.clearance > 18) {
      this.toWing(events);
      return;
    }
    if (this.pos.y <= gh) {
      this.pos.y = gh;
      this.normal.set(_n[0], _n[1], _n[2]);
      this.land(events);
      return;
    }
    this.collide(events);
  }

  takeoff(n, events, ollie) {
    const inp = this.lastInp || {};
    this.latch = { steer: Math.abs(inp.steer || 0) > 0.2, fwd: (inp.fwd || 0) > 0.2, back: (inp.back || 0) > 0.2 };
    this.grounded = false;
    this.air = 0;
    this.spin = 0;
    this.flip = 0;
    this.grabTime = 0;
    this.takeoffUp.copy(n);
    events.push({ type: 'takeoff', ollie });
  }

  /** Body up vector in the air: yaw about world up, then the flip. */
  bodyUp(out) {
    _q.setFromAxisAngle(Y, this.yaw);
    _q2.setFromAxisAngle(X, this.flip);
    _q.multiply(_q2);
    return out.copy(Y).applyQuaternion(_q);
  }

  land(events) {
    const n = this.normal;
    const vn = this.vel.dot(n);
    const impact = Math.max(0, -vn);
    const up = this.bodyUp(new THREE.Vector3());
    const upDot = up.dot(n);
    const vt = this.vel.clone().addScaledVector(n, -vn);
    const spT = vt.length();
    const f = this.forward(new THREE.Vector3()).addScaledVector(n, -this.forward(_w).dot(n)).normalize();
    const align = spT > 3 ? Math.abs(f.dot(vt) / spT) : 1;
    const air = this.air;
    const flips = Math.round(this.flip / (Math.PI * 2));
    const flipErr = Math.abs(this.flip - flips * Math.PI * 2);
    let reason = '';
    if (upDot < 0.45 || flipErr > 1.0) reason = 'Over-rotated';
    else if (align < 0.6) reason = 'Landed sideways';
    else if (impact > 19.5) reason = 'Too big a drop';
    else if (this.grab && air > 0.5) reason = 'Still grabbing';
    if (reason && air > 0.25) {
      this.crash(reason, events);
      return;
    }
    const sw = spT > 3 && f.dot(vt) < 0;
    const quality = air < 0.35 ? 'none' : upDot > 0.93 && align > 0.96 && flipErr < 0.35 ? 'perfect' : upDot > 0.75 && align > 0.82 ? 'clean' : 'sketchy';
    events.push({
      type: 'land',
      air,
      spin: this.spin,
      flip: this.flip,
      grabTime: this.grabTime,
      grabKind: this.grabKind,
      quality,
      switch: sw,
      impact,
    });
    // Settle onto the slope.
    this.vel.copy(vt).multiplyScalar(1 - clamp(impact / 45) * 0.6);
    if (spT > 0.5) {
      const dir = sw ? vt.clone().negate() : vt;
      this.yaw = Math.atan2(dir.x, dir.z);
    }
    this.grounded = true;
    this.flip = 0;
    this.spin = 0;
    this.spinRate = 0;
    this.flipRate = 0;
    this.grab = 0;
    this.grabTime = 0;
    this.air = 0;
    this.impact = impact;
  }

  collide(events) {
    const o = this.obstacles.near(this.pos.x, this.pos.z, this.near);
    const sp = this.vel.length();
    for (const ob of o) {
      if (this.pos.y > ob.top) continue;
      const d = Math.hypot(this.pos.x - ob.x, this.pos.z - ob.z);
      if (d < ob.r + 0.3) {
        this.crash(ob.kind === 'tree' ? 'Hit a tree' : ob.kind === 'rock' ? 'Hit a rock' : 'Hit a chalet', events);
        return;
      }
      if (d < ob.r + 2.4 && sp > 14 && !this.nearMissed.has(ob)) {
        this.nearMissed.add(ob);
        events.push({ type: 'nearmiss', kind: ob.kind });
      }
    }
  }

  toWing(events) {
    const sp = Math.max(22, this.vel.length());
    this.mode = 'wing';
    this.pitch = clamp(Math.asin(clamp(this.vel.y / Math.max(1, this.vel.length()), -1, 1)), -1.2, 0.1);
    this.yaw = Math.atan2(this.vel.x, this.vel.z);
    this.wingSpeed = sp;
    this.roll = 0;
    this.spin = 0;
    this.flip = 0;
    this.grab = 0;
    events.push({ type: 'wing' });
  }

  stepWing(dt, inp, events) {
    let sp = this.wingSpeed;
    // Pitch: dive (forward), flare (back), otherwise trim to best glide.
    let target = inp.fwd > 0.1 ? lerp(-0.42, -1.15, inp.fwd) : inp.back > 0.1 ? lerp(-0.42, 0.2, inp.back) : -0.42;
    if (sp < 17) target = Math.min(target, -0.9);
    this.pitch = lerp(this.pitch, target, damp(2.6, dt));
    this.roll = lerp(this.roll, -inp.steer * 0.95, damp(3.2, dt));
    sp += (-G * Math.sin(this.pitch) - 0.0021 * sp * sp) * dt;
    sp = Math.max(8, sp);
    this.wingSpeed = sp;
    this.yaw += (Math.tan(this.roll) * G / Math.max(sp, 14)) * 1.6 * dt;
    const cp = Math.cos(this.pitch);
    this.vel.set(Math.sin(this.yaw) * cp * sp, Math.sin(this.pitch) * sp, Math.cos(this.yaw) * cp * sp);
    this.pos.addScaledVector(this.vel, dt);
    const gh = this.groundAt(this.pos.x, this.pos.z);
    this.normal.set(_n[0], _n[1], _n[2]);
    this.clearance = this.pos.y - gh;
    if (this.clearance < 0.9) {
      this.pos.y = gh + 0.9;
      this.crash('Hit the mountain', events);
      return;
    }
    if (inp.jumpPressed) {
      this.mode = 'chute';
      this.chuteT = 0;
      events.push({ type: 'chute' });
      return;
    }
    this.collide(events);
  }

  stepChute(dt, inp, events) {
    this.chuteT += dt;
    const k = damp(this.chuteT < 1.2 ? 2.2 : 4, dt);
    const fwd = lerp(10, 5, clamp(inp.back));
    const sink = lerp(-4.8, -3.2, clamp(inp.back));
    this.yaw += -inp.steer * 0.9 * dt;
    this.roll = lerp(this.roll, -inp.steer * 0.35, damp(3, dt));
    const f = this.forward(_v);
    _w.copy(f).multiplyScalar(fwd);
    _w.y = sink;
    this.vel.lerp(_w, k);
    this.pos.addScaledVector(this.vel, dt);
    const gh = this.groundAt(this.pos.x, this.pos.z);
    this.normal.set(_n[0], _n[1], _n[2]);
    this.clearance = this.pos.y - gh;
    if (this.pos.y <= gh) {
      this.pos.y = gh;
      this.mode = 'ski';
      this.grounded = true;
      this.vel.addScaledVector(this.normal, -this.vel.dot(this.normal));
      this.roll = 0;
      this.pitch = 0;
      events.push({ type: 'chuteland' });
      return;
    }
    this.collide(events);
  }

  crash(reason, events) {
    if (this.mode === 'crash') return;
    this.mode = 'crash';
    this.crashReason = reason;
    this.crashT = 0;
    this.grounded = false;
    const sp = this.vel.length();
    this.vel.multiplyScalar(reason.startsWith('Hit a') || reason === 'Hit the mountain' ? -0.15 : 0.65);
    this.angVel.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2).multiplyScalar(4 + sp * 0.2);
    this.spray = 0;
    events.push({ type: 'crash', reason, speed: sp });
  }

  stepCrash(dt, events) {
    this.crashT += dt;
    this.vel.addScaledVector(GRAV, dt);
    this.pos.addScaledVector(this.vel, dt);
    const gh = this.groundAt(this.pos.x, this.pos.z) + 0.25;
    this.normal.set(_n[0], _n[1], _n[2]);
    if (this.pos.y < gh) {
      this.pos.y = gh;
      const vn = this.vel.dot(this.normal);
      if (vn < 0) this.vel.addScaledVector(this.normal, -vn * 1.35);
      const sp = this.vel.length();
      const fr = 4.5 * dt;
      if (sp > 0) this.vel.multiplyScalar(Math.max(0, sp - fr * (2 + sp * 0.4)) / sp);
      this.angVel.multiplyScalar(1 - clamp(2.5 * dt));
      this.spray = clamp(sp * 0.05);
    } else this.spray = 0;
    // Integrate the tumble.
    const w = this.angVel.length();
    if (w > 1e-4) {
      _q.setFromAxisAngle(_w.copy(this.angVel).divideScalar(w), w * dt);
      this.tumble = (this.tumble || new THREE.Quaternion()).premultiply(_q);
    }
    if (!this.settled && ((this.crashT > 1.2 && this.vel.length() < 1.5) || this.crashT > 4)) {
      this.settled = true;
      events.push({ type: 'settled' });
    }
  }

  /** Orientation for the rider model. */
  updateQuat(dt) {
    const target = _q;
    if (this.mode === 'ski' && this.grounded) {
      const f = this.forward(_v).addScaledVector(this.normal, -this.forward(_w).dot(this.normal)).normalize();
      const x = _w.crossVectors(this.normal, f).normalize();
      _m.makeBasis(x, this.normal, f);
      target.setFromRotationMatrix(_m);
      this.quat.slerp(target, damp(20, dt));
    } else if (this.mode === 'ski') {
      target.setFromAxisAngle(Y, this.yaw);
      _q2.setFromAxisAngle(X, this.flip);
      target.multiply(_q2);
      this.quat.slerp(target, damp(30, dt));
    } else if (this.mode === 'wing') {
      // Head along the flight path, belly down, banked by roll.
      const fwd = _v.copy(this.vel).normalize();
      const down = new THREE.Vector3(0, -1, 0).addScaledVector(fwd, fwd.y).normalize();
      const x = _w.crossVectors(fwd, down).normalize();
      _m.makeBasis(x, fwd, down);
      target.setFromRotationMatrix(_m);
      _q2.setFromAxisAngle(Y, -this.roll);
      target.multiply(_q2);
      this.quat.slerp(target, damp(6, dt));
    } else if (this.mode === 'chute') {
      target.setFromAxisAngle(Y, this.yaw);
      _q2.setFromAxisAngle(Z, this.roll);
      target.multiply(_q2);
      this.quat.slerp(target, damp(3, dt));
    } else if (this.mode === 'crash') {
      if (!this.tumble) this.tumble = this.quat.clone();
      this.quat.copy(this.tumble);
    }
  }

  // Rewind support: a snapshot every 0.1 s for the last 12 s.
  record(dt) {
    if (this.mode === 'crash') return;
    this.histT += dt;
    if (this.histT < 0.1) return;
    this.histT = 0;
    this.history.push({
      mode: this.mode,
      pos: this.pos.clone(),
      vel: this.vel.clone(),
      yaw: this.yaw,
      grounded: this.grounded,
      pitch: this.pitch,
      roll: this.roll,
      wingSpeed: this.wingSpeed,
      chuteT: this.chuteT,
      flip: this.flip,
      spin: this.spin,
      air: this.air,
      quat: this.quat.clone(),
    });
    if (this.history.length > 120) this.history.shift();
  }

  canRewind() {
    return this.history.length > 2;
  }

  /** Jump back about `sec` seconds to a safe moment. Returns true if it did. */
  rewind(sec = 3) {
    if (!this.history.length) return false;
    const back = Math.round(sec / 0.1);
    let i = Math.max(0, this.history.length - back);
    // Prefer a moment on the ground or under canopy.
    for (let j = i; j >= 0; j--) {
      const s = this.history[j];
      if (s.grounded || s.mode !== 'ski') {
        i = j;
        break;
      }
    }
    const s = this.history[i];
    this.history.length = i;
    this.mode = s.mode;
    this.pos.copy(s.pos);
    this.vel.copy(s.vel);
    this.yaw = s.yaw;
    this.grounded = s.grounded;
    this.pitch = s.pitch;
    this.roll = s.roll;
    this.wingSpeed = s.wingSpeed;
    this.chuteT = s.chuteT;
    this.flip = s.flip;
    this.spin = s.spin;
    this.air = s.air;
    this.quat.copy(s.quat);
    this.tumble = null;
    this.settled = false;
    this.crashT = 0;
    this.spinRate = 0;
    this.flipRate = 0;
    this.grab = 0;
    this.grabTime = 0;
    this.charge = 0;
    return true;
  }
}
