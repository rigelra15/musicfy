/** Whether things may animate in and out. False without a browser that can say so (tests) and when the person asked for less motion. */
export function motionAllowed(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** How long a popup takes to leave; its leave animation in styles.css lasts the same. */
export const EXIT_MS = 170;
