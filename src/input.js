// Keyboard, gamepad and touch, merged into one control state per frame.
import { clamp, damp, lerp } from './util.js';

const KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  fwd: ['ArrowUp', 'KeyW'],
  back: ['ArrowDown', 'KeyS'],
  jump: ['Space'],
  grab: ['ShiftLeft', 'ShiftRight', 'KeyE'],
  wing: ['KeyQ'],
  rewind: ['KeyR'],
  cam: ['KeyC'],
  map: ['KeyM', 'Tab'],
  pause: ['Escape', 'KeyP'],
  restart: ['Enter'],
  mute: ['KeyN'],
  help: ['KeyH'],
};

export class Input {
  constructor(target) {
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.touch = { steer: 0, fwd: 0, back: 0, jump: false, grab: false };
    this.touchPressed = new Set();
    this.touchReleased = new Set();
    this.steer = 0;
    this.fwd = 0;
    this.back = 0;
    this.padPrev = [];
    this.lastDevice = 'keyboard';
    this.onAny = null;
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (Object.values(KEYS).some((k) => k.includes(e.code))) e.preventDefault();
      this.down.add(e.code);
      this.pressed.add(e.code);
      this.lastDevice = 'keyboard';
      this.onAny?.();
    });
    target.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => {
      for (const c of this.down) this.released.add(c);
      this.down.clear();
    });
  }

  is(name) {
    return KEYS[name].some((k) => this.down.has(k));
  }
  was(name) {
    return KEYS[name].some((k) => this.pressed.has(k)) || this.touchPressed.has(name);
  }
  rel(name) {
    return KEYS[name].some((k) => this.released.has(k)) || this.touchReleased.has(name);
  }

  tap(name) {
    this.touchPressed.add(name);
    this.onAny?.();
  }
  untap(name) {
    this.touchReleased.add(name);
  }

  /** Sample all devices. Call once per frame. */
  frame(dt) {
    let steer = (this.is('right') ? 1 : 0) - (this.is('left') ? 1 : 0);
    let fwd = this.is('fwd') ? 1 : 0;
    let back = this.is('back') ? 1 : 0;
    let jump = this.is('jump');
    let grab = this.is('grab');
    const edges = {};
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = Math.abs(p.axes[0]) > 0.15 ? p.axes[0] : 0;
      const ay = Math.abs(p.axes[1]) > 0.2 ? p.axes[1] : 0;
      const b = p.buttons.map((x) => x.pressed);
      if (ax || ay || b.some(Boolean)) this.lastDevice = 'gamepad';
      steer += ax;
      fwd += Math.max(0, -ay) + (p.buttons[7]?.value || 0);
      back += Math.max(0, ay) + (p.buttons[6]?.value || 0);
      jump = jump || b[0];
      grab = grab || b[2] || b[5];
      const map = { 0: 'jump', 3: 'wing', 1: 'rewind', 9: 'map', 8: 'cam', 4: 'cam' };
      for (const [i, name] of Object.entries(map)) {
        if (b[i] && !this.padPrev[i]) {
          edges[name] = true;
          this.onAny?.();
        }
        if (!b[i] && this.padPrev[i]) edges[name + 'Up'] = true;
      }
      this.padPrev = b;
      break;
    }
    steer += this.touch.steer;
    fwd += this.touch.fwd;
    back += this.touch.back;
    jump = jump || this.touch.jump;
    grab = grab || this.touch.grab;
    // Keyboard steering ramps so taps make small corrections.
    const k = damp(9, dt);
    this.steer = lerp(this.steer, clamp(steer, -1, 1), Math.abs(steer) < Math.abs(this.steer) ? damp(14, dt) : k);
    this.fwd = clamp(fwd);
    this.back = clamp(back);
    const out = {
      steer: this.steer,
      fwd: this.fwd,
      back: this.back,
      jump,
      grab,
      jumpPressed: this.was('jump') || !!edges.jump,
      jumpReleased: this.rel('jump') || !!edges.jumpUp,
      wingPressed: this.was('wing') || !!edges.wing,
      rewind: this.was('rewind') || !!edges.rewind,
      cam: this.was('cam') || !!edges.cam,
      map: this.was('map') || !!edges.map,
      pause: this.was('pause'),
      restart: this.was('restart'),
      mute: this.was('mute'),
      help: this.was('help'),
    };
    this.pressed.clear();
    this.released.clear();
    this.touchPressed.clear();
    this.touchReleased.clear();
    return out;
  }
}
