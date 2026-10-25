import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import './ScrollText.css';

interface ScrollTextProps { text: string; children?: ComponentChildren; reducedMotion?: boolean }

/** One semantic copy of the text; only overflowing text travels, with pauses at both ends. */
export function ScrollText({ text, children, reducedMotion = false }: ScrollTextProps) {
  const viewport = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const view = viewport.current;
    const line = content.current;
    if (!view || !line) return;
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let overflow = 0;
    let offset = 0;
    let target = 0;
    let from = 0;
    let started = 0;
    let duration = 0;
    let waitUntil = 0;
    let waitRemaining = 2000;
    let moving = false;
    let towardsEnd = true;
    let hovering = view.matches(':hover');
    let focused = view.contains(document.activeElement);
    let lastWidth = -1;
    let lastContentWidth = -1;
    const reduced = () => reducedMotion || media?.matches === true;
    const paused = () => hovering || focused || document.hidden || reduced();
    const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
    const paint = (value: number, travelling = false) => {
      offset = value;
      line.style.transform = `translate3d(${value}px,0,0)`;
      // Fade only edges with clipped text; the first/last letters stay sharp during the end pauses.
      view.dataset.fade = overflow <= 1 ? 'none' : travelling ? 'both' : value >= -1 ? 'end' : value <= -overflow + 1 ? 'start' : 'both';
    };
    const freeze = () => {
      if (timer === undefined) return;
      if (moving) {
        const progress = Math.min(1, Math.max(0, (performance.now() - started) / duration));
        line.style.transition = 'none';
        paint(from + (target - from) * progress);
      } else waitRemaining = Math.max(0, waitUntil - performance.now());
      clear();
    };
    const resume = () => {
      if (disposed || paused() || overflow <= 1 || timer !== undefined) return;
      if (moving) {
        from = offset;
        target = towardsEnd ? -overflow : 0;
        duration = Math.abs(target - from) / 24 * 1000;
        started = performance.now();
        // Commit the frozen position before starting the next compositor transition.
        line.getBoundingClientRect();
        line.style.transition = `transform ${duration}ms linear`;
        paint(target, true);
        timer = setTimeout(() => {
          timer = undefined;
          paint(target);
          moving = false;
          towardsEnd = !towardsEnd;
          waitRemaining = 2000;
          resume();
        }, duration);
      } else {
        waitUntil = performance.now() + waitRemaining;
        timer = setTimeout(() => { timer = undefined; moving = true; resume(); }, waitRemaining);
      }
    };
    const revealFocused = () => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !line.contains(active)) return;
      // Browsers may have scrolled the clipping span before focusin fires.
      view.scrollLeft = 0;
      line.scrollLeft = 0;
      const area = view.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      const scale = area.width / view.clientWidth || 1;
      let next = offset;
      if (item.left < area.left + 4 * scale) next += (area.left + 4 * scale - item.left) / scale;
      else if (item.right > area.right - 4 * scale) next -= (item.right - area.right + 4 * scale) / scale;
      line.style.transition = 'none';
      paint(Math.max(-overflow, Math.min(0, next)));
      // Avoid native focus scrolling stacking with the transform offset.
    };
    const measure = (force = false) => {
      if (disposed) return;
      // The reduced-motion ellipsis must not change the width used to detect overflow.
      const width = view.clientWidth;
      const naturalWidth = line.scrollWidth;
      if (!force && width === lastWidth && naturalWidth === lastContentWidth) return;
      lastWidth = width; lastContentWidth = naturalWidth;
      clear(); moving = false; towardsEnd = true; waitRemaining = 2000;
      overflow = Math.max(0, naturalWidth - width);
      view.dataset.overflow = String(overflow > 1);
      view.dataset.reduced = String(reduced());
      view.scrollLeft = 0; line.scrollLeft = 0;
      line.style.transition = 'none'; paint(0);
      if (focused) revealFocused();
      resume();
    };
    const enter = () => { hovering = true; freeze(); };
    const leave = () => { hovering = false; resume(); };
    const focusIn = () => { focused = true; freeze(); revealFocused(); };
    const focusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && view.contains(event.relatedTarget)) return;
      focused = false; measure(true);
    };
    const visibility = () => { if (document.hidden) freeze(); else resume(); };
    const resize = () => measure();
    const motionChange = () => measure(true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(view); observer?.observe(line);
    view.addEventListener('pointerenter', enter);
    view.addEventListener('pointerleave', leave);
    view.addEventListener('focusin', focusIn);
    view.addEventListener('focusout', focusOut);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('resize', resize);
    media?.addEventListener?.('change', motionChange);
    void document.fonts?.ready.then(() => measure());
    measure();
    return () => {
      disposed = true; clear(); observer?.disconnect();
      view.removeEventListener('pointerenter', enter);
      view.removeEventListener('pointerleave', leave);
      view.removeEventListener('focusin', focusIn);
      view.removeEventListener('focusout', focusOut);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('resize', resize);
      media?.removeEventListener?.('change', motionChange);
    };
  }, [text, reducedMotion]);
  return <span class="scroll-text" ref={viewport} title={text}><span class="scroll-text-content" ref={content}>{children ?? text}</span></span>;
}
