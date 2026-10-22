// Procedural sound: wind that rises with speed, the hiss of the edges, thumps.
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch (e) {
      return;
    }
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      // Brown-ish noise for wind.
      b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = b * 3.5;
    }
    const white = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = white.getChannelData(0);
    for (let i = 0; i < len; i++) w[i] = Math.random() * 2 - 1;
    this.white = white;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);

    const loop = (buffer) => {
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      s.start();
      return s;
    };
    this.windF = ctx.createBiquadFilter();
    this.windF.type = 'lowpass';
    this.windF.frequency.value = 400;
    this.windG = ctx.createGain();
    this.windG.gain.value = 0;
    loop(buf).connect(this.windF).connect(this.windG).connect(this.master);

    this.edgeF = ctx.createBiquadFilter();
    this.edgeF.type = 'bandpass';
    this.edgeF.frequency.value = 2400;
    this.edgeF.Q.value = 0.7;
    this.edgeG = ctx.createGain();
    this.edgeG.gain.value = 0;
    loop(white).connect(this.edgeF).connect(this.edgeG).connect(this.master);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.8;
  }

  update(rider) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const sp = rider.speed;
    const flying = rider.mode === 'wing';
    const wind = Math.min(1, sp / (flying ? 60 : 40));
    this.windG.gain.setTargetAtTime(wind * wind * (flying ? 0.9 : 0.55), t, 0.1);
    this.windF.frequency.setTargetAtTime(250 + wind * 1400, t, 0.1);
    const edge = rider.mode === 'ski' && rider.grounded ? Math.min(1, sp / 25) * (0.25 + rider.spray * 0.9) : 0;
    this.edgeG.gain.setTargetAtTime(edge * 0.16, t, 0.05);
    this.edgeF.frequency.setTargetAtTime(1600 + rider.spray * 2400, t, 0.05);
  }

  thump(power = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 300 + power * 300;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(Math.min(1, 0.25 + power * 0.6), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + 0.4);
  }

  /** A short two-tone chime: good = rising, bad = falling. */
  chime(good = true) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const notes = good ? [880, 1320] : [440, 330];
    notes.forEach((hz, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.08);
      g.gain.linearRampToValueAtTime(0.12, t + i * 0.08 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.25);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.08);
      o.stop(t + i * 0.08 + 0.3);
    });
  }

  whoosh() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    const t = ctx.currentTime;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(1800, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + 0.8);
  }
}
