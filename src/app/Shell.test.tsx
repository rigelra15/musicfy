// @vitest-environment jsdom
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb } from '../library/db';
import type { PlaybackSnapshot, Track } from '../model';
import type { PlayerPort } from './engine';
import { openServices, type Services } from './services';
import type { AppContextValue } from './AppContext';
import { fakeGateway } from '../features/home/testkit';
import App from './Shell';

class FakePlayer implements PlayerPort {
  loads: Array<{ track: Track; startAtMs?: number }> = [];
  plays = 0;
  pauses = 0;
  seeks: number[] = [];
  listener: (snapshot: PlaybackSnapshot) => void = () => undefined;
  private sequence = 0;
  subscribe(listener: (snapshot: PlaybackSnapshot) => void) { this.listener = listener; return () => undefined; }
  async load(track: Track, options?: { startAtMs?: number }) { this.loads.push({ track, startAtMs: options?.startAtMs }); this.sequence += 1; this.emit({ status: 'loading', positionMs: 0, durationMs: track.durationMs }); return this.sequence; }
  async play() { this.plays += 1; this.emit({ status: 'playing', positionMs: 0, durationMs: 180000 }); }
  pause() { this.pauses += 1; this.emit({ status: 'paused', positionMs: 5000, durationMs: 180000 }); }
  seekTo(ms: number) { this.seeks.push(ms); }
  dispose() { /* nothing */ }
  emit(snapshot: Omit<PlaybackSnapshot, 'loadId'>) { this.listener({ ...snapshot, loadId: this.sequence }); }
}

const song = (id: string): Track => ({ id, title: `Lagu ${id}`, artist: 'Senja', durationMs: 180000 });
let host: HTMLElement;
let player: FakePlayer;
let services: Services;
let api: () => AppContextValue;

beforeEach(async () => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.closest('[hidden]') ? [] : [{}]) as unknown as DOMRectList;
  });
  const opened = await openServices({ db: createMemoryDb(), storage: { getItem: () => null } });
  if (!opened.ok) throw opened.error;
  services = opened.services;
  await services.prefs.set('ui.language', 'id');
  await services.prefs.set('onboarding.done', true);
  player = new FakePlayer();
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(() => { render(h(App, { services, catalog: fakeGateway(), playerFactory: () => player, onReady: (getter) => { api = getter; } }), host); });
});
afterEach(() => { render(null, host); host.remove(); vi.restoreAllMocks(); });

const press = async (key: string, init: KeyboardEventInit & { keyCode?: number } = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  if (init.keyCode !== undefined) Object.defineProperty(event, 'keyCode', { value: init.keyCode });
  await act(() => { (document.activeElement ?? document.body).dispatchEvent(event); });
  return event;
};
const byFocus = (id: string) => document.querySelector<HTMLElement>(`[data-focus-id="${id}"]`);
const click = async (id: string) => { await act(() => { byFocus(id)!.click(); }); };
const active = () => (document.activeElement as HTMLElement | null)?.dataset.focusId;
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('shell', () => {
  it('shows four navigation tabs with the logo first and opens the player from the mini-player', () => {
    const labels = Array.from(document.querySelectorAll('.primary-nav .nav-link')).map((el) => el.textContent);
    expect(labels).toEqual(['Beranda', 'Cari', 'Koleksi', 'Pengaturan']);
    expect(document.querySelector('.primary-nav')!.firstElementChild!.classList.contains('nav-brand')).toBe(true);
    expect(active()).toBe('nav-home');
    expect(byFocus('nav-player')).toBeNull();
  });

  it('walks every enabled tab with the D-pad and renders each route', async () => {
    const reached: string[] = [];
    for (let step = 0; step < 6; step += 1) {
      reached.push(active()!);
      await press('ArrowRight');
    }
    expect(reached).toEqual(['nav-home', 'nav-search', 'nav-library', 'nav-settings', 'nav-settings', 'nav-settings']);
    // Player is disabled with no track, so the D-pad skips it.
    await click('nav-settings');
    expect(document.querySelector('.settings-view h1')!.textContent).toBe('Pengaturan');
    await click('nav-search');
    expect(document.querySelector('.search-view')).toBeTruthy();
  });

  it('Back at the Home root is left to the system; elsewhere it returns step by step', async () => {
    const atRoot = await press('Escape');
    expect(atRoot.defaultPrevented).toBe(false);
    await click('nav-library');
    expect(document.querySelector('.primary-nav .is-active')!.textContent).toBe('Koleksi');
    const back = await press('Escape');
    expect(back.defaultPrevented).toBe(true);
    expect(document.querySelector('.primary-nav .is-active')!.textContent).toBe('Beranda');
  });
});

