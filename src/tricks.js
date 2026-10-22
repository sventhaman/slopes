// Trick naming and scoring. Tricks chain into a combo while you keep landing
// within a few seconds of each other; the combo banks when you ride clean
// for 3 s, and is lost if you crash.
import { clamp } from './util.js';

const GRABS = ['Mute grab', 'Japan', 'Tail grab'];
const COMBO_WINDOW = 3;

export function describeLanding(e) {
  const parts = [];
  let pts = 0;
  const deg = Math.floor((Math.abs(e.spin) + 0.75) / Math.PI) * 180;
  const flips = Math.floor((Math.abs(e.flip) + 1.0) / (Math.PI * 2));
  const back = e.flip > 0;
  if (flips > 0 && deg >= 360) {
    const base = back ? 'Cork' : 'Rodeo';
    parts.push(`${flips > 1 ? 'Double ' : ''}${base} ${deg}`);
    pts += (deg * 1.6 + flips * 650) * 1.25;
  } else {
    if (deg >= 180) {
      parts.push(String(deg));
      pts += deg * 1.6;
    }
    if (flips > 0) {
      const mult = ['', '', 'Double ', 'Triple ', 'Quad '][Math.min(flips, 4)];
      parts.push(`${mult}${back ? 'Backflip' : 'Frontflip'}`);
      pts += flips * 650;
    }
  }
  if (e.grabTime > 0.25) {
    parts.push(GRABS[e.grabKind] || GRABS[0]);
    pts += 120 + e.grabTime * 220;
  }
  if (e.air > 0.6) {
    pts += Math.round(40 * e.air * e.air + 40 * e.air);
    if (!parts.length) parts.push(e.air > 2.2 ? 'Huge air' : 'Air');
  }
  if (!parts.length) return null;
  let mult = 1;
  let tag = '';
  if (e.quality === 'perfect') {
    mult = 1.5;
    tag = 'Perfect landing';
  } else if (e.quality === 'sketchy') {
    mult = 0.5;
    tag = 'Sketchy';
  }
  if (e.switch) {
    parts.push('to switch');
    pts += 100;
  }
  return { name: parts.join(' · '), pts: Math.round(pts * mult), tag, air: e.air };
}

export class Score {
  constructor() {
    this.reset();
  }
  reset() {
    this.total = 0;
    this.combo = [];
    this.comboPts = 0;
    this.comboT = 0;
    this.prox = 0;
    this.proxT = 0;
    this.best = null;
    this.tricks = 0;
    this.maxAir = 0;
    this.feed = [];
  }
  get multiplier() {
    return clamp(this.combo.length, 1, 6);
  }
  get pending() {
    return Math.round(this.comboPts * this.multiplier) + Math.round(this.prox);
  }
  push(text, pts, kind = 'trick') {
    this.feed.push({ text, pts, kind, t: 0 });
  }
  onEvent(e) {
    if (e.type === 'land') {
      this.maxAir = Math.max(this.maxAir, e.air);
      const d = describeLanding(e);
      if (!d) return null;
      this.combo.push(d.name);
      this.comboPts += d.pts;
      this.comboT = 0;
      this.tricks++;
      if (!this.best || d.pts > this.best.pts) this.best = d;
      this.push(d.name, d.pts, 'trick');
      if (d.tag) this.push(d.tag, 0, d.tag === 'Sketchy' ? 'bad' : 'good');
      return d;
    }
    if (e.type === 'nearmiss') {
      this.comboPts += 75;
      this.comboT = Math.min(this.comboT, COMBO_WINDOW - 1);
      this.push(e.kind === 'tree' ? 'Tree skim' : 'Close call', 75, 'trick');
    }
    if (e.type === 'crash') {
      if (this.comboPts > 0 || this.prox > 0) this.push('Combo lost', -this.pending, 'bad');
      this.combo = [];
      this.comboPts = 0;
      this.prox = 0;
    }
    if (e.type === 'gate') this.push(e.text, e.pts || 0, e.ok ? 'good' : 'bad');
    return null;
  }
  /** Called every frame with the rider; banks combos and proximity points. */
  update(dt, rider, grounded) {
    for (const f of this.feed) f.t += dt;
    this.feed = this.feed.filter((f) => f.t < 2.6);
    if (rider.mode === 'wing' && rider.clearance < 30) {
      const k = (30 - rider.clearance) / 30;
      this.prox += dt * k * k * 420 * (rider.wingSpeed / 40);
      this.proxT = 0;
    } else if (this.prox > 0) {
      this.proxT += dt;
      if (this.proxT > 1 && rider.mode !== 'crash') {
        if (this.prox >= 25) {
          this.total += Math.round(this.prox);
          this.push('Proximity', Math.round(this.prox), 'good');
        }
        this.prox = 0;
      }
    }
    if (this.combo.length || this.comboPts > 0) {
      if (grounded) this.comboT += dt;
      if (this.comboT > COMBO_WINDOW) this.bank();
    }
  }
  bank() {
    if (this.comboPts <= 0) return;
    const p = Math.round(this.comboPts * this.multiplier);
    if (this.combo.length > 1) this.push(`${this.combo.length}× combo`, p, 'good');
    this.total += p;
    this.combo = [];
    this.comboPts = 0;
    this.comboT = 0;
  }
  /** Bank everything (end of a run). */
  flush() {
    this.bank();
    if (this.prox > 0) {
      this.total += Math.round(this.prox);
      this.prox = 0;
    }
  }
}
