// The rider: a jointed figure with skis, poles, a wingsuit and a canopy.
// Local frame: +z is forward, +y up, feet centred on the origin.
import * as THREE from 'three';
import { clamp, lerp, damp } from './util.js';

const L_THIGH = 0.46;
const L_SHIN = 0.46;
const L_UPPER = 0.29;
const L_FORE = 0.27;

const PALETTE = {
  jacket: '#f2622e',
  jacket2: '#ffd447',
  pants: '#21324a',
  helmet: '#f4f6f8',
  goggle: '#e8a41c',
  ski: '#1e2329',
  skiTop: '#d5f04a',
  wing: '#f2622e',
  wing2: '#21324a',
  canopy: '#ffd447',
  canopy2: '#f2622e',
};

function mat(c, extra = {}) {
  return new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, ...extra });
}

function limb(r, len, m) {
  const g = new THREE.CapsuleGeometry(r, len - r * 2, 3, 8).translate(0, -len / 2, 0);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}

export class Skier {
  constructor() {
    const M = {
      jacket: mat(PALETTE.jacket),
      jacket2: mat(PALETTE.jacket2),
      pants: mat(PALETTE.pants, { roughness: 0.85 }),
      helmet: mat(PALETTE.helmet, { roughness: 0.3 }),
      goggle: mat(PALETTE.goggle, { roughness: 0.1, metalness: 0.8 }),
      ski: mat(PALETTE.ski, { roughness: 0.4 }),
      skiTop: mat(PALETTE.skiTop, { roughness: 0.4 }),
      pole: mat('#c9ced6', { metalness: 0.7, roughness: 0.3 }),
      glove: mat('#16181c'),
      wing: mat(PALETTE.wing, { side: THREE.DoubleSide, roughness: 0.6 }),
      wing2: mat(PALETTE.wing2, { side: THREE.DoubleSide, roughness: 0.6 }),
      canopy: mat(PALETTE.canopy, { side: THREE.DoubleSide, roughness: 0.6 }),
      canopy2: mat(PALETTE.canopy2, { side: THREE.DoubleSide, roughness: 0.6 }),
    };
    this.M = M;
    this.root = new THREE.Group();
    this.body = new THREE.Group(); // everything that leans
    this.root.add(this.body);

    // Pelvis and torso
    this.pelvis = new THREE.Group();
    this.body.add(this.pelvis);
    const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.12, 3, 8).rotateZ(Math.PI / 2), M.pants);
    hips.castShadow = true;
    this.pelvis.add(hips);
    this.torso = new THREE.Group();
    this.pelvis.add(this.torso);
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.3, 4, 10).translate(0, 0.3, 0), M.jacket);
    chest.scale.set(1, 1, 0.78);
    chest.castShadow = true;
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.192, 0.192, 0.07, 12).translate(0, 0.3, 0), M.jacket2);
    stripe.scale.set(1, 1, 0.8);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.3, 0.1).translate(0, 0.26, -0.16), M.jacket2);
    this.torso.add(chest, stripe, pack);
    this.head = new THREE.Group();
    this.head.position.set(0, 0.66, 0.02);
    this.torso.add(this.head);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 10), M.helmet);
    helmet.scale.set(1, 1.05, 1.1);
    helmet.castShadow = true;
    const goggle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.06).translate(0, 0.0, 0.125), M.goggle);
    this.head.add(helmet, goggle);

    // Arms
    this.arms = [-1, 1].map((sd) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(0.24 * sd, 0.52, 0);
      this.torso.add(shoulder);
      const upper = limb(0.065, L_UPPER, M.jacket);
      shoulder.add(upper);
      const elbow = new THREE.Group();
      elbow.position.y = -L_UPPER;
      shoulder.add(elbow);
      elbow.add(limb(0.058, L_FORE, M.jacket));
      const hand = new THREE.Group();
      hand.position.y = -L_FORE;
      elbow.add(hand);
      hand.add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), M.glove));
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.25, 5).translate(0, -0.5, 0), M.pole);
      const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.01, 8).translate(0, -1.02, 0), M.glove);
      const poleG = new THREE.Group();
      poleG.add(pole, basket);
      hand.add(poleG);
      return { sd, shoulder, elbow, hand, poleG };
    });

    // Legs (children of body, solved by IK each frame)
    this.legs = [-1, 1].map((sd) => {
      const hip = new THREE.Group();
      this.body.add(hip);
      const thigh = limb(0.085, L_THIGH, M.pants);
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -L_THIGH;
      hip.add(knee);
      const shin = limb(0.075, L_SHIN, M.pants);
      knee.add(shin);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.17, 0.3).translate(0, -L_SHIN + 0.02, 0.04), M.ski);
      boot.castShadow = true;
      knee.add(boot);
      return { sd, hip, knee };
    });

    // Skis
    this.skis = [-1, 1].map((sd) => {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.025, 1.7).translate(0, 0.012, 0), M.ski);
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.006, 1.5).translate(0, 0.027, -0.05), M.skiTop);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.025, 0.22).translate(0, 0, 0.1), M.ski);
      tip.position.set(0, 0.012, 0.83);
      tip.rotation.x = -0.45;
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.025, 0.14).translate(0, 0, -0.06), M.ski);
      tail.position.set(0, 0.012, -0.85);
      tail.rotation.x = -0.25;
      base.castShadow = true;
      g.add(base, top, tip, tail);
      this.body.add(g);
      return { sd, g };
    });

    // Wingsuit membranes (shown in the flying pose)
    this.wings = new THREE.Group();
    this.body.add(this.wings);
    const tri = (pts, m) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true;
      return mesh;
    };
    // Coordinates are for the wing pose: body upright in local frame, arms out.
    for (const sd of [-1, 1]) {
      this.wings.add(
        tri(
          [
            [0.24 * sd, 1.52, -0.02],
            [0.82 * sd, 1.42, -0.04],
            [0.2 * sd, 0.92, -0.02],
          ],
          M.wing,
        ),
        tri(
          [
            [0.82 * sd, 1.42, -0.04],
            [0.62 * sd, 1.18, -0.03],
            [0.2 * sd, 0.92, -0.02],
          ],
          M.wing2,
        ),
      );
    }
    this.wings.add(
      tri(
        [
          [-0.1, 0.86, -0.02],
          [0.1, 0.86, -0.02],
          [0.3, 0.08, -0.02],
        ],
        M.wing2,
      ),
      tri(
        [
          [-0.1, 0.86, -0.02],
          [0.3, 0.08, -0.02],
          [-0.3, 0.08, -0.02],
        ],
        M.wing2,
      ),
    );
    this.wings.visible = false;

    // Ram-air canopy
    this.canopy = new THREE.Group();
    const cells = 9;
    const span = 7.2;
    const chord = 2.6;
    for (let c = 0; c < cells; c++) {
      const u0 = c / cells - 0.5;
      const u1 = (c + 1) / cells - 0.5;
      const arc = (u) => [u * span, 6.6 - (u * 2) ** 2 * 0.9];
      const [x0, y0] = arc(u0);
      const [x1, y1] = arc(u1);
      const g = new THREE.BufferGeometry();
      const v = [
        x0, y0, chord * 0.5, x1, y1, chord * 0.5, x1, y1, -chord * 0.5,
        x0, y0, chord * 0.5, x1, y1, -chord * 0.5, x0, y0, -chord * 0.5,
        x0, y0 - 0.35, chord * 0.5, x1, y1 - 0.35, chord * 0.5, x1, y1, chord * 0.5,
        x0, y0 - 0.35, chord * 0.5, x1, y1, chord * 0.5, x0, y0, chord * 0.5,
      ];
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, c % 2 ? M.canopy2 : M.canopy);
      mesh.castShadow = true;
      this.canopy.add(mesh);
    }
    const lp = [];
    for (let c = 0; c <= cells; c++) {
      const u = c / cells - 0.5;
      const x = u * span;
      const y = 6.6 - (u * 2) ** 2 * 0.9 - 0.35;
      for (const z of [0.9, -0.6]) lp.push(x, y, z, 0.18 * Math.sign(x || 1), 1.45, 0);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    this.canopy.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#555b63', transparent: true, opacity: 0.7 })));
    this.canopy.visible = false;
    this.root.add(this.canopy);

    this.p = {
      crouch: 0.15,
      tuck: 0,
      lean: 0,
      edge: 0,
      wing: 0,
      chute: 0,
      grab: 0,
      limp: 0,
      plow: 0,
      armSwing: 0,
      landing: 0,
      grabKind: 0,
    };
    this.t = 0;
    this.skisOn = true;
  }

  /**
   * target: { crouch, tuck, lean, wing, chute, grab, limp, plow, grabKind }
   * Values are eased toward their targets.
   */
  update(dt, target) {
    this.t += dt;
    const p = this.p;
    const k = damp(14, dt);
    for (const key of ['crouch', 'tuck', 'lean', 'wing', 'chute', 'grab', 'limp', 'plow']) {
      if (target[key] !== undefined) p[key] = lerp(p[key], target[key], key === 'wing' || key === 'chute' ? damp(6, dt) : k);
    }
    p.landing = Math.max(0, p.landing - dt * 3);
    p.grabKind = target.grabKind ?? p.grabKind;

    const crouch = clamp(p.crouch + p.landing * 0.6 + p.grab * 0.5);
    const wing = p.wing;
    const ground = 1 - wing;

    // Body lean into the turn, around the feet.
    this.body.rotation.z = -p.lean * ground;

    // Hip height
    const hipY = lerp(0.95, 0.58, crouch) * ground + 0.95 * wing;
    this.pelvis.position.set(0, hipY, lerp(-0.05, -0.16, crouch) * ground);
    const torsoPitch = lerp(0.18, 0.55, crouch) + p.tuck * 0.55;
    this.torso.rotation.x = torsoPitch * ground * (1 - p.limp) + p.limp * 0.9 * Math.sin(this.t * 3);
    this.torso.rotation.z = p.lean * 0.35 * ground;
    this.head.rotation.x = -torsoPitch * 0.7 * ground - wing * 0.9;

    // Legs: two-link IK from hip to foot.
    const grabLift = p.grab * 0.28;
    for (const leg of this.legs) {
      const hx = 0.11 * leg.sd;
      const hy = this.pelvis.position.y - 0.05;
      const hz = this.pelvis.position.z;
      leg.hip.position.set(hx, hy, hz);
      let fx = (0.12 + p.plow * 0.18) * leg.sd;
      let fy = 0.1 + grabLift;
      let fz = 0.04;
      if (wing > 0.01) {
        fx = lerp(fx, 0.28 * leg.sd, wing);
        fy = lerp(fy, 0.0, wing);
        fz = lerp(fz, -0.08, wing);
      }
      if (p.limp > 0.01) {
        fx += p.limp * 0.2 * leg.sd * Math.sin(this.t * 4 + leg.sd);
        fz += p.limp * 0.3 * Math.cos(this.t * 5 + leg.sd);
      }
      const dy = fy - hy;
      const dz = fz - hz;
      const dx = fx - hx;
      const d = clamp(Math.hypot(dy, dz), 0.2, L_THIGH + L_SHIN - 0.001);
      const phi = Math.atan2(dz, -dy);
      const a = Math.acos(clamp((L_THIGH * L_THIGH + d * d - L_SHIN * L_SHIN) / (2 * L_THIGH * d), -1, 1));
      const t1 = phi + a;
      const ky = hy - L_THIGH * Math.cos(t1);
      const kz = hz + L_THIGH * Math.sin(t1);
      const t2 = Math.atan2(fz - kz, -(fy - ky));
      leg.hip.rotation.set(-t1, 0, Math.atan2(dx, -dy) * 0.9);
      leg.knee.rotation.set(-(t2 - t1), 0, 0);
    }

    // Skis follow the feet.
    for (const ski of this.skis) {
      const fx = (0.12 + p.plow * 0.18) * ski.sd;
      ski.g.position.set(fx, grabLift, 0.04);
      ski.g.rotation.set(0, -p.plow * 0.35 * ski.sd, ski.sd * p.plow * 0.25);
      ski.g.visible = this.skisOn && wing < 0.5;
    }

    // Arms
    for (const arm of this.arms) {
      const sd = arm.sd;
      // Riding: hands forward and out, poles trailing.
      let sx = -0.55 - p.tuck * 0.5;
      let sz = sd * (0.35 - p.tuck * 0.15);
      let ex = -0.7 + p.tuck * 0.2;
      // Grab: reach down toward the ski.
      const reach = p.grab * (p.grabKind === 0 ? (sd > 0 ? 1 : 0.2) : p.grabKind === 1 ? (sd < 0 ? 1 : 0.2) : 1);
      sx = lerp(sx, -1.5 + (p.grabKind === 2 ? 0.9 : 0), reach);
      sz = lerp(sz, sd * 0.15, reach);
      ex = lerp(ex, -0.1, reach);
      // Wingsuit: arms straight out and slightly back.
      sx = lerp(sx, -0.1, wing);
      sz = lerp(sz, sd * 1.45, wing);
      ex = lerp(ex, 0, wing);
      // Canopy: hands up on the toggles.
      sx = lerp(sx, -0.2, p.chute);
      sz = lerp(sz, sd * 2.7, p.chute);
      ex = lerp(ex, -0.3, p.chute);
      // Ragdoll flail
      sx = lerp(sx, Math.sin(this.t * 7 + sd) * 1.6, p.limp);
      sz = lerp(sz, sd * (1.2 + Math.sin(this.t * 5) * 0.8), p.limp);
      arm.shoulder.rotation.set(sx, 0, sz);
      arm.elbow.rotation.set(ex, 0, 0);
      arm.poleG.visible = this.skisOn && wing < 0.5 && p.chute < 0.5;
      arm.poleG.rotation.set(1.25 - p.tuck * 0.5 + reach * 0.6, 0, -sd * 0.1);
    }

    this.wings.visible = wing > 0.5;
    this.canopy.visible = p.chute > 0.05;
    this.canopy.scale.setScalar(Math.max(0.05, p.chute));
  }

  /** Kick the knees when landing; amount 0..1. */
  absorb(amount) {
    this.p.landing = Math.max(this.p.landing, clamp(amount));
  }
}
