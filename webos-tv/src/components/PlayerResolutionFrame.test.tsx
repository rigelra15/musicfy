// @vitest-environment jsdom
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { PlayerResolutionFrame } from './PlayerResolutionFrame';

let host: HTMLDivElement | undefined;
afterEach(() => { if (host) { render(null, host); host.remove(); } vi.restoreAllMocks(); });
it('scales the same 1280×720 composition proportionally and reacts to viewport changes', () => {
  const w = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280);
  const hgt = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(720);
  host = document.createElement('div'); document.body.append(host);
  act(() => render(h(PlayerResolutionFrame, { active:true, children:h('p', {}, 'Player') }), host!));
  const frame = () => host!.firstElementChild as HTMLElement;
  expect(frame().style.getPropertyValue('--player-scale')).toBe('1');
  w.mockReturnValue(1920); hgt.mockReturnValue(1080);
  act(() => { window.dispatchEvent(new Event('resize')); });
  expect(frame().style.getPropertyValue('--player-scale')).toBe('1.5');
  w.mockReturnValue(2560); hgt.mockReturnValue(1080);
  act(() => { window.dispatchEvent(new Event('resize')); });
  expect(frame().style.getPropertyValue('--player-scale')).toBe('1.5');
  act(() => render(h(PlayerResolutionFrame, { active:false, children:h('p', {}, 'Other page') }), host!));
  expect(frame().classList.contains('is-player-resolution')).toBe(false);
  expect(frame().classList.contains('is-tv-resolution')).toBe(true);
  expect(frame().style.getPropertyValue('--player-scale')).toBe('1.5');
  w.mockReturnValue(1280); hgt.mockReturnValue(720);
  act(() => { window.dispatchEvent(new Event('resize')); });
  expect(frame().style.getPropertyValue('--player-scale')).toBe('1');
});

it('starts non-player pages in the same proportional canvas', () => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1920);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1080);
  host = document.createElement('div'); document.body.append(host);
  act(() => render(h(PlayerResolutionFrame, { active:false, children:h('p', {}, 'Search') }), host!));
  const frame = host.firstElementChild as HTMLElement;
  expect(frame.classList.contains('is-tv-resolution')).toBe(true);
  expect(frame.style.getPropertyValue('--player-scale')).toBe('1.5');
});
