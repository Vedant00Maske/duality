// Procedurally generated textures. Everything is drawn once at boot into
// canvases, so the game ships zero image assets and loads instantly.

import Phaser from 'phaser';

export const COLORS = {
  ember: 0xff8a3d,
  ember2: 0xffd166,
  tide: 0x3cc8ff,
  tide2: 0xa6f0ff,
  link: 0xc79bff,
  white: 0xffffff,
  toxic: 0x7dde4a,
};

/** Wiring hues used to show which activator drives which mechanism. */
export const HUES = [0xffd166, 0xc79bff, 0x6ee7a8, 0xff6b81, 0x5ec8ff, 0xffa45c];
export const HUES_CSS = ['#ffd166', '#c79bff', '#6ee7a8', '#ff6b81', '#5ec8ff', '#ffa45c'];

export interface Palette {
  name: string;
  skyTop: string;
  skyBot: string;
  far: string;
  mid: string;
  rock: string;
  rockLight: string;
  rockDark: string;
  rim: string;
  rimGlow: string;
  accent: string;
  mote: number;
}

export const PALETTES: Palette[] = [
  { name: 'caverns', skyTop: '#0d0a16', skyBot: '#2a1626', far: '#1a1222', mid: '#22172b', rock: '#2d2535', rockLight: '#3b3045', rockDark: '#1a141f', rim: '#f0a65a', rimGlow: 'rgba(255,160,80,0.45)', accent: '#3fd0c9', mote: 0xffa25a },
  { name: 'machineworks', skyTop: '#0a1019', skyBot: '#1f2c3a', far: '#151e29', mid: '#1b2633', rock: '#2d3846', rockLight: '#3c4a5a', rockDark: '#19212b', rim: '#d6ad62', rimGlow: 'rgba(230,180,90,0.4)', accent: '#e07a3f', mote: 0xffc56b },
  { name: 'temple', skyTop: '#140c26', skyBot: '#3c2552', far: '#22163a', mid: '#2c1d45', rock: '#3d3155', rockLight: '#51436d', rockDark: '#251c36', rim: '#f6e9c8', rimGlow: 'rgba(255,230,170,0.45)', accent: '#ffd36b', mote: 0xfff1c4 },
  { name: 'sky', skyTop: '#0a1838', skyBot: '#3a6f9e', far: '#16305a', mid: '#1d3c68', rock: '#2a4266', rockLight: '#3a5884', rockDark: '#182a45', rim: '#d4f4ff', rimGlow: 'rgba(200,240,255,0.5)', accent: '#ffffff', mote: 0xdff6ff },
];

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function add(scene: Phaser.Scene, key: string, c: HTMLCanvasElement): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, c);
}

export function makeTextures(scene: Phaser.Scene): void {
  // Soft radial glow
  {
    const [c, g] = canvas(128, 128);
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    add(scene, 'glow', c);
  }
  // Particle dot
  {
    const [c, g] = canvas(16, 16);
    const grad = g.createRadialGradient(8, 8, 0, 8, 8, 8);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.8)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 16, 16);
    add(scene, 'dot', c);
  }
  // Spark (elongated)
  {
    const [c, g] = canvas(8, 20);
    const grad = g.createLinearGradient(0, 0, 0, 20);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(4, 10, 2.2, 10, 0, 0, Math.PI * 2);
    g.fill();
    add(scene, 'spark', c);
  }
  // Characters (drawn at 3x for crisp scaling)
  add(scene, 'ember-body', drawEmber());
  add(scene, 'tide-body', drawTide());
  // Crate
  {
    const S = 30 * 3;
    const [c, g] = canvas(S, S);
    g.scale(3, 3);
    g.fillStyle = '#7a4f2c';
    roundRect(g, 0, 0, 30, 30, 3);
    g.fill();
    g.fillStyle = '#9a6a3c';
    roundRect(g, 2, 2, 26, 26, 2);
    g.fill();
    g.strokeStyle = '#5c3a1f';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(4, 4); g.lineTo(26, 26); g.moveTo(26, 4); g.lineTo(4, 26);
    g.stroke();
    g.strokeStyle = '#c99a62';
    g.lineWidth = 1;
    g.strokeRect(2.5, 2.5, 25, 25);
    g.fillStyle = '#d8b07a';
    for (const [x, y] of [[4, 4], [26, 4], [4, 26], [26, 26]]) { g.beginPath(); g.arc(x, y, 1.4, 0, Math.PI * 2); g.fill(); }
    add(scene, 'crate', c);
  }
  // Saw blade
  {
    const S = 32 * 3;
    const [c, g] = canvas(S, S);
    g.scale(3, 3);
    g.translate(16, 16);
    g.fillStyle = '#c9d2dc';
    g.beginPath();
    const teeth = 12;
    for (let i = 0; i < teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? 15 : 11.5;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    g.fillStyle = '#7d8896';
    g.beginPath(); g.arc(0, 0, 8, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ff6b81';
    g.beginPath(); g.arc(0, 0, 3, 0, Math.PI * 2); g.fill();
    add(scene, 'saw', c);
  }
  // Resonance crystal
  {
    const [c, g] = canvas(48 * 2, 64 * 2);
    g.scale(2, 2);
    const grad = g.createLinearGradient(0, 0, 48, 64);
    grad.addColorStop(0, '#f2e6ff');
    grad.addColorStop(0.45, '#c79bff');
    grad.addColorStop(1, '#6a3fd1');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(24, 2); g.lineTo(42, 24); g.lineTo(24, 62); g.lineTo(6, 24); g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.beginPath();
    g.moveTo(24, 2); g.lineTo(30, 24); g.lineTo(24, 46); g.lineTo(14, 24); g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(24, 2); g.lineTo(42, 24); g.lineTo(24, 62); g.lineTo(6, 24); g.closePath();
    g.stroke();
    add(scene, 'crystal', c);
  }
  // Liquid surfaces (tileable horizontally)
  for (const [key, top, mid] of [['lava', '#fff0a0', '#ff9b2f'], ['water', '#e6fdff', '#59cfff'], ['toxic', '#eaffb0', '#8be04e']] as const) {
    const [c, g] = canvas(64, 12);
    g.fillStyle = mid;
    g.beginPath();
    g.moveTo(0, 12);
    for (let x = 0; x <= 64; x++) g.lineTo(x, 5 + Math.sin((x / 64) * Math.PI * 4) * 2.2);
    g.lineTo(64, 12);
    g.closePath();
    g.fill();
    g.strokeStyle = top;
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x <= 64; x++) g.lineTo(x, 5 + Math.sin((x / 64) * Math.PI * 4) * 2.2);
    g.stroke();
    add(scene, `surf-${key}`, c);
  }
  // Elemental gate curtain (tileable vertically)
  for (const [key, col] of [['gate-ember', '255,140,60'], ['gate-tide', '60,200,255']] as const) {
    const [c, g] = canvas(32, 64);
    for (let i = 0; i < 14; i++) {
      const x = (i * 7.3) % 32;
      const grad = g.createLinearGradient(0, 0, 0, 64);
      grad.addColorStop(0, `rgba(${col},0)`);
      grad.addColorStop(0.5, `rgba(${col},${0.25 + (i % 3) * 0.15})`);
      grad.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = grad;
      g.fillRect(x, (i * 17) % 64 - 32, 2, 64);
      g.fillRect(x, ((i * 17) % 64) + 32, 2, 64);
    }
    g.fillStyle = `rgba(${col},0.18)`;
    g.fillRect(0, 0, 32, 64);
    add(scene, key, c);
  }
  // Wind streak
  {
    const [c, g] = canvas(4, 24);
    const grad = g.createLinearGradient(0, 0, 0, 24);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 24);
    add(scene, 'streak', c);
  }
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const CHAR_SCALE = 3;
export const CHAR_W = 30;
export const CHAR_H = 36;

