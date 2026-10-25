import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './Icon';
import './Carousel.css';

/** How long the pointer rests on a chevron before it keeps scrolling by itself. */
export const DWELL_MS = 450;
export const AUTO_SCROLL_PX_PER_S = 1100;

export interface CarouselMetrics { scrollLeft: number; clientWidth: number; scrollWidth: number; pitch: number; pad: number; gap: number }

/** The scroll position a page left or right lands on: whole cards, aligned to the left padding (never a clipped first card). */
export function pageTarget(m: CarouselMetrics, direction: -1 | 1): number {
  const max = Math.max(0, m.scrollWidth - m.clientWidth);
  if (m.pitch <= 0) return Math.min(max, Math.max(0, m.scrollLeft + direction * m.clientWidth));
  const visible = Math.max(1, Math.floor((m.clientWidth - 2 * m.pad + m.gap) / m.pitch + 0.01));
  const next = (Math.round(m.scrollLeft / m.pitch) + direction * visible) * m.pitch;
  return Math.min(max, Math.max(0, next));
}

/** Where a carousel that stopped between two cards settles: the nearest card boundary. */
export function settleTarget(m: CarouselMetrics): number {
  const max = Math.max(0, m.scrollWidth - m.clientWidth);
  if (m.pitch <= 0 || m.scrollLeft >= max - 1) return Math.min(max, m.scrollLeft);
  return Math.min(max, Math.max(0, Math.round(m.scrollLeft / m.pitch) * m.pitch));
}

/**
 * A horizontal row of cards. Cards line up on a fixed number of columns for the screen width, so the first card
 * always starts inside the padding and none is cut off at rest; the focused card is scrolled fully into view.
 * With a pointer on the screen, round chevrons appear at the sides: a click moves one page, and resting on one keeps
 * scrolling until the pointer leaves or the end is reached.
 */
export function Carousel({ label, wide, children }: { label: string; wide?: boolean; children: ComponentChildren }) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ prev: false, next: false });
  const [navTop, setNavTop] = useState<number | undefined>(undefined);
  const dwell = useRef<ReturnType<typeof setTimeout>>();
  const frame = useRef<number>();
  const auto = useRef<{ direction: -1 | 1; last: number } | null>(null);
  const justAuto = useRef(0);

  const metrics = (): CarouselMetrics | undefined => {
    const node = track.current;
    if (!node) return undefined;
    const style = getComputedStyle(node);
    const first = node.firstElementChild as HTMLElement | null;
    const second = first?.nextElementSibling as HTMLElement | null;
    const gap = parseFloat(style.columnGap || style.gap || '0') || 0;
    const pitch = first && second ? second.offsetLeft - first.offsetLeft : first ? first.offsetWidth + gap : 0;
    return { scrollLeft: node.scrollLeft, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, pitch, pad: parseFloat(style.paddingLeft) || 0, gap };
  };

  const refresh = () => {
    const node = track.current;
    if (!node) return;
    const max = node.scrollWidth - node.clientWidth;
    setEdges((old) => (old.prev === node.scrollLeft > 1 && old.next === node.scrollLeft < max - 1 ? old : { prev: node.scrollLeft > 1, next: node.scrollLeft < max - 1 }));
    const art = node.querySelector<HTMLElement>('[data-carousel-art]');
    if (art) setNavTop(art.offsetTop + art.offsetHeight / 2);
  };

  const scrollToX = (x: number) => {
    const node = track.current;
    if (!node) return;
    if (typeof node.scrollTo === 'function') node.scrollTo({ left: x, behavior: 'smooth' }); else node.scrollLeft = x;
  };

  useLayoutEffect(refresh, [children]);
  useEffect(() => {
    const node = track.current;
    if (!node) return;
    let queued = 0;
    const onScroll = () => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; refresh(); }); };
    node.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    refresh();
    return () => { node.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); if (queued) cancelAnimationFrame(queued); stopAuto(false); };
  }, []);

  const stopAuto = (settle: boolean) => {
    clearTimeout(dwell.current);
    dwell.current = undefined;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    const node = track.current;
    if (auto.current && node) {
      auto.current = null;
      justAuto.current = Date.now();
      node.style.scrollBehavior = '';
      node.style.scrollSnapType = '';
      const m = metrics();
      if (settle && m) scrollToX(settleTarget(m));
    }
  };

  const beginAuto = (direction: -1 | 1) => {
    const node = track.current;
    if (!node) return;
    node.style.scrollBehavior = 'auto';
    node.style.scrollSnapType = 'none';
    let position = node.scrollLeft;                       // kept as a fraction: the element may round what it is given
    auto.current = { direction, last: performance.now() };
    const step = (now: number) => {
      const state = auto.current;
      if (!state || !track.current) return;
      const dt = Math.max(0, Math.min(64, now - state.last));   // a frame's own time can be a hair older than "last"
      state.last = Math.max(state.last, now);
      const max = node.scrollWidth - node.clientWidth;
      position = Math.min(max, Math.max(0, position + state.direction * AUTO_SCROLL_PX_PER_S * dt / 1000));
      node.scrollLeft = position;
      if ((state.direction > 0 && position >= max - 0.5) || (state.direction < 0 && position <= 0.5)) { refresh(); stopAuto(false); return; }
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };

  const startDwell = (direction: -1 | 1) => { stopAuto(false); dwell.current = setTimeout(() => beginAuto(direction), DWELL_MS); };
  /** The pointer can arrive while the chevron is still fading in, so a move over it arms the wait too. */
  const armDwell = (direction: -1 | 1) => { if (dwell.current === undefined && !auto.current && Date.now() - justAuto.current > 600) startDwell(direction); };
  const page = (direction: -1 | 1) => {
    if (Date.now() - justAuto.current < 350) return;          // the click that ended a long hover is not a page
    stopAuto(false);
    const m = metrics();
    if (m) scrollToX(pageTarget(m, direction));
  };

  return (
    <div class={`carousel ${wide ? 'is-wide' : ''}`} role="group" aria-label={label} style={navTop !== undefined ? `--nav-top:${navTop}px` : undefined}>
      <div class="carousel-track" ref={track}>{children}</div>
      {(['prev', 'next'] as const).map((side) => {
        const direction = side === 'prev' ? -1 : 1;
        const shown = edges[side];
        return (
          <button
            key={side}
            type="button"
            tabIndex={-1}
            class={`carousel-nav carousel-${side} ${shown ? 'is-shown' : ''}`}
            aria-hidden="true"
            data-carousel-nav={side}
            disabled={!shown}
            onClick={() => page(direction)}
            onMouseEnter={() => startDwell(direction)}
            onMouseMove={() => armDwell(direction)}
            onMouseLeave={() => stopAuto(true)}
            onBlur={() => stopAuto(true)}
          >
            <Icon name={side === 'prev' ? 'chevron-left' : 'chevron-right'} />
          </button>
        );
      })}
    </div>
  );
}