describe('playback across pages', () => {
  const play = async (...tracks: Track[]) => { await act(() => { api().playTracks(tracks, 0, 'manual'); }); await flush(); };

  it('loads once, shows the mini-player on other pages, and page changes never reload the audio', async () => {
    await play(song('a'), song('b'));
    expect(player.loads).toHaveLength(1);
    expect(player.plays).toBe(1);
    expect(document.querySelector('.player-view')).toBeTruthy();         // choosing a song opens the player
    expect(document.querySelector('.mini-player')).toBeNull();
    for (const tab of ['nav-search', 'nav-library', 'nav-settings', 'nav-home']) await click(tab);
    await click('mini-open');
    expect(document.querySelector('.mini-player')).toBeNull();
    await click('player-stack-queue');
    expect(player.loads).toHaveLength(1);
    expect(player.plays).toBe(1);
  });

  it('opens the player only once the song really plays, never on an error, and not when a page was left meanwhile', async () => {
    const original = player.play.bind(player);
    player.play = async () => { /* the song does not start yet */ };
    await act(() => { api().playTracks([song('a')], 0, 'manual'); });
    await flush();
    expect(document.querySelector('.player-view')).toBeNull();           // loading is not playing
    await act(() => { player.emit({ status: 'playing', positionMs: 0, durationMs: 180000 }); });
    await flush();
    expect(document.querySelector('.player-view')).toBeTruthy();
    player.play = original;
  });

  it('a song that fails to start leaves the person where they were', async () => {
    player.play = async () => { player.emit({ status: 'error', positionMs: 0, durationMs: 180000, error: 'x' }); };
    await act(() => { api().playTracks([song('a')], 0, 'manual'); });
    await flush();
    expect(document.querySelector('.player-view')).toBeNull();
    expect(document.querySelector('.mini-player')).toBeTruthy();
  });

  it('plays the same song again by reloading (play token), without needing a new track id', async () => {
    await play(song('a'));
    await play(song('a'));
    expect(player.loads).toHaveLength(2);
  });

  it('mini-player controls pause, skip, and open the player page', async () => {
    await play(song('a'), song('b'));
    await click('nav-search');
    await click('mini-toggle');
    expect(player.pauses).toBe(1);
    await click('mini-next');
    await flush();
    expect(player.loads.map((entry) => entry.track.id)).toEqual(['a', 'b']);
    await click('mini-open');
    expect(document.querySelector('.player-view h2')!.textContent).toBe('Lagu b');
  });

  it('Down from page content reaches the mini-player and Up returns to the page', async () => {
    await play(song('a'));
    await click('nav-search');
    byFocus('search-query')!.focus();
    await press('ArrowDown');
    // The submit button is disabled while the query is empty, so Down goes to the next control
    // (the retry for mood/genres, which cannot load with this offline catalog), then the mini-player.
    expect(active()).toBe('genres-retry');
    await press('ArrowDown');
    expect(active()).toBe('mini-open');
    await press('ArrowUp');
    expect(active()).toBe('genres-retry');
    await press('ArrowUp');
    expect(active()).toBe('search-query');
  });

  it('maps remote media keys to the engine', async () => {
    await play(song('a'), song('b'));
    await press('x', { keyCode: 19 });
    expect(player.pauses).toBe(1);
    await press('MediaTrackNext');
    await flush();
    expect(player.loads.map((entry) => entry.track.id)).toEqual(['a', 'b']);
    await press('x', { keyCode: 417 });
    expect(player.seeks).toHaveLength(1);
  });
});

