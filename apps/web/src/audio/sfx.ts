// Procedural audio: every sound effect and the ambient score are synthesised
// with WebAudio, so there is nothing to download and nothing to license.

import { settings, onSettings } from '../settings';

type Ctx = AudioContext;

let ctx: Ctx | null = null;
let master: GainNode;
let sfxBus: GainNode;
let musicBus: GainNode;
let noiseBuf: AudioBuffer;
let humOsc: OscillatorNode | null = null;
let humGain: GainNode | null = null;
let musicTimer = 0;
let musicWorld = 0;
let musicStep = 0;

function applyVolumes(): void {
  if (!ctx) return;
  sfxBus.gain.setTargetAtTime((settings.sfx / 100) * 0.9, ctx.currentTime, 0.05);
  musicBus.gain.setTargetAtTime((settings.music / 100) * 0.35, ctx.currentTime, 0.2);
}

/** Must be called from a user gesture at least once. */
export function unlockAudio(): void {
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    sfxBus = ctx.createGain();
    musicBus = ctx.createGain();
    sfxBus.connect(master);
    musicBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    applyVolumes();
    onSettings(applyVolumes);
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function tone(freq: number, dur: number, opts: { type?: OscillatorType; vol?: number; slide?: number; delay?: number; attack?: number; bus?: GainNode } = {}): void {
  if (!ctx) return;
  const t = ctx.currentTime + (opts.delay ?? 0);
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = opts.type ?? 'sine';
  o.frequency.setValueAtTime(freq, t);
  if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * opts.slide), t + dur);
  const v = opts.vol ?? 0.3;
  const a = opts.attack ?? 0.005;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(opts.bus ?? sfxBus);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise(dur: number, opts: { freq?: number; q?: number; vol?: number; type?: BiquadFilterType; slide?: number; delay?: number } = {}): void {
  if (!ctx) return;
  const t = ctx.currentTime + (opts.delay ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = opts.type ?? 'bandpass';
  f.frequency.setValueAtTime(opts.freq ?? 1200, t);
  if (opts.slide) f.frequency.exponentialRampToValueAtTime(Math.max(40, (opts.freq ?? 1200) * opts.slide), t + dur);
  f.Q.value = opts.q ?? 1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(opts.vol ?? 0.3, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(sfxBus);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

export const sfx = {
  click: () => tone(660, 0.06, { type: 'triangle', vol: 0.15 }),
  join: () => { tone(523, 0.12, { type: 'triangle', vol: 0.2 }); tone(784, 0.18, { type: 'triangle', vol: 0.2, delay: 0.09 }); },
  leave: () => { tone(523, 0.12, { type: 'triangle', vol: 0.18 }); tone(349, 0.2, { type: 'triangle', vol: 0.18, delay: 0.09 }); },
  jump: (el: number) => {
    if (el === 0) { tone(320, 0.12, { type: 'square', vol: 0.08, slide: 2.2 }); noise(0.08, { freq: 3000, vol: 0.05 }); }
    else { tone(420, 0.13, { type: 'sine', vol: 0.18, slide: 2 }); }
  },
  land: () => noise(0.07, { freq: 300, q: 0.7, vol: 0.12, type: 'lowpass' }),
  death: (el: number) => {
    if (el === 0) { noise(0.5, { freq: 4000, slide: 0.2, vol: 0.25, type: 'highpass' }); tone(300, 0.4, { type: 'sawtooth', vol: 0.06, slide: 0.3 }); }
    else { noise(0.45, { freq: 900, slide: 3, vol: 0.25 }); tone(500, 0.35, { vol: 0.12, slide: 0.4 }); }
  },
  respawn: () => { tone(392, 0.15, { type: 'triangle', vol: 0.12 }); tone(587, 0.2, { type: 'triangle', vol: 0.12, delay: 0.07 }); },
  plate: (on: boolean) => tone(on ? 220 : 180, 0.08, { type: 'square', vol: 0.06, slide: on ? 0.7 : 1.3 }),
  door: (open: boolean) => { noise(0.35, { freq: open ? 500 : 350, slide: open ? 1.8 : 0.6, vol: 0.12, type: 'lowpass' }); tone(open ? 110 : 90, 0.3, { type: 'sawtooth', vol: 0.03 }); },
  lever: () => { tone(900, 0.04, { type: 'square', vol: 0.08 }); tone(600, 0.06, { type: 'square', vol: 0.06, delay: 0.04 }); },
  node: (el: number) => {
    if (el === 0) { noise(0.4, { freq: 1200, slide: 0.4, vol: 0.18 }); tone(330, 0.4, { type: 'triangle', vol: 0.12, slide: 1.5 }); }
    else { tone(600, 0.3, { vol: 0.15, slide: 0.6 }); tone(900, 0.25, { vol: 0.1, delay: 0.08, slide: 0.7 }); }
  },
  ice: () => { noise(0.6, { freq: 5000, slide: 0.5, vol: 0.12, type: 'highpass' }); tone(1400, 0.2, { vol: 0.05, slide: 0.5 }); },
  checkpoint: () => { [523, 659, 784].forEach((f, i) => tone(f, 0.25, { type: 'triangle', vol: 0.12, delay: i * 0.06 })); },
  crystal: (on: boolean) => on ? [880, 1320].forEach((f, i) => tone(f, 0.35, { vol: 0.1, delay: i * 0.05 })) : tone(660, 0.15, { vol: 0.05, slide: 0.6 }),
  link: (on: boolean) => tone(on ? 740 : 520, 0.18, { type: 'sine', vol: 0.07, slide: on ? 1.5 : 0.6 }),
  mirror: () => { tone(1200, 0.05, { type: 'triangle', vol: 0.08 }); tone(1600, 0.08, { type: 'triangle', vol: 0.06, delay: 0.03 }); },
  receiver: (on: boolean) => tone(on ? 1046 : 700, 0.25, { vol: 0.08, slide: on ? 1.2 : 0.7 }),
  beep: (hi = false) => tone(hi ? 880 : 520, hi ? 0.35 : 0.14, { type: 'triangle', vol: 0.18 }),
  complete: () => {
    [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, i === 5 ? 0.7 : 0.2, { type: 'triangle', vol: 0.15, delay: i * 0.1 }));
  },
  error: () => { tone(200, 0.15, { type: 'square', vol: 0.06 }); tone(150, 0.2, { type: 'square', vol: 0.06, delay: 0.12 }); },
};

/** Continuous hum while the Resonance Link is active (gain follows `level`, 0..1). */
export function setLinkHum(level: number): void {
  if (!ctx) return;
  if (!humOsc) {
    humOsc = ctx.createOscillator();
    humOsc.type = 'sine';
    humOsc.frequency.value = 196;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 6;
    lfo.connect(lfoGain).connect(humOsc.frequency);
    humGain = ctx.createGain();
    humGain.gain.value = 0;
    humOsc.connect(humGain).connect(sfxBus);
    humOsc.start();
    lfo.start();
  }
  humGain!.gain.setTargetAtTime(level * 0.05, ctx.currentTime, 0.08);
}

// ---------------------------------------------------------------------------
// Ambient score: slow chord pads with a sparse pentatonic melody, per world.

const WORLD_SCALES: number[][] = [
  [220, 261.6, 293.7, 329.6, 392], // caverns: A minor pentatonic
  [196, 233.1, 261.6, 293.7, 349.2], // machineworks: G minor-ish
  [261.6, 293.7, 329.6, 392, 440], // temple: C major pentatonic
  [174.6, 220, 261.6, 293.7, 349.2], // sky vault: F lydian-ish
];
const WORLD_CHORDS: number[][][] = [
  [[110, 164.8, 220], [98, 146.8, 196], [87.3, 130.8, 174.6], [98, 146.8, 196]],
  [[98, 146.8, 196], [116.5, 174.6, 233.1], [87.3, 130.8, 174.6], [98, 146.8, 196]],
  [[130.8, 196, 261.6], [110, 164.8, 220], [146.8, 220, 293.7], [130.8, 196, 261.6]],
  [[87.3, 130.8, 174.6], [98, 146.8, 196], [110, 164.8, 220], [130.8, 196, 261.6]],
];

function pad(freqs: number[], dur: number): void {
  if (!ctx) return;
  const t = ctx.currentTime;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 900;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.16, t + dur * 0.35);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  f.connect(g).connect(musicBus);
  for (const fr of freqs) {
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = fr;
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
  }
}

export function startMusic(world: number): void {
  if (!ctx) return;
  if (musicTimer && musicWorld === world) return;
  stopMusic();
  musicWorld = world;
  musicStep = 0;
  const tick = () => {
    if (!ctx) return;
    const w = Math.max(0, Math.min(3, musicWorld - 1));
    if (musicStep % 8 === 0) pad(WORLD_CHORDS[w][(musicStep / 8) % 4], 4.6);
    const scale = WORLD_SCALES[w];
    // Sparse, gently random melody.
    if (Math.random() < 0.42) {
      const n = scale[Math.floor(Math.random() * scale.length)] * (Math.random() < 0.3 ? 2 : 1);
      tone(n, 1.1, { type: 'sine', vol: 0.09, attack: 0.02, bus: musicBus });
    }
    musicStep++;
  };
  tick();
  musicTimer = window.setInterval(tick, 560);
}

export function stopMusic(): void {
  if (musicTimer) window.clearInterval(musicTimer);
  musicTimer = 0;
}