function drawEmber(): HTMLCanvasElement {
  const [c, g] = canvas(CHAR_W * CHAR_SCALE, CHAR_H * CHAR_SCALE);
  g.scale(CHAR_SCALE, CHAR_SCALE);
  // Flame silhouette
  g.beginPath();
  g.moveTo(15, 1);
  g.bezierCurveTo(19, 7, 22, 6, 23, 3);
  g.bezierCurveTo(28, 10, 29, 18, 27, 25);
  g.bezierCurveTo(25, 33, 20, 36, 15, 36);
  g.bezierCurveTo(10, 36, 5, 33, 3, 25);
  g.bezierCurveTo(1, 18, 3, 11, 8, 6);
  g.bezierCurveTo(9, 9, 11, 9, 12, 7);
  g.bezierCurveTo(12, 5, 13, 3, 15, 1);
  g.closePath();
  const grad = g.createLinearGradient(0, 0, 0, 36);
  grad.addColorStop(0, '#ffe08a');
  grad.addColorStop(0.45, '#ff9a3c');
  grad.addColorStop(1, '#e2482b');
  g.fillStyle = grad;
  g.fill();
  // Inner glow core
  const core = g.createRadialGradient(15, 26, 1, 15, 26, 11);
  core.addColorStop(0, 'rgba(255,250,210,0.95)');
  core.addColorStop(1, 'rgba(255,220,120,0)');
  g.fillStyle = core;
  g.fill();
  g.strokeStyle = 'rgba(120,30,10,0.55)';
  g.lineWidth = 1.2;
  g.stroke();
  return c;
}

function drawTide(): HTMLCanvasElement {
  const [c, g] = canvas(CHAR_W * CHAR_SCALE, CHAR_H * CHAR_SCALE);
  g.scale(CHAR_SCALE, CHAR_SCALE);
  // Droplet silhouette
  g.beginPath();
  g.moveTo(15, 2);
  g.bezierCurveTo(19, 9, 28, 16, 28, 25);
  g.bezierCurveTo(28, 32, 22, 36, 15, 36);
  g.bezierCurveTo(8, 36, 2, 32, 2, 25);
  g.bezierCurveTo(2, 16, 11, 9, 15, 2);
  g.closePath();
  const grad = g.createLinearGradient(0, 0, 0, 36);
  grad.addColorStop(0, '#d9fbff');
  grad.addColorStop(0.5, '#4fd0ff');
  grad.addColorStop(1, '#1673c4');
  g.fillStyle = grad;
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.beginPath();
  g.ellipse(9.5, 20, 2.2, 4.5, -0.4, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(10,50,110,0.55)';
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(15, 2);
  g.bezierCurveTo(19, 9, 28, 16, 28, 25);
  g.bezierCurveTo(28, 32, 22, 36, 15, 36);
  g.bezierCurveTo(8, 36, 2, 32, 2, 25);
  g.bezierCurveTo(2, 16, 11, 9, 15, 2);
  g.closePath();
  g.stroke();
  return c;
}
