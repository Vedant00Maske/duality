import './styles.css';
import Phaser from 'phaser';
import { GameScene } from './game/scene';
import { session } from './net/session';
import {
  applyState, gameInputEnabled, goHome, initUI, isInputBlocked, onFrame, requestRestart, setScreen, showReconnecting, toast,
  togglePause,
} from './ui/ui';
import { sfx } from './audio/sfx';
import { isTouchDevice } from './settings';

function dpr(): number {
  return Math.min(window.devicePixelRatio || 1, isTouchDevice() ? 1.75 : 2);
}

const scene = new GameScene();
scene.hooks = {
  inputBlocked: isInputBlocked,
  inputEnabled: gameInputEnabled,
  pause: togglePause,
  restart: requestRestart,
  frame: onFrame,
};

/** Even canvas dimensions keep the camera centre on a whole pixel (crisp pixel art). */
function canvasSize(): [number, number] {
  const r = dpr();
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  return [even(window.innerWidth * r), even(window.innerHeight * r)];
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0d0b17',
  banner: false,
  scale: {
    mode: Phaser.Scale.NONE,
    width: canvasSize()[0],
    height: canvasSize()[1],
    zoom: 1 / dpr(),
  },
  render: { antialias: true, roundPixels: false, powerPreference: 'high-performance' },
  input: { keyboard: false, mouse: false, touch: false, gamepad: false },
  audio: { noAudio: true },
  scene: [scene],
});

function resize(): void {
  const [w, h] = canvasSize();
  game.scale.resize(w, h);
  game.scale.setZoom(1 / dpr());
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));

// Block pinch-zoom / scroll gestures during play.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => {
  if (!(e.target as HTMLElement).closest('.screen#screen-lobby, .overlay, .home-card')) e.preventDefault();
}, { passive: false });

// Session → UI + scene
session.on('state', (s) => {
  applyState(s);
  scene.applyNet(s);
});
session.on('notice', (n) => {
  toast(n.text, n.kind);
  if (/joined|reconnected/.test(n.text)) sfx.join();
  if (/left|lost/.test(n.text)) sfx.leave();
});
session.on('drop', () => showReconnecting(true));
session.on('reconnect', () => {
  showReconnecting(false);
  toast('Reconnected!', 'good', 2000);
});
session.on('left', (reason) => {
  goHome(reason || undefined);
});

initUI();

scene.whenReady(async () => {
  scene.input2.bindTouch(document.getElementById('touch')!);
  // Recover the room after a refresh.
  if (session.hasStoredSession()) {
    try {
      const ok = await session.resume();
      if (!ok) { setScreen('home'); toast('Your previous room has closed.', 'warn'); }
    } catch {
      setScreen('home');
    }
  } else {
    setScreen('home');
  }
  document.getElementById('boot')?.classList.add('done');
  setTimeout(() => document.getElementById('boot')?.remove(), 600);
});

// Debug handle for automated tests.
(window as unknown as { __duality: unknown }).__duality = { session, scene };
