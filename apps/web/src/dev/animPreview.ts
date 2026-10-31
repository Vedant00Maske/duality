// Dev-only page (anim-preview.html): every animation tag for both characters,
// facing right and mirrored left, with hitbox / pivot / baseline overlays.
// Uses the same loader + createFromAseprite path as the game.

import Phaser from 'phaser';
import { PlayerTuning } from '@duality/shared';
import { ANIM_LOOPS, CHARACTER_SHEETS, CHARACTER_SPEC, SHEET_KEY, type CharAnim } from '../art/characters';

const ZOOM = 3;
const CELL_W = 64;
const CELL_H = 56;
const LEFT = 92;
const TOP = 26;
const BW = PlayerTuning.bodyW;
const BH = PlayerTuning.bodyH;

class AnimPreview extends Phaser.Scene {
  constructor() {
    super('anim-preview');
  }

  preload(): void {
    for (const s of CHARACTER_SHEETS) this.load.aseprite(s.key, s.png, s.json);
  }

  create(): void {
    for (const k of SHEET_KEY) this.textures.get(k).setFilter(Phaser.Textures.FilterMode.NEAREST);
    const cam = this.cameras.main;
    cam.setZoom(ZOOM);
    cam.setScroll(0, 0);
    cam.setOrigin(0, 0);
    const g = this.add.graphics().setDepth(10);
    const cols: Array<[number, boolean, string]> = [[0, false, 'Ember →'], [0, true, 'Ember ←'], [1, false, 'Tide →'], [1, true, 'Tide ←']];
    const text = (x: number, y: number, s: string, size = 8) =>
      this.add.text(x, y, s, { fontFamily: 'monospace', fontSize: `${size}px`, color: '#c9c0de', resolution: ZOOM * 2 });

    cols.forEach(([, , label], ci) => text(LEFT + ci * CELL_W + 14, 6, label));
    const sprites: Phaser.GameObjects.Sprite[] = [];
    CHARACTER_SPEC.animations.forEach((a, row) => {
      const baseY = TOP + row * CELL_H + 46; // feet line for this row
      text(4, baseY - 26, a.tag, 8);
      text(4, baseY - 15, `${a.frames}f ${a.fps}fps ${a.loop ? 'loop' : 'once'}`, 6);
      cols.forEach(([who, flip], ci) => {
        const fx = LEFT + ci * CELL_W + CELL_W / 2; // pivot x
        const sp = this.add.sprite(fx, baseY, SHEET_KEY[who], '0').setOrigin(0.5, 1).setFlipX(flip);
        this.anims.createFromAseprite(SHEET_KEY[who], undefined, sp);
        sp.play({ key: a.tag as CharAnim, repeat: -1, repeatDelay: ANIM_LOOPS[a.tag as CharAnim] ? 0 : 350 });
        sprites.push(sp);
        // Physics body (what collision uses) and pivot
        g.lineStyle(1 / ZOOM, 0x00ff66, 1).strokeRect(fx - BW / 2, baseY - BH, BW, BH);
        g.lineStyle(1 / ZOOM, 0xffffff, 0.6).lineBetween(fx - 18, baseY, fx + 18, baseY);
        g.lineStyle(1 / ZOOM, 0xff00ff, 1).lineBetween(fx - 3, baseY, fx + 3, baseY).lineBetween(fx, baseY - 3, fx, baseY + 3);
      });
    });
    (window as unknown as { __preview: unknown }).__preview = {
      sprites: sprites.map((s) => ({ anim: s.anims.currentAnim?.key, flipX: s.flipX, frames: s.anims.currentAnim?.frames.length })),
      ready: true,
    };
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'stage',
  width: (LEFT + 4 * CELL_W + 8) * ZOOM,
  height: (TOP + CHARACTER_SPEC.animations.length * CELL_H + 8) * ZOOM,
  backgroundColor: '#1a1530',
  banner: false,
  render: { antialias: true, roundPixels: false },
  scene: [AnimPreview],
});
