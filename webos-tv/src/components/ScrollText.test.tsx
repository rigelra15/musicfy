// @vitest-environment jsdom
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ScrollText } from './ScrollText';

let host: HTMLDivElement;
let width = 150;
let textWidth = 246;
let resized: () => void;
let disconnected: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  width = 150; textWidth = 246;
  host = document.createElement('div'); document.body.append(host);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => textWidth);
  disconnected = vi.fn();
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resized = callback; } observe() {} disconnect = disconnected; });
});
afterEach(() => { render(null, host); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const mount = (text = 'A long title', reducedMotion = false) => act(() => render(h(ScrollText, { text, reducedMotion }), host));
const content = () => host.querySelector<HTMLElement>('.scroll-text-content')!;
const root = () => host.querySelector<HTMLElement>('.scroll-text')!;

it('waits two seconds, travels at 24px/s, waits at the far edge, and returns', () => {
  mount();
  expect(root().dataset.fade).toBe('end');
  expect(content().style.transform).toBe('translate3d(0px,0,0)');
  act(() => { vi.advanceTimersByTime(1999); });
  expect(content().style.transform).toBe('translate3d(0px,0,0)');
  act(() => { vi.advanceTimersByTime(1); });
  expect(content().style.transform).toBe('translate3d(-96px,0,0)');
  expect(content().style.transition).toBe('transform 4000ms linear');
  expect(root().dataset.fade).toBe('both');
  act(() => { vi.advanceTimersByTime(4000); });
  expect(root().dataset.fade).toBe('start');
  act(() => { vi.advanceTimersByTime(1999); });
  expect(content().style.transform).toBe('translate3d(-96px,0,0)');
  act(() => { vi.advanceTimersByTime(1); });
  expect(content().style.transform).toBe('translate3d(0px,0,0)');
});

it('leaves fitting text static and restarts after resize or a new song', () => {
  textWidth = 100; mount();
  expect(vi.getTimerCount()).toBe(0);
  width = 80; act(() => resized());
  expect(root().dataset.overflow).toBe('true');
  act(() => { vi.advanceTimersByTime(2000); });
  expect(content().style.transform).toBe('translate3d(-20px,0,0)');
  mount('Another title');
  expect(content().textContent).toBe('Another title');
  expect(content().style.transform).toBe('translate3d(0px,0,0)');
});

it('freezes mid-travel on hover and continues from that position', () => {
  mount(); act(() => { vi.advanceTimersByTime(4000); });
  act(() => { root().dispatchEvent(new Event('pointerenter')); });
  expect(content().style.transform).toBe('translate3d(-48px,0,0)');
  expect(vi.getTimerCount()).toBe(0);
  act(() => { root().dispatchEvent(new Event('pointerleave')); });
  expect(content().style.transition).toBe('transform 2000ms linear');
});

it('uses a static full-name tooltip for reduced motion and clears observers/timers on unmount', () => {
  mount('Full accessible title', true);
  expect(root().title).toBe('Full accessible title');
  expect(root().dataset.reduced).toBe('true');
  expect(vi.getTimerCount()).toBe(0);
  mount('Full accessible title');
  expect(vi.getTimerCount()).toBe(1);
  act(() => render(null, host));
  expect(vi.getTimerCount()).toBe(0);
  expect(disconnected).toHaveBeenCalled();
});

it('reveals and preserves clickable artists on focus, even after native focus scrolling', () => {
  act(() => render(h(ScrollText, { text: 'First artist, Second artist', children: h('button', { onClick: () => undefined }, 'Second artist') }), host));
  const view = root();
  const button = host.querySelector('button')!;
  view.scrollLeft = 60;
  vi.spyOn(view, 'getBoundingClientRect').mockReturnValue({left:0, right:150} as DOMRect);
  vi.spyOn(button, 'getBoundingClientRect').mockImplementation(() => ({left:200-view.scrollLeft, right:240-view.scrollLeft}) as DOMRect);
  act(() => button.focus());
  expect(view.scrollLeft).toBe(0);
  expect(content().style.transform).toBe('translate3d(-94px,0,0)');
  act(() => { vi.advanceTimersByTime(10000); });
  expect(content().style.transform).toBe('translate3d(-94px,0,0)');
  expect(vi.getTimerCount()).toBe(0);
});

it('freezes while hidden and resumes when the page is shown', () => {
  mount(); act(() => { vi.advanceTimersByTime(4000); });
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(content().style.transform).toBe('translate3d(-48px,0,0)');
  expect(vi.getTimerCount()).toBe(0);
  hidden.mockReturnValue(false);
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(content().style.transition).toBe('transform 2000ms linear');
});

it('clears native scrolling of the inner ellipsis area when a reduced-motion artist loses focus', () => {
  act(() => render(h(ScrollText, { text: 'First artist, Second artist', reducedMotion: true, children: h('button', {}, 'Second artist') }), host));
  const button = host.querySelector('button')!;
  act(() => button.focus());
  content().scrollLeft = 60;
  act(() => button.blur());
  expect(content().scrollLeft).toBe(0);
  expect(content().style.transform).toBe('translate3d(0px,0,0)');
});

it('converts focused artist bounds back to logical coordinates in a scaled player', () => {
  act(() => render(h(ScrollText, { text:'First, Second', children:h('button', {}, 'Second') }), host));
  const button = host.querySelector('button')!;
  vi.spyOn(root(), 'getBoundingClientRect').mockReturnValue({ left:0, right:300, width:300 } as DOMRect);
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({left:400, right:480} as DOMRect);
  act(() => button.focus());
  expect(content().style.transform).toBe('translate3d(-94px,0,0)');
});
