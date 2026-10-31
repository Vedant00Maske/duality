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
let musicWorld = 0;
let musicStep = 0;

function applyVolumes(): void {
  if (!ctx) return;
  master.gain.setTargetAtTime(settings.mute ? 0 : 0.9, ctx.currentTime, 0.03);
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
    // Background tabs are throttled; pause the whole graph so music never bunches up.
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) void ctx.suspend(); else void ctx.resume();
    });
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

const lastPlayed = new Map<string, number>();
/** Guards against stacking identical sounds in the same instant (e.g. two plates at once). */
function once(id: string, gapMs: number, fn: () => void): void {
  const now = performance.now();
  if (now - (lastPlayed.get(id) ?? -1e9) < gapMs) return;
  lastPlayed.set(id, now);
  fn();
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
  confirm: () => { tone(587, 0.08, { type: 'triangle', vol: 0.15 }); tone(880, 0.14, { type: 'triangle', vol: 0.15, delay: 0.06 }); },
  /** Footsteps: Ember crackles, Tide splashes. */
  step: (el: number, vol = 1) => once(`step${el}`, 120, () => {
    if (el === 0) noise(0.05, { freq: 2600, q: 2, vol: 0.05 * vol });
    else noise(0.07, { freq: 900, q: 3, vol: 0.06 * vol, slide: 1.6 });
  }),
  crate: () => once('crate', 160, () => noise(0.16, { freq: 260, q: 1.5, vol: 0.09, type: 'lowpass' })),
  bridge: (on: boolean) => once('bridge', 200, () => {
    [660, 990, 1320].forEach((f, i) => tone(on ? f : 1320 - i * 330, 0.22, { vol: 0.06, delay: i * 0.04 }));
  }),
  victory: () => {
    [392, 523, 659, 784, 659, 784, 1046].forEach((f, i) => tone(f, i === 6 ? 1.2 : 0.22, { type: 'triangle', vol: 0.14, delay: 0.5 + i * 0.13 }));
    [262, 330, 392].forEach((f) => tone(f, 2.2, { type: 'sine', vol: 0.08, delay: 1.3, attack: 0.3 }));
  },
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
// World music: a small look-ahead sequencer. Each world is a composed 4-bar
// loop (64 sixteenth-note steps) rendered live with oscillators, scheduled on
// the AudioContext clock so the loop point is sample-accurate and seamless.

const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

interface Track {
  bpm: number;
  /** Chord per bar (MIDI notes). */
  chords: number[][];
  /** Bass note per 8th step (MIDI, -1 rest), 32 entries over 4 bars. */
  bass: number[];
  /** Arpeggio voice: indices into the bar's chord (-1 rest), 16 per bar. */
  arp: number[];
  arpWave: OscillatorType;
  arpOct: number;
  /** Melody: MIDI per 16th step (-1 rest), 64 entries. */
  melody: number[];
  melWave: OscillatorType;
  kick?: number[];
  hat?: number[];
  padWave: OscillatorType;
  padCut: number;
  /** Long airy noise swell at the start of each loop (Sky Vault wind). */
  wind?: boolean;
  bells?: boolean;
}

const R = -1;
const mel = (s: string): number[] => s.split(' ').flatMap((t) => (t === '.' ? [R] : [Number(t)]));

const TRACKS: Track[] = [
  { // Elemental Caverns — mysterious, warm, adventurous (A minor, 84 BPM)
    bpm: 84, chords: [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]],
    bass: [45, R, R, 45, R, R, 52, R, 41, R, R, 41, R, R, 48, R, 43, R, R, 43, R, R, 50, R, 40, R, R, 40, R, 47, R, R],
    arp: [0, R, 1, R, 2, R, 1, R, 0, R, 1, R, 2, R, 1, 2], arpWave: 'triangle', arpOct: 12,
    melody: mel('76 . . . 74 . 72 . . . 69 . . . . . 72 . . . 71 . 69 . 67 . . . . . . . 71 . . . 72 . 74 . . . 71 . . . . . 67 . . . 69 . 71 . 64 . . . . . . .'),
    melWave: 'sine', padWave: 'triangle', padCut: 900,
  },
  { // Machineworks — rhythmic, mechanical, energetic (D dorian, 108 BPM)
    bpm: 108, chords: [[50, 53, 57], [48, 52, 55], [46, 50, 53], [48, 52, 55]],
    bass: [38, R, 38, 50, R, 38, 48, R, 36, R, 36, 48, R, 36, 43, R, 34, R, 34, 46, R, 34, 41, R, 36, R, 36, 48, R, 43, 45, R],
    arp: [0, 2, 1, 2, 0, 2, 1, 2, 0, 2, 1, 2, 0, 2, 1, 2], arpWave: 'square', arpOct: 12,
    melody: mel('. . . . 69 . 72 . . . 74 . 72 . 69 . . . . . 67 . 69 . . . 64 . . . . . . . . . 65 . 69 . . . 72 . 70 . 69 . . . . . 67 . 64 . 67 . 69 . . . . .'),
    melWave: 'triangle', kick: [0, 4, 8, 10, 12], hat: [2, 6, 10, 14], padWave: 'sawtooth', padCut: 600,
  },
  { // Light Temple — mystical, atmospheric, uplifting (C lydian, 72 BPM)
    bpm: 72, chords: [[48, 55, 64, 67], [50, 57, 62, 66], [45, 52, 60, 64], [43, 50, 59, 62]],
    bass: [36, R, R, R, R, R, R, R, 38, R, R, R, R, R, R, R, 33, R, R, R, R, R, R, R, 31, R, R, R, R, R, 38, R],
    arp: [0, R, R, 2, R, R, 3, R, R, 1, R, R, 2, R, 3, R], arpWave: 'sine', arpOct: 24,
    melody: mel('79 . . . . . 78 . 76 . . . . . . . 74 . . . 76 . . . 78 . . . . . . . 72 . . . 74 . 76 . . . 79 . . . . . 81 . . . 79 . . . 74 . . . . . . .'),
    melWave: 'sine', padWave: 'triangle', padCut: 1400, bells: true,
  },
  { // Sky Vault — expansive, airy, adventurous (F major, 96 BPM)
    bpm: 96, chords: [[53, 57, 60, 64], [55, 58, 62, 65], [57, 60, 64, 67], [48, 55, 60, 64]],
    bass: [41, R, R, R, 48, R, R, R, 43, R, R, R, 50, R, R, R, 45, R, R, R, 52, R, R, R, 36, R, R, R, 43, R, 48, R],
    arp: [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3], arpWave: 'triangle', arpOct: 12,
    melody: mel('72 . . . 74 . 76 . . . 79 . . . 77 . 76 . . . . . 74 . 72 . . . . . . . 74 . . . 76 . 77 . . . 81 . . . 79 . 77 . . . 76 . . . 74 . . . . . . .'),
    melWave: 'sine', hat: [6, 14], padWave: 'triangle', padCut: 2000, wind: true,
  },
];

