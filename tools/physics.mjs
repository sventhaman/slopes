// Headless physics check: drops a rider at a few spots and reports how it moves.
import * as THREE from 'three';
import { createHeightfield } from '../src/heightfield.js';
import { Rider } from '../src/rider.js';
import { Obstacles } from '../src/scenery.js';

const field = createHeightfield();
const obs = new Obstacles();
const rider = new Rider(field, obs);
const spots = process.argv[2] ? JSON.parse(process.argv[2]) : [[0, -500], [-300, -200], [25, -869]];
const inp = { steer: 0, fwd: 0, back: 0, jump: false, grab: false };
for (const [x, z] of spots) {
  // Face downhill
  const n = [0, 0, 0];
  field.normal(x, z, n);
  const yaw = Math.atan2(n[0], n[2]);
  rider.reset(new THREE.Vector3(x, 0, z), yaw, 'ski', 0);
  console.log(`start ${x},${z} slope ${field.slopeDeg(x, z).toFixed(1)} yaw ${yaw.toFixed(2)}`);
  for (let t = 0; t < 6; t += 1 / 60) {
    const ev = rider.step(1 / 60, inp);
    for (const e of ev) if (e.type !== 'takeoff' || !e.ollie) console.log('  ', t.toFixed(2), e.type, e.reason || '', e.air ? e.air.toFixed(2) : '');
    if (Math.abs(t - Math.round(t)) < 1 / 120)
      console.log(
        '  t', t.toFixed(1),
        'pos', rider.pos.toArray().map((v) => v.toFixed(1)).join(','),
        'v', rider.speed.toFixed(1),
        rider.mode, rider.grounded ? 'ground' : 'air',
        'slope', field.slopeDeg(rider.pos.x, rider.pos.z).toFixed(0),
      );
  }
}
