// @vitest-environment jsdom
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContextValue } from '../../app/AppContext';
import type { PlayerPort } from '../../app/engine';
import { openServices, type Services } from '../../app/services';
import App from '../../app/Shell';
import { createMemoryDb } from '../../library/db';
import type { PlaybackSnapshot, Track } from '../../model';
import { fakeGateway } from '../home/testkit';

class FakePlayer implements PlayerPort {
  listener: (snapshot: PlaybackSnapshot) => void = () => undefined;
  sequence = 0;
  subscribe(listener: (snapshot: PlaybackSnapshot) => void) { this.listener = listener; return () => undefined; }
  async load(track: Track) { this.sequence += 1; this.emit({ status: 'loading', positionMs: 0, durationMs: track.durationMs }); return this.sequence; }
  async play() { this.emit({ status: 'playing', positionMs: 65_000, durationMs: 200_000 }); }
  pause() { this.emit({ status: 'paused', positionMs: 65_000, durationMs: 200_000 }); }
  seekTo() { /* not needed */ }
  dispose() { /* nothing */ }
  emit(snapshot: Omit<PlaybackSnapshot, 'loadId'>) { this.listener({ ...snapshot, loadId: this.sequence }); }
}

const song = (id: string, extra: Partial<Track> = {}): Track => ({ id, title: `Lagu ${id}`, artist: 'Senja', durationMs: 200_000, artists: [{ id: 'UC1', name: 'Senja' }], albumId: 'MPREa', album: 'Album A', ...extra });
let host: HTMLElement;
let services: Services;
let api: () => AppContextValue;

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
const byFocus = (id: string) => document.querySelector<HTMLElement>(`[data-focus-id="${id}"]`);
const top = () => document.querySelector('.overlay-layer.is-top');
const overlayItem = (suffix: string) => top()?.querySelector<HTMLElement>(`[data-focus-id$="-${suffix}"]`) ?? null;
const clickOverlay = async (suffix: string) => { const element = overlayItem(suffix); if (!element) throw new Error(`no overlay item ${suffix}`); await act(() => { element.click(); }); await flush(); };
const toastText = () => document.querySelector('.toast')?.textContent ?? '';
const card = () => document.querySelector<HTMLElement>('.player-card')!;
const layout = () => document.querySelector<HTMLElement>('.player-layout')!;

async function mount(title = 'Lagu a') {
  host = document.createElement('div');
  document.body.appendChild(host);
  const player = new FakePlayer();
  await act(() => { render(h(App, { services, catalog: fakeGateway(), playerFactory: () => player, onReady: (getter) => { api = getter; } }), host); });
  await flush();
  await act(() => { api().playTracks([song('a', { title })], 0, 'manual'); });
  await flush();
  await act(() => { api().goTab('player'); });
  await flush();
}
const unmount = () => { render(null, host); host.remove(); };
const openStudio = async () => {
  await act(() => { document.querySelector<HTMLDetailsElement>('details.player-menu')!.open = true; });
  await act(() => { byFocus('player-menu-OTHER_MENU')!.click(); });
  await flush();
  await clickOverlay('edit');
};
const choose = async (row: string, option: string) => { await clickOverlay(row); await clickOverlay(option); };

beforeEach(async () => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) { return (this.closest('[hidden]') ? [] : [{}]) as unknown as DOMRectList; });
  const opened = await openServices({ db: createMemoryDb(), storage: { getItem: () => null } });
  if (!opened.ok) throw opened.error;
  services = opened.services;
  await services.prefs.set('ui.language', 'id');
  await services.prefs.set('onboarding.done', true);
});
afterEach(() => { unmount(); vi.restoreAllMocks(); });

