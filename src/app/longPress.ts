import { useRef } from 'preact/hooks';

export const LONG_PRESS_MS = 550;

/**
 * Click for a pointer, and on the remote: press OK for the normal action, hold OK for the menu.
 * The remote's OK is an Enter key, so the keyboard path is handled here and the browser's own
 * "Enter clicks a button" is cancelled; otherwise the short action would already have run when
 * the hold begins.
 */
export function useLongPress(onShort: () => void, onLong: () => void) {
  const state = useRef<{ timer?: ReturnType<typeof setTimeout>; pressed: boolean; fired: boolean }>({ pressed: false, fired: false });
  const clear = () => { if (state.current.timer !== undefined) clearTimeout(state.current.timer); state.current = { pressed: false, fired: false }; };
  return {
    onClick: () => onShort(),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (event.repeat || state.current.pressed) return;
      state.current.pressed = true;
      state.current.timer = setTimeout(() => { state.current.fired = true; state.current.timer = undefined; onLong(); }, LONG_PRESS_MS);
    },
    onKeyUp: (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !state.current.pressed) return;
      const wasLong = state.current.fired;
      clear();
      if (!wasLong) onShort();
    },
    onBlur: clear,
  };
}
