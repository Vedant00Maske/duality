// Keyboard + touch input. Held keys are sampled every simulation tick; presses
// are latched as edges so a tap shorter than one tick is never lost.

import { Btn } from '@duality/shared';

type Action = 'left' | 'right' | 'jump' | 'interact';

const KEYMAP: Record<string, Action> = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
  KeyE: 'interact', KeyX: 'interact', Enter: 'interact',
};

export interface InputHooks {
  pause: () => void;
  restart: () => void;
  overview: () => void;
  debug: () => void;
  enabled: () => boolean;
}

export class Input {
  private keys = new Set<string>();
  private touch: Record<Action, Set<number>> = { left: new Set(), right: new Set(), jump: new Set(), interact: new Set() };
  private jumpEdge = false;
  private interactEdge = false;

  constructor(private hooks: InputHooks) {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });
  }

  private isTyping(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.isTyping(e)) return;
    const action = KEYMAP[e.code];
    if (action || e.code === 'Tab') e.preventDefault();
    if (!this.hooks.enabled()) return;
    if (e.code === 'Escape') { this.hooks.pause(); return; }
    if (e.repeat) return;
    if (e.code === 'KeyR') { this.hooks.restart(); return; }
    if (e.code === 'Tab' || e.code === 'KeyM') { this.hooks.overview(); return; }
    if (e.code === 'F3' || e.code === 'Backquote') { e.preventDefault(); this.hooks.debug(); return; }
    if (!action) return;
    this.keys.add(e.code);
    if (action === 'jump') this.jumpEdge = true;
    if (action === 'interact') this.interactEdge = true;
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private held(action: Action): boolean {
    if (this.touch[action].size) return true;
    for (const k of this.keys) if (KEYMAP[k] === action) return true;
    return false;
  }

  clear(): void {
    this.keys.clear();
    for (const s of Object.values(this.touch)) s.clear();
    this.jumpEdge = false;
    this.interactEdge = false;
    document.querySelectorAll('.tbtn.down').forEach((b) => b.classList.remove('down'));
  }

  /** Bits for the next simulation tick; consumes latched edges. */
  sample(): number {
    let bits = 0;
    if (this.held('left')) bits |= Btn.Left;
    if (this.held('right')) bits |= Btn.Right;
    if (this.held('jump')) bits |= Btn.JumpHeld;
    if (this.jumpEdge) bits |= Btn.JumpPressed | Btn.JumpHeld;
    if (this.interactEdge) bits |= Btn.InteractPressed;
    this.jumpEdge = false;
    this.interactEdge = false;
    return bits;
  }

  /** Wire the on-screen touch buttons. */
  bindTouch(root: HTMLElement): void {
    root.querySelectorAll<HTMLButtonElement>('.tbtn').forEach((btn) => {
      const action = btn.dataset.btn as Action;
      const down = (e: PointerEvent) => {
        e.preventDefault();
        try { btn.setPointerCapture(e.pointerId); } catch { /* pointer already gone; still register the press */ }
        this.touch[action].add(e.pointerId);
        btn.classList.add('down');
        if (action === 'jump') this.jumpEdge = true;
        if (action === 'interact') this.interactEdge = true;
        navigator.vibrate?.(8);
      };
      const up = (e: PointerEvent) => {
        // The pointer may have slid onto another button; release it everywhere.
        for (const a of Object.keys(this.touch) as Action[]) {
          this.touch[a].delete(e.pointerId);
          if (!this.touch[a].size) root.querySelector(`[data-btn="${a}"]`)?.classList.remove('down');
        }
      };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
    // Sliding a thumb between ◀ and ▶ switches direction without lifting.
    const left = root.querySelector<HTMLElement>('.touch-left');
    left?.addEventListener('pointermove', (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const target = el?.closest<HTMLElement>('.tbtn')?.dataset.btn as Action | undefined;
      if (!target || (target !== 'left' && target !== 'right')) return;
      const other: Action = target === 'left' ? 'right' : 'left';
      if (this.touch[other].has(e.pointerId)) {
        this.touch[other].delete(e.pointerId);
        this.touch[target].add(e.pointerId);
        root.querySelector(`[data-btn="${other}"]`)?.classList.toggle('down', this.touch[other].size > 0);
        root.querySelector(`[data-btn="${target}"]`)?.classList.add('down');
      }
    });
  }
}