describe('presets keep the TV layout', () => {
  it('every preset has the player on the left and the lyrics on the right, and the quick menu', async () => {
    await mount();
    await openStudio();
    for (const [option, cls] of [['FLAGSHIP', 'preset-flagship'], ['TURNTABLE', 'preset-turntable'], ['POSTER', 'preset-poster'], ['TIMELINE', 'preset-timeline'], ['LYRICS', 'preset-lyrics']] as const) {
      await choose('preset', option);
      expect(layout().classList.contains(cls)).toBe(true);
      const children = Array.from(layout().children);
      expect(children[0].classList.contains('player-card')).toBe(true);
      expect(children[1].classList.contains('lyrics-view')).toBe(true);
      expect(card().querySelector('.player-side')).toBeTruthy();
      expect(card().querySelector('.player-controls')).toBeTruthy();
      expect(document.querySelector('.lyrics-view')).toBeTruthy();
    }
  });

  it('Turntable draws the record player, the compact presets the plain square, and Flagship the chosen cover', async () => {
    await mount();
    await openStudio();
    await choose('cover', 'DISC_BIG_LABEL');
    expect(document.querySelector('.artwork')?.getAttribute('data-cover-style')).toBe('DISC_BIG_LABEL');
    await choose('preset', 'TURNTABLE');
    expect(document.querySelector('.artwork')?.getAttribute('data-cover-style')).toBe('TURNTABLE');
    for (const preset of ['POSTER', 'TIMELINE', 'LYRICS']) {
      await choose('preset', preset);
      expect(document.querySelector('.artwork')?.getAttribute('data-cover-style')).toBe('SQUARED');
    }
    await choose('preset', 'FLAGSHIP');
    expect(document.querySelector('.artwork')?.getAttribute('data-cover-style')).toBe('DISC_BIG_LABEL');
  });

  it('the cover list has the seven flagship covers (the record player is its own preset)', async () => {
    await mount();
    await openStudio();
    await clickOverlay('cover');
    expect(top()?.querySelectorAll('.overlay-item')).toHaveLength(7);
    expect(overlayItem('TURNTABLE')).toBeNull();
  });
});

