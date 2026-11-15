// STORMDOCK audio — every sound is synthesized with WebAudio, so the game
// needs no audio files and no network. Rain is a looped filtered-noise bed.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.rainGain = null;
    this.muted = false;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    this.startRain();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.55;
  }

  noiseBuffer(seconds = 1) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  startRain() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(2);
    src.loop = true;
    const low = this.ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 900;
    const high = this.ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 250;
    this.rainGain = this.ctx.createGain();
    this.rainGain.gain.value = 0.05;
    src.connect(low);
    low.connect(high);
    high.connect(this.rainGain);
    this.rainGain.connect(this.master);
    src.start();
    // Slow swells so the rain never sounds like a flat loop.
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain);
    lfoGain.connect(this.rainGain.gain);
    lfo.start();
  }

  burst({ duration = 0.12, freq = 1200, type = 'lowpass', gain = 0.5, sweepTo = null }) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(duration + 0.05);
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo !== null) filter.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  tone({ freq = 440, to = null, duration = 0.15, type = 'sine', gain = 0.2 }) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  shot(kind) {
    if (kind === 'sniper') {
      this.burst({ duration: 0.28, freq: 900, sweepTo: 120, gain: 0.7 });
      this.tone({ freq: 160, to: 45, duration: 0.22, type: 'sawtooth', gain: 0.25 });
    } else if (kind === 'rifle') {
      this.burst({ duration: 0.14, freq: 1600, sweepTo: 220, gain: 0.55 });
      this.tone({ freq: 190, to: 70, duration: 0.1, type: 'square', gain: 0.12 });
    } else if (kind === 'smg') {
      this.burst({ duration: 0.09, freq: 2200, sweepTo: 320, gain: 0.42 });
    } else {
      // pistol
      this.burst({ duration: 0.11, freq: 1400, sweepTo: 260, gain: 0.5 });
    }
  }

  dryFire() {
    this.tone({ freq: 900, to: 500, duration: 0.05, type: 'square', gain: 0.08 });
  }

  reload() {
    this.tone({ freq: 1400, duration: 0.04, type: 'square', gain: 0.1 });
    setTimeout(() => this.tone({ freq: 900, duration: 0.04, type: 'square', gain: 0.1 }), 140);
    setTimeout(() => this.tone({ freq: 1700, duration: 0.04, type: 'square', gain: 0.12 }), 320);
  }

  hit(head) {
    this.tone({ freq: head ? 1500 : 1100, duration: 0.05, type: 'sine', gain: 0.16 });
  }

  step() {
    this.burst({ duration: 0.05, freq: 500, sweepTo: 180, gain: 0.07 });
  }

  plantBeep(final = false) {
    this.tone({ freq: final ? 1800 : 1200, duration: final ? 0.3 : 0.09, type: 'sine', gain: 0.2 });
  }

  explosion() {
    this.burst({ duration: 1.1, freq: 500, sweepTo: 45, gain: 0.9 });
    this.tone({ freq: 90, to: 28, duration: 0.9, type: 'sine', gain: 0.5 });
  }

  roundEnd(won) {
    const notes = won ? [523, 659, 784] : [392, 330, 262];
    notes.forEach((f, i) => setTimeout(() => this.tone({ freq: f, duration: 0.22, type: 'triangle', gain: 0.2 }), i * 130));
  }

  buy() {
    this.tone({ freq: 660, duration: 0.07, type: 'sine', gain: 0.14 });
    setTimeout(() => this.tone({ freq: 990, duration: 0.09, type: 'sine', gain: 0.14 }), 80);
  }
}
