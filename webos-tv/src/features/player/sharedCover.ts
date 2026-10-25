import { motionAllowed } from '../../app/motion';

type Direction = 'toPlayer' | 'toMini';
interface Remembered { direction: Direction; left: number; top: number; width: number; height: number; at: number }

let remembered: Remembered | undefined;
const MAX_AGE_MS = 900;
export const FLIGHT_MS = 440;

/** Notes where a cover is on screen right before the page changes, so the next page can start its cover from there. */
export function rememberCover(element: Element | null | undefined, direction: Direction): void {
  if (!element) return;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  remembered = { direction, left: rect.left, top: rect.top, width: rect.width, height: rect.height, at: Date.now() };
}

/** What was noted for this direction a moment ago, once. */
export function takeCover(direction: Direction): Remembered | undefined {
  const note = remembered;
  if (!note || note.direction !== direction || Date.now() - note.at > MAX_AGE_MS) return undefined;
  remembered = undefined;
  return note;
}

/**
 * Moves an element from where it was noted to where it is now: it starts over the old cover (same centre, same
 * width) and glides and grows or shrinks into place. Nothing happens without animation support or with reduced motion.
 */
export function flyFrom(element: HTMLElement | null | undefined, from: Pick<Remembered, 'left' | 'top' | 'width' | 'height'>): void {
  if (!element || !motionAllowed() || typeof element.animate !== 'function') return;
  const to = element.getBoundingClientRect();
  if (to.width <= 0) return;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const scale = from.width / to.width;
  const viewportScale = element.offsetWidth > 0 ? to.width / element.offsetWidth : 1;
  const before = { position: element.style.position, zIndex: element.style.zIndex };
  if (getComputedStyle(element).position === 'static') element.style.position = 'relative';
  element.style.zIndex = '30';
  const flight = element.animate(
    [{ transform: `translate(${dx / viewportScale}px, ${dy / viewportScale}px) scale(${scale})` }, { transform: 'none' }],
    { duration: FLIGHT_MS, easing: 'cubic-bezier(.2, .8, .2, 1)' },
  );
  const done = () => { element.style.position = before.position; element.style.zIndex = before.zIndex; };
  flight.onfinish = done;
  flight.oncancel = done;
}
