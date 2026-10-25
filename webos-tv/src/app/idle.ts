import { useEffect, useRef, useState } from 'preact/hooks';

/** How long without the remote or pointer before the navbar slides away on the player screen. */
export const NAV_IDLE_MS = 4000;
/** Pointer moves smaller than this are jitter, not someone using the pointer. */
const MOVE_SLOP = 3;

/**
 * True once nothing was pressed or pointed for `delayMs`. Only real input counts (keys, pointer moves and presses, wheel, touch):
 * playback progress, lyric changes and focus moved by the app never do. While `blocked()` says so (a dialog, a menu, typing, the
 * navbar itself in use) the countdown starts over instead of finishing. One set of listeners and one timer, both removed on cleanup.
 */
export function useIdle(delayMs: number, enabled: boolean, blocked: () => boolean): boolean {
  const [idle, setIdle] = useState(false);
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  useEffect(() => {
    if (!enabled) { setIdle(false); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastX = -1;
    let lastY = -1;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { if (blockedRef.current()) arm(); else setIdle(true); }, delayMs);
    };
    const active = () => { setIdle(false); arm(); };
    const onMove = (event: PointerEvent | MouseEvent) => {
      if (lastX >= 0 && Math.abs(event.clientX - lastX) + Math.abs(event.clientY - lastY) < MOVE_SLOP) return;
      lastX = event.clientX; lastY = event.clientY;
      active();
    };
    window.addEventListener('keydown', active, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerdown', active, true);
    window.addEventListener('wheel', active, { capture: true, passive: true });
    window.addEventListener('touchstart', active, { capture: true, passive: true });
    arm();
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('keydown', active, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerdown', active, true);
      window.removeEventListener('wheel', active, true);
      window.removeEventListener('touchstart', active, true);
    };
  }, [enabled, delayMs]);
  return enabled && idle;
}

/** Something the person is in the middle of: typing, a picker, an open menu, or the navbar's own items. */
export function navInUse(): boolean {
  const element = document.activeElement as HTMLElement | null;
  if (!element) return false;
  if (element.closest('.primary-nav')) return true;
  if (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) return true;
  return Boolean(document.querySelector('.overlay-layer, .player-menu[open]'));
}