describe('studio controls', () => {
  it('disc options appear only for a disc cover, and the custom label is drawn on the disc', async () => {
    await mount();
    await openStudio();
    expect(overlayItem('rotate')).toBeNull();
    await choose('cover', 'DISC_BIG_LABEL');
    expect(overlayItem('rotate')).toBeTruthy();
    expect(overlayItem('realistic')).toBeTruthy();
    expect(overlayItem('label')).toBeTruthy();
    const input = byFocus(top()!.querySelector<HTMLElement>('input[type="text"]')!.dataset.focusId!) as HTMLInputElement;
    await act(() => { input.value = 'Mix Senja'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await flush();
    expect(document.querySelector('.artwork-lettering')?.textContent?.replace(/\s/g, '')).toContain('MIXSENJA');
    await choose('label', 'NONE');
    expect(top()?.querySelector('input[type="text"]')).toBeNull();
  });

  it('button styles: only Material 3 Expressive shows labels under the glyphs', async () => {
    await mount();
    await openStudio();
    expect(card().querySelectorAll('.button-label')).toHaveLength(0);
    await choose('buttons', 'M3_EXPRESSIVE');
    expect(card().classList.contains('buttons-m3-expressive')).toBe(true);
    expect(Array.from(card().querySelectorAll('.button-label')).map((el) => el.textContent)).toEqual(['Sebelumnya', 'Jeda', 'Berikutnya']);
    await choose('buttons', 'M3_EXPRESSIVE_PLAIN');
    expect(card().classList.contains('buttons-m3-expressive-plain')).toBe(true);
    expect(card().querySelectorAll('.button-label')).toHaveLength(0);
    for (const style of ['M3_TONAL', 'LEGACY']) { await choose('buttons', style); expect(card().classList.contains(`buttons-${style.toLowerCase().replace('_', '-')}`)).toBe(true); }
  });

  it('seek bar styles change the bar without touching what it does', async () => {
    await mount();
    await openStudio();
    for (const [id, cls] of [['M3_EXPRESSIVE', 'seek-m3-expressive'], ['M3_EXPRESSIVE_LINE', 'seek-m3-expressive-line'], ['PLAIN', 'seek-plain'], ['DEFAULT', 'seek-default']]) {
      await choose('seekbar', id);
      expect(document.querySelector('.seek')?.classList.contains(cls)).toBe(true);
      expect(byFocus('player-seek')?.getAttribute('type')).toBe('range');
    }
  });

  it('shows the end as total duration or as time left', async () => {
    await mount();
    expect(card().querySelector('.progress-times')?.textContent).toContain('3:20');
    await openStudio();
    await clickOverlay('endtime');
    const times = card().querySelector('.progress-times')?.textContent ?? '';
    expect(times).toContain('1:05');
    expect(times).toContain('-2:15');
    await clickOverlay('endtime');
    expect(card().querySelector('.progress-times')?.textContent).not.toContain('-');
  });

  it('the player has no volume control; Lyrics and Queue work inside the bottom deck card', async () => {
    await mount();
    expect(byFocus('player-volume')).toBeNull();
    expect(card().querySelector('input[type="range"][aria-label="Volume"]')).toBeNull();
    expect(document.querySelectorAll('.player-deck .deck-card .stack-card')).toHaveLength(2);
    await openStudio();
    expect(overlayItem('bar')).toBeNull();                                   // no longer a choice
    await act(() => { top()!.querySelector<HTMLElement>('[data-focus-id$="-done"]')!.click(); });
    await flush();
    await act(() => { byFocus('player-stack-queue')!.click(); });
    expect(api().store.nav.tab).toBe('player');                              // the queue replaces the lyrics in the same page
    expect(document.querySelector('.queue-panel')).not.toBeNull();
    expect(byFocus('player-stack-queue')!.getAttribute('aria-pressed')).toBe('true');
    await act(() => { byFocus('player-stack-lyrics')!.click(); });
    expect(document.querySelector('.queue-panel')).toBeNull();
  });

  it('the controls can be moved with the remote and come back with Reset', async () => {
    await mount();
    await openStudio();
    const slider = overlayItem('shift') as HTMLInputElement;
    await act(() => { slider.value = '-3'; slider.dispatchEvent(new Event('input', { bubbles: true })); });
    await flush();
    expect(card().getAttribute('style')).toMatch(/--controls-shift:\s*-24px/);
    await clickOverlay('reset');
    expect(card().getAttribute('style')).toMatch(/--controls-shift:\s*0px/);
    expect(toastText()).toContain('dikembalikan');
  });

  it('reduced motion stops the disc and marks the page', async () => {
    await mount();
    await openStudio();
    await choose('cover', 'DISC_SMALL_FULL');
    await clickOverlay('motion');
    expect(document.querySelector('.player-view')?.classList.contains('is-reduced-motion')).toBe(true);
    expect(document.querySelector('.artwork')?.getAttribute('data-spinning')).toBe('false');
  });

  it('what the TV cannot prove is listed with its reason and changes nothing', async () => {
    await mount();
    await openStudio();
    await choose('preset', 'POSTER');
    for (const row of ['visualizer', 'canvas', 'video', 'match']) {
      expect(overlayItem(row)).toBeTruthy();
      await clickOverlay(row);
      expect(toastText().length).toBeGreaterThan(10);
    }
    expect(services.prefs.get<{ posterVisualizer?: boolean }>('player.appearance', {})?.posterVisualizer).not.toBe(true);
  });

  it('Edit quick menu opens from the studio', async () => {
    await mount();
    await openStudio();
    await clickOverlay('slots');
    expect(top()?.querySelector('h2')?.textContent).toBe('Atur menu');
  });
});

describe('saved settings', () => {
  it('survive a relaunch, and Reset restores every default', async () => {
    await mount();
    await openStudio();
    await choose('preset', 'TIMELINE');
    await choose('buttons', 'M3_TONAL');
    await vi.waitFor(() => expect(services.prefs.get<{ preset: string }>('player.appearance', { preset: '' }).preset).toBe('TIMELINE'));
    unmount();
    await mount();
    expect(layout().classList.contains('preset-timeline')).toBe(true);
    expect(card().classList.contains('buttons-m3-tonal')).toBe(true);
    await openStudio();
    await clickOverlay('reset');
    expect(layout().classList.contains('preset-flagship')).toBe(true);
    expect(card().classList.contains('buttons-default')).toBe(true);
  });

  it('settings saved before the studio existed still apply; the old record-player cover becomes the Turntable preset', async () => {
    await services.prefs.set('player.appearance', { coverStyle: 'TURNTABLE', rotation: false, realistic: true, labelChoice: 'MUSIC_NAME', customLabel: '' });
    await mount();
    expect(layout().classList.contains('preset-turntable')).toBe(true);
    expect(document.querySelector('.artwork')?.getAttribute('data-cover-style')).toBe('TURNTABLE');
    expect(document.querySelector('.artwork')?.getAttribute('data-spinning')).toBe('false');
  });

  it('a very long title and label stay inside the card (wrapping, not widening it)', async () => {
    const long = 'Lagu dengan judul yang sangat sangat panjang '.repeat(6);
    await mount(long);
    expect(document.querySelector('#player-heading')?.textContent).toBe(long);
    expect(getComputedStyle(document.querySelector('#player-heading')!).overflowWrap).not.toBe('normal');
  });
});