describe('queue panel and overlays', () => {
  const seed = async () => { await act(() => { api().playTracks([song('a'), song('b'), song('c')], 0, 'manual'); }); await click('mini-open'); await click('player-stack-queue'); };

  it('lists entries with the current one marked and plays a chosen entry', async () => {
    await seed();
    const rows = document.querySelectorAll('.queue-row');
    expect(rows).toHaveLength(3);
    expect(rows[0].getAttribute('aria-current')).toBe('true');
    await act(() => { (rows[2] as HTMLElement).click(); });
    await flush();
    expect(player.loads[player.loads.length - 1].track.id).toBe('c');
  });

  it('opens the row actions as an overlay that traps focus; Back closes it and restores the opener', async () => {
    await seed();
    const opener = document.querySelectorAll<HTMLElement>('.row-more')[1];
    opener.focus();
    const openerId = opener.dataset.focusId!;
    await click(openerId);
    expect(document.querySelector('.overlay-layer.is-top')).toBeTruthy();
    expect(active()!.startsWith('ov')).toBe(true);
    for (let i = 0; i < 6; i += 1) await press('ArrowDown');
    expect(active()!.startsWith('ov')).toBe(true);
    for (let i = 0; i < 6; i += 1) await press('ArrowUp');
    expect(active()!.startsWith('ov')).toBe(true);
    const back = await press('Escape');
    expect(back.defaultPrevented).toBe(true);
    expect(document.querySelector('.overlay-layer')).toBeNull();
    expect(active()).toBe(openerId);
  });

  it('removes and reorders through the actions overlay without touching the current song', async () => {
    await seed();
    const loadsBefore = player.loads.length;
    await click(document.querySelectorAll<HTMLElement>('.row-more')[1].dataset.focusId!);
    const remove = Array.from(document.querySelectorAll<HTMLElement>('.overlay-item')).find((el) => el.textContent === 'Hapus dari antrean')!;
    await act(() => { remove.click(); });
    expect(document.querySelectorAll('.queue-row')).toHaveLength(2);
    expect(player.loads.length).toBe(loadsBefore);
    await click(document.querySelectorAll<HTMLElement>('.row-more')[0].dataset.focusId!);
    const up = Array.from(document.querySelectorAll<HTMLElement>('.overlay-item')).find((el) => el.textContent === 'Naikkan')!;
    expect(up.hasAttribute('disabled')).toBe(true);
  });

  it('keeps the page behind an overlay inert', async () => {
    await seed();
    await click(document.querySelectorAll<HTMLElement>('.row-more')[0].dataset.focusId!);
    expect(document.querySelector('.tv-shell')!.hasAttribute('inert')).toBe(true);
    await press('Escape');
    expect(document.querySelector('.tv-shell')!.hasAttribute('inert')).toBe(false);
  });
});

describe('popups ease in and out', () => {
  const stubMotion = (reduced: boolean) => { window.matchMedia = ((query: string) => ({ matches: reduced && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia; };
  afterEach(() => { delete (window as { matchMedia?: unknown }).matchMedia; });

  it('a closed popup stays for its leave animation, marked as leaving and out of reach, then is gone', async () => {
    stubMotion(false);
    await act(() => { api().playTracks([song('a'), song('b')], 0, 'manual'); });
    await click('mini-open');
    await click('player-stack-queue');
    await click(document.querySelectorAll<HTMLElement>('.row-more')[0].dataset.focusId!);
    const layer = document.querySelector('.overlay-layer.is-top')!;
    expect(layer).toBeTruthy();
    await press('Escape');
    const leaving = document.querySelector('.overlay-layer.is-leaving');
    expect(leaving).toBe(layer);                                    // the same layer, still there, now leaving
    expect(leaving!.hasAttribute('inert')).toBe(true);
    expect(document.querySelector('.overlay-layer.is-top')).toBeNull();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 260)); });
    expect(document.querySelector('.overlay-layer')).toBeNull();
  });

  it('with reduced motion a closed popup is gone at once', async () => {
    stubMotion(true);
    await act(() => { api().playTracks([song('a'), song('b')], 0, 'manual'); });
    await click('mini-open');
    await click('player-stack-queue');
    await click(document.querySelectorAll<HTMLElement>('.row-more')[0].dataset.focusId!);
    await press('Escape');
    expect(document.querySelector('.overlay-layer')).toBeNull();
  });
});

describe('the navbar on the player screen', () => {
  const toPlayer = async () => { await act(() => { api().playTracks([song('a')], 0, 'manual'); }); await flush(); };
  const hidden = () => document.querySelector('.tv-shell')!.classList.contains('nav-hidden');
  afterEach(() => { vi.useRealTimers(); });

  it('slides away after a few idle seconds, and comes back with the next key press or pointer move', async () => {
    await toPlayer();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    // a fresh countdown starts from the last input
    await act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(hidden()).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(hidden()).toBe(true);
    expect(document.querySelector('.app-topbar')!.getAttribute('aria-hidden')).toBe('true');
    await act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true })); });
    expect(hidden()).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(4500); });
    expect(hidden()).toBe(true);
    await act(() => { document.body.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, clientY: 300, bubbles: true })); });
    expect(hidden()).toBe(false);
  });

  it('stays while a dialog is open or the person is in the navbar, and does not hide on other screens', async () => {
    await toPlayer();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(() => { api().openOverlay('diagnostics'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(hidden()).toBe(false);
    await act(() => { api().closeOverlay(); });
    await act(() => { api().goTab('home'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(hidden()).toBe(false);
  });
});
