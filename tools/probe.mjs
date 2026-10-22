// Prints a coarse grid of terrain heights above the village (every 250 m), north at the top.
import { createHeightfield, VILLAGE } from '../src/heightfield.js';

const f = createHeightfield();
const vh = f.height(VILLAGE.x, VILLAGE.z);
console.log('village height', vh.toFixed(0));
let head = '      ';
for (let x = -1250; x <= 1250; x += 250) head += String(x).padStart(6);
console.log(head);
for (let z = -1250; z <= 1250; z += 250) {
  let row = '';
  for (let x = -1250; x <= 1250; x += 250) row += String(Math.round(f.height(x, z) - vh)).padStart(6);
  console.log(String(z).padStart(6), row);
}