let musicGain: GainNode | null = null;
let schedTimer = 0;
let nextStepTime = 0;

function voice(freq: number, t: number, dur: number, wave: OscillatorType, vol: number, out: AudioNode, attack = 0.01, vibrato = 0): void {
  const c = ctx!;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = wave;
  o.frequency.setValueAtTime(freq, t);
  if (vibrato) {
    const l = c.createOscillator();
    const lg = c.createGain();
    l.frequency.value = 5.5;
    lg.gain.value = vibrato;
    l.connect(lg).connect(o.frequency);
    l.start(t);
    l.stop(t + dur + 0.1);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function scheduleStep(tr: Track, step: number, t: number, out: GainNode): void {
  const c = ctx!;
  const s16 = 60 / tr.bpm / 4;
  const bar = Math.floor(step / 16) % 4;
  const chord = tr.chords[bar];
  if (step % 16 === 0) { // pad: one per bar, overlapping the next for a seamless bed
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = tr.padCut;
    const g = c.createGain();
    const dur = s16 * 16 * 1.25;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + s16 * 4);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(out);
    for (const n of chord) for (const det of [-7, 7]) {
      const o = c.createOscillator();
      o.type = tr.padWave;
      o.frequency.value = mtof(n);
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }
  if (step % 2 === 0) {
    const b = tr.bass[(step / 2) % 32];
    if (b >= 0) voice(mtof(b), t, s16 * 3, 'sine', 0.16, out, 0.01);
  }
  const ai = tr.arp[step % 16];
  if (ai >= 0) voice(mtof(chord[ai % chord.length] + tr.arpOct), t, s16 * (tr.bells ? 6 : 1.6), tr.arpWave, tr.arpWave === 'square' ? 0.018 : 0.04, out, 0.005);
  const m = tr.melody[step % 64];
  if (m >= 0) {
    voice(mtof(m), t, s16 * 5, tr.melWave, 0.05, out, 0.03, 4);
    if (tr.bells) voice(mtof(m) * 2.01, t, s16 * 8, 'sine', 0.015, out, 0.002);
  }
  if (tr.kick?.includes(step % 16)) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.2);
  }
  if (tr.hat?.includes(step % 16) || (tr.wind && step % 64 === 0)) {
    const wind = !!tr.wind && step % 64 === 0;
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    const f = c.createBiquadFilter();
    f.type = wind ? 'bandpass' : 'highpass';
    f.frequency.setValueAtTime(wind ? 500 : 7000, t);
    if (wind) f.frequency.linearRampToValueAtTime(1400, t + s16 * 32);
    const g = c.createGain();
    const dur = wind ? s16 * 60 : 0.05;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(wind ? 0.03 : 0.035, t + (wind ? s16 * 24 : 0.003));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.loop = true;
    src.start(t);
    src.stop(t + dur + 0.05);
  }
}

export function startMusic(world: number): void {
  if (!ctx) return;
  if (schedTimer && musicWorld === world) return; // never stack two tracks
  stopMusic();
  musicWorld = world;
  musicStep = 0;
  const tr = TRACKS[Math.max(0, Math.min(3, world - 1))];
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 2.5); // fade in, never an abrupt start
  g.connect(musicBus);
  musicGain = g;
  nextStepTime = ctx.currentTime + 0.08;
  const s16 = 60 / tr.bpm / 4;
  const pump = () => {
    if (!ctx || musicGain !== g) return;
    while (nextStepTime < ctx.currentTime + 0.35) {
      scheduleStep(tr, musicStep, nextStepTime, g);
      musicStep = (musicStep + 1) % 64;
      nextStepTime += s16;
    }
  };
  pump();
  schedTimer = window.setInterval(pump, 90);
}

export function stopMusic(): void {
  if (schedTimer) window.clearInterval(schedTimer);
  schedTimer = 0;
  musicWorld = 0;
  if (ctx && musicGain) {
    const g = musicGain;
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.25); // fade out
    window.setTimeout(() => g.disconnect(), 2000);
  }
  musicGain = null;
}

/** Current music state (for tests): world playing, or 0. */
export function musicState(): { world: number; running: boolean; ctx: string } {
  return { world: musicWorld, running: !!schedTimer, ctx: ctx?.state ?? 'none' };
}
