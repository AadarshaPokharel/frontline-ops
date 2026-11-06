import { angDiff, yawTo } from '@shared/util.js';

// Every sound is synthesised with Web Audio (filtered noise + oscillators), so there are no audio files to load.
const MAX_VOICES = 48;
const HEARING = 80;   // metres

export class Sound {
  constructor() {
    this.ctx = null;
    this.voices = 0;
  }

  // Browsers only allow audio after a user gesture, so this is called from click handlers.
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.45;
      this.master.connect(this.ctx.destination);
      this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 3, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  out(pan) {
    if (!pan || !this.ctx.createStereoPanner) return this.master;
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.master);
    return p;
  }

  burst(dur, freq, q, vol, t, type, dest) {
    const c = this.ctx, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noise;
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.05);
    this.track(dur);
  }

  tone(type, f0, f1, dur, vol, t, dest) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    this.track(dur);
  }

  track(dur) {
    this.voices++;
    setTimeout(() => this.voices--, dur * 1000 + 60);
  }

  // Positional sounds fade with distance and pan by their direction relative to where you are looking.
  play(name, x, z, L) {
    if (!this.ctx) return;
    let v = 1, pan = 0;
    if (x !== undefined && L) {
      const d = Math.hypot(x - L.x, z - L.z);
      v = 1 - d / HEARING;
      if (v < 0.03 || this.voices > MAX_VOICES) return;
      v *= v;
      if (d > 0.5) pan = -Math.sin(angDiff(yawTo(x - L.x, z - L.z), L.yaw)) * 0.8;
    }
    const t = this.ctx.currentTime, o = this.out(pan);
    const lp = 'lowpass', bp = 'bandpass';
    switch (name) {
      case 'ar': this.burst(0.13, 2600, 0.8, 0.45 * v, t, lp, o); this.tone('square', 150, 45, 0.08, 0.22 * v, t, o); break;
      case 'smg': this.burst(0.09, 3400, 0.8, 0.38 * v, t, lp, o); this.tone('square', 190, 60, 0.06, 0.16 * v, t, o); break;
      case 'lmg': this.burst(0.14, 2000, 0.8, 0.5 * v, t, lp, o); this.tone('square', 120, 40, 0.09, 0.26 * v, t, o); break;
      case 'pistol': this.burst(0.11, 2900, 0.9, 0.42 * v, t, lp, o); this.tone('square', 210, 60, 0.07, 0.2 * v, t, o); break;
      case 'shotgun': this.burst(0.32, 1500, 0.6, 0.8 * v, t, lp, o); this.tone('sine', 110, 35, 0.2, 0.55 * v, t, o); break;
      case 'sniper': this.burst(0.5, 1700, 0.5, 0.9 * v, t, lp, o); this.tone('sine', 95, 28, 0.32, 0.6 * v, t, o); break;
      case 'empty': this.tone('square', 1300, 900, 0.03, 0.12, t, o); break;
      case 'reload': this.burst(0.05, 4200, 4, 0.3, t, bp, o); this.burst(0.06, 2600, 4, 0.3, t + 0.28, bp, o); break;
      case 'reloaded': this.burst(0.07, 3000, 5, 0.35, t, bp, o); break;
      case 'swap': this.burst(0.06, 3600, 3, 0.22, t, bp, o); break;
      case 'hit': this.tone('triangle', 2100, 1700, 0.045, 0.22, t, o); break;
      case 'headshot': this.tone('triangle', 2600, 2200, 0.05, 0.26, t, o); this.burst(0.04, 5000, 2, 0.15, t, bp, o); break;
      case 'kill': this.tone('triangle', 1500, 2300, 0.09, 0.22, t, o); this.tone('triangle', 900, 1200, 0.09, 0.14, t, o); break;
      case 'hurt': this.tone('sine', 240, 110, 0.18, 0.3, t, o); this.burst(0.08, 900, 1, 0.2, t, lp, o); break;
      case 'death': this.tone('sawtooth', 300, 60, 0.7, 0.2, t, o); break;
      case 'boom': this.burst(1.3, 700, 0.4, 1.1 * v, t, lp, o); this.tone('sine', 85, 22, 0.9, 0.9 * v, t, o); break;
      case 'throw': this.burst(0.12, 1800, 2, 0.2 * v, t, bp, o); break;
      case 'knife': this.burst(0.13, 5200, 1.5, 0.35 * v, t, 'highpass', o); break;
      case 'step': this.burst(0.05, 600, 1, 0.12 * v, t, lp, o); break;
      case 'pickup': this.tone('square', 700, 1300, 0.08, 0.1, t, o); this.tone('square', 1000, 1600, 0.08, 0.08, t + 0.07, o); break;
      case 'streak': this.tone('sawtooth', 440, 880, 0.22, 0.12, t, o); this.tone('sawtooth', 660, 1320, 0.3, 0.1, t + 0.14, o); break;
      case 'jet': this.burst(2.6, 1200, 0.7, 0.5, t, bp, o); break;
      case 'land': this.burst(0.4, 400, 0.6, 0.6 * v, t, lp, o); break;
    }
  }

  onEvent(e, M, me, yaw) {
    if (!this.ctx || !me) return;
    const L = { x: me.x, z: me.z, yaw }, mine = e.a === me;
    switch (e.type) {
      case 'shot': this.play(M.weapons[e.wid].sound, mine ? undefined : e.a.x, e.a.z, L); break;
      case 'empty': if (mine) this.play('empty'); break;
      case 'reload': if (mine) this.play('reload'); break;
      case 'reloaded': if (mine) this.play('reloaded'); break;
      case 'swap': if (mine) this.play('swap'); break;
      case 'hit':
        if (e.att === me && e.v !== me) this.play(e.head ? 'headshot' : 'hit');
        if (e.v === me) this.play('hurt');
        break;
      case 'kill':
        if (e.att === me) this.play('kill');
        if (e.v === me) this.play('death');
        break;
      case 'explode': this.play('boom', e.x, e.z, L); break;
      case 'throw': this.play('throw', e.a.x, e.a.z, L); break;
      case 'knife': this.play('knife', e.a.x, e.a.z, L); break;
      case 'pickup': if (mine) this.play('pickup'); break;
      case 'streak': if (mine) this.play('streak'); if (e.id === 'air') this.play('jet'); break;
      case 'land': this.play('land', e.x, e.z, L); break;
      case 'end': this.play(e.result === me.team ? 'streak' : 'death'); break;
    }
  }
}
