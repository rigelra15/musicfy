// @vitest-environment jsdom
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_SCROLL_PX_PER_S, Carousel, DWELL_MS, pageTarget, settleTarget, type CarouselMetrics } from './Carousel';

const m = (extra: Partial<CarouselMetrics> = {}): CarouselMetrics => ({ scrollLeft: 0, clientWidth: 1000, scrollWidth: 2410, pitch: 200, pad: 10, gap: 20, ...extra });

describe('page and settle targets', () => {
  it('moves whole cards, lands on a card boundary, and never goes past either end', () => {
    expect(pageTarget(m(), 1)).toBe(1000);                        // 5 whole cards fit in 1000 - 2 * 10
    expect(pageTarget(m({ scrollLeft: 1000 }), 1)).toBe(1410);    // the last page ends flush with the end
    expect(pageTarget(m({ scrollLeft: 1410 }), 1)).toBe(1410);
    expect(pageTarget(m({ scrollLeft: 1410 }), -1)).toBe(400);    // from the end: back to a card boundary
    expect(pageTarget(m({ scrollLeft: 200 }), -1)).toBe(0);
    expect(pageTarget(m({ scrollLeft: 370 }), 1)).toBe(1400);     // stopped between cards: starts from the nearest one
  });
  it('settles a carousel that stopped between two cards on the nearest card, but leaves the end alone', () => {
    expect(settleTarget(m({ scrollLeft: 290 }))).toBe(200);
    expect(settleTarget(m({ scrollLeft: 330 }))).toBe(400);
    expect(settleTarget(m({ scrollLeft: 1410 }))).toBe(1410);
    expect(settleTarget(m({ pitch: 0, scrollLeft: 5 }))).toBe(5);
  });
});

describe('Carousel', () => {
  let host: HTMLElement;
  const track = () => host.querySelector<HTMLDivElement>('.carousel-track')!;
  const nav = (side: 'prev' | 'next') => host.querySelector<HTMLButtonElement>(`[data-carousel-nav="${side}"]`)!;
  let scrollTo: ReturnType<typeof vi.fn<(options: ScrollToOptions) => void>>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] });
    // jsdom does not lay anything out: twelve cards 200 apart, a 1000 wide track, a 2410 wide strip
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return this.classList?.contains('carousel-track') ? 1000 : 0; } });
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get() { return this.classList?.contains('carousel-track') ? 2410 : 0; } });
    Object.defineProperty(HTMLElement.prototype, 'offsetLeft', { configurable: true, get() { const i = Array.prototype.indexOf.call(this.parentElement?.children ?? [], this); return 10 + i * 200; } });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 180; } });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return 180; } });
    host = document.createElement('div');
    document.body.appendChild(host);
    scrollTo = vi.fn<(options: ScrollToOptions) => void>();
    const proto = HTMLElement.prototype as unknown as { scrollTo: unknown };
    proto.scrollTo = function (this: HTMLElement, options: ScrollToOptions) { scrollTo(options); };
    const view = h(Carousel, { label: 'Rak', children: Array.from({ length: 12 }, (_, i) => h('button', { key: i, class: 'card' }, h('span', { 'data-carousel-art': true }, `Kartu ${i}`))) });
    act(() => { render(view, host); });
    let left = 0;
    Object.defineProperty(track(), 'scrollLeft', { configurable: true, get: () => left, set: (value: number) => { left = value; } });
    vi.advanceTimersByTime(20);
  });
  afterEach(() => {
    render(null, host); host.remove();
    for (const key of ['clientWidth', 'scrollWidth', 'offsetLeft', 'offsetWidth', 'offsetHeight', 'scrollTo']) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
    vi.useRealTimers();
  });
  const tick = (ms: number) => { act(() => { vi.advanceTimersByTime(ms); }); };
  const scrollEvent = (left: number) => { act(() => { track().scrollLeft = left; track().dispatchEvent(new Event('scroll')); }); tick(20); };

  it('shows only the chevron that leads somewhere, and the pair is hidden from remote focus', () => {
    expect(nav('prev').classList.contains('is-shown')).toBe(false);
    expect(nav('next').classList.contains('is-shown')).toBe(true);
    expect(nav('prev').tabIndex).toBe(-1);
    scrollEvent(700);
    expect(nav('prev').classList.contains('is-shown')).toBe(true);
    scrollEvent(1410);
    expect(nav('next').classList.contains('is-shown')).toBe(false);
  });

  it('a click on a chevron moves one page of whole cards', () => {
    act(() => { nav('next').click(); });
    expect(scrollTo).toHaveBeenCalledWith({ left: 1000, behavior: 'smooth' });
    scrollEvent(1000);
    act(() => { nav('prev').click(); });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: 'smooth' });
  });

  it('resting the pointer on a chevron keeps scrolling after a short wait, and stops, settling on a card, when it leaves', () => {
    act(() => { nav('next').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); nav('next').dispatchEvent(new Event('mouseenter')); });
    tick(DWELL_MS - 50);
    expect(track().scrollLeft).toBe(0);                                      // not yet: a pass over the chevron is not a request
    tick(60);
    tick(500);
    const moved = track().scrollLeft;
    expect(moved).toBeGreaterThan(AUTO_SCROLL_PX_PER_S * 0.3);               // roughly the configured speed
    expect(track().style.scrollSnapType).toBe('none');                       // free scrolling while it runs, no snapping fight
    scrollTo.mockClear();
    act(() => { nav('next').dispatchEvent(new Event('mouseleave')); });
    expect(track().style.scrollSnapType).toBe('');
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect((scrollTo.mock.calls[0][0].left as number) % 200).toBe(0);
    tick(2000);
    expect(track().scrollLeft).toBe(moved);                                   // nothing keeps moving after it left
  });

  it('stops by itself at the end, and a click right after a long hover is not another page', () => {
    act(() => { nav('next').dispatchEvent(new Event('mouseenter')); });
    tick(DWELL_MS + 3000);
    expect(track().scrollLeft).toBeGreaterThanOrEqual(1409);
    expect(track().style.scrollSnapType).toBe('');
    scrollTo.mockClear();
    act(() => { nav('next').click(); });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('a pointer that leaves before the wait ends starts nothing', () => {
    act(() => { nav('next').dispatchEvent(new Event('mouseenter')); });
    tick(DWELL_MS - 100);
    act(() => { nav('next').dispatchEvent(new Event('mouseleave')); });
    tick(2000);
    expect(track().scrollLeft).toBe(0);
  });

  it('a pointer that lands on a chevron while it is still fading in arms the wait with its first move', () => {
    act(() => { nav('next').dispatchEvent(new Event('mousemove')); });
    tick(DWELL_MS + 400);
    expect(track().scrollLeft).toBeGreaterThan(0);
    act(() => { nav('next').dispatchEvent(new Event('mouseleave')); });
    tick(1000);
    const rest = track().scrollLeft;
    tick(1000);
    expect(track().scrollLeft).toBe(rest);
  });

  it('puts the chevrons at the middle of the cover', () => {
    expect(host.querySelector<HTMLElement>('.carousel')!.getAttribute('style')).toContain('--nav-top: 90px');
  });
});
