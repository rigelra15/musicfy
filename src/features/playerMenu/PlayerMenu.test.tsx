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
  loads: Track[] = [];
  plays = 0;
  rates: number[] = [];
  listener: (snapshot: PlaybackSnapshot) => void = () => undefined;
  sequence = 0;
  subscribe(listener: (snapshot: PlaybackSnapshot) => void) { this.listener = listener; return () => undefined; }
  async load(track: Track) { this.loads.push(track); this.sequence += 1; this.emit({ status: 'loading', positionMs: 0, durationMs: track.durationMs }); return this.sequence; }
  async play() { this.plays += 1; this.emit({ status: 'playing', positionMs: 0, durationMs: 180000 }); }
  pause() { this.emit({ status: 'paused', positionMs: 5000, durationMs: 180000 }); }
  seekTo() { /* not needed */ }
  setPlaybackRate(rate: number) { this.rates.push(rate); }
  dispose() { /* nothing */ }
  emit(snapshot: Omit<PlaybackSnapshot, 'loadId'>) { this.listener({ ...snapshot, loadId: this.sequence }); }
}

const song = (id: string, extra: Partial<Track> = {}): Track => ({ id, title: `Lagu ${id}`, artist: 'Senja', durationMs: 180000, artists: [{ id: 'UCsenja', name: 'Senja' }], albumId: 'MPREa', album: 'Album A', ...extra });
let host: HTMLElement;
let player: FakePlayer;
let services: Services;
let api: () => AppContextValue;

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
const byFocus = (id: string) => document.querySelector<HTMLElement>(`[data-focus-id="${id}"]`);
const click = async (id: string) => { const element = byFocus(id); if (!element) throw new Error(`no ${id}`); await act(() => { element.click(); }); await flush(); };
const active = () => (document.activeElement as HTMLElement | null)?.dataset.focusId;
const overlayItem = (suffix: string) => document.querySelector<HTMLElement>(`.overlay-layer.is-top [data-focus-id$="-${suffix}"]`);
const clickOverlay = async (suffix: string) => { const element = overlayItem(suffix); if (!element) throw new Error(`no overlay item ${suffix}`); await act(() => { element.click(); }); await flush(); };
const press = async (key: string) => { await act(() => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); }); };
const toastText = () => document.querySelector('.toast')?.textContent ?? '';
const setRange = async (element: HTMLInputElement, value: number) => { await act(() => { element.value = String(value); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); }); await flush(); };

async function mount(tracks: Track[] = [song('a'), song('b')]) {
  player = new FakePlayer();
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(() => { render(h(App, { services, catalog: fakeGateway(), playerFactory: () => player, onReady: (getter) => { api = getter; } }), host); });
  await flush();
  if (tracks.length > 0) {
    await act(() => { api().playTracks(tracks, 0, 'manual'); });
    await flush();
    await act(() => { api().goTab('player'); });
    await flush();
  }
}
const unmount = () => { render(null, host); host.remove(); };

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

describe('quick menu on the player', () => {
  it('starts with Android\'s layout: Like beside the dots, then Other menu, Sleep timer, See video, Repeat', async () => {
    await mount();
    expect(document.querySelector('.player-side')?.getAttribute('aria-label')).toBe('Suka');
    const labels = Array.from(document.querySelectorAll('.pm-quick-button')).map((el) => el.textContent);
    expect(labels).toEqual(['Menu lainnya', 'Timer tidur', 'Lihat video', 'Ulangi']);
  });

  it('Like on the side button saves and removes the like for real', async () => {
    await mount();
    await click('player-menu-LIKE');
    await vi.waitFor(() => expect(document.querySelector('.player-side')?.getAttribute('aria-pressed')).toBe('true'));
    expect(toastText()).toContain('Disukai');
    await click('player-menu-LIKE');
    await vi.waitFor(() => expect(document.querySelector('.player-side')?.getAttribute('aria-pressed')).toBe('false'));
  });

  it('Repeat cycles off, all, one and back without restarting the song', async () => {
    await mount([song('a'), song('b'), song('c')]);
    const repeat = () => api().store.root.queue.repeat;
    const quick = async (id: string) => { await act(() => { document.querySelector<HTMLDetailsElement>('details.player-menu')!.open = true; }); await click(id); };
    await quick('player-menu-REPEAT'); expect(repeat()).toBe('all');
    await quick('player-menu-REPEAT'); expect(repeat()).toBe('one');
    await quick('player-menu-REPEAT'); expect(repeat()).toBe('off');
    expect(player.loads).toHaveLength(1);       // repeating does not restart the song
  });

  it('a button that cannot work here keeps its place and says why when used', async () => {
    await mount();
    const seeVideo = byFocus('player-menu-SEE_VIDEO')!;
    expect(seeVideo.getAttribute('aria-disabled')).toBe('true');
    await click('player-menu-SEE_VIDEO');
    expect(toastText()).toContain('Video bersamaan');
    expect(services.prefs.get('player.seeVideo', false)).toBe(false);
  });
});

describe('the other quick actions, when placed in the menu', () => {
  const quick = async (id: string) => { await act(() => { document.querySelector<HTMLDetailsElement>('details.player-menu')!.open = true; }); await click(id); };

  it('Shuffle toggles and restores the order, Queue opens the queue, Add to playlist opens the picker', async () => {
    await services.prefs.set('player.menuSlots', 'SHUFFLE,QUEUE,LYRICS,ADD_TO_PLAYLIST');
    await mount([song('a'), song('b'), song('c')]);
    await quick('player-menu-SHUFFLE');
    expect(api().store.root.queue.shuffle).toBe(true);
    expect(byFocus('player-menu-SHUFFLE')?.getAttribute('aria-pressed')).toBe('true');
    await quick('player-menu-SHUFFLE');
    expect(api().store.root.queue.shuffle).toBe(false);
    expect(player.loads).toHaveLength(1);
    await quick('player-menu-ADD_TO_PLAYLIST');
    expect(document.querySelector('.overlay-layer.is-top')).toBeTruthy();
    await press('Escape');
    await quick('player-menu-QUEUE');
    expect(api().store.nav.tab).toBe('player');
    expect(api().playerPanel.getSnapshot()).toBe('queue');
    expect(document.querySelector('.queue-panel')).not.toBeNull();
  });

  it('Lyrics tells where the lyrics are when there is nothing to focus; Translate waits for lyrics and Download says it is not available yet', async () => {
    await services.prefs.set('player.menuSlots', 'LYRICS,TRANSLATE_LYRICS,DOWNLOAD,KEEP_AWAKE');
    await mount();
    await quick('player-menu-LYRICS');
    expect(toastText()).toContain('sisi kanan');
    await quick('player-menu-TRANSLATE_LYRICS');
    expect(toastText()).toContain('Terjemahan menunggu lirik');
    await quick('player-menu-DOWNLOAD');
    expect(toastText()).toContain('Unduhan belum tersedia');
    await quick('player-menu-KEEP_AWAKE');
    expect(services.prefs.get('player.keepAwake', false)).toBe(false);
  });
});

describe('edit menu', () => {
  const openEditor = async () => { await click('player-edit-menu'); };

  it('placing an action that is already used swaps places, and the choice survives a relaunch', async () => {
    await mount();
    await openEditor();
    await clickOverlay('slot-0');                        // Button 1 currently Other menu
    expect(overlayItem('pick-REPEAT')?.textContent).toContain('Dipakai di Tombol 4');
    await clickOverlay('pick-REPEAT');
    await vi.waitFor(() => expect(services.prefs.get('player.menuSlots', '')).toBe('REPEAT,SLEEP_TIMER,SEE_VIDEO,OTHER_MENU'));
    await clickOverlay('slot-4');                        // side button
    await clickOverlay('pick-SLEEP_TIMER');
    await vi.waitFor(() => expect(services.prefs.get('player.sideButton', '')).toBe('SLEEP_TIMER'));
    expect(services.prefs.get('player.menuSlots', '')).toBe('REPEAT,LIKE,SEE_VIDEO,OTHER_MENU');
    unmount();
    await mount();
    expect(Array.from(document.querySelectorAll('.pm-quick-button')).map((el) => el.textContent)).toEqual(['Ulangi', 'Suka', 'Lihat video', 'Menu lainnya']);
    expect(document.querySelector('.player-side')?.getAttribute('aria-label')).toBe('Timer tidur');
  });

  it('Reset brings the Android defaults back', async () => {
    await services.prefs.set('player.menuSlots', 'SHUFFLE,QUEUE,SPEED,OUTPUT');
    await services.prefs.set('player.sideButton', 'REPEAT');
    await mount();
    await openEditor();
    await clickOverlay('reset');
    await vi.waitFor(() => expect(services.prefs.get('player.menuSlots', '')).toBe('OTHER_MENU,SLEEP_TIMER,SEE_VIDEO,REPEAT'));
    expect(services.prefs.get('player.sideButton', '')).toBe('LIKE');
  });

  it('Back closes the picker layer by layer and returns focus to the button that opened it', async () => {
    await mount();
    await act(() => { document.querySelector<HTMLDetailsElement>('details.player-menu')!.open = true; });
    byFocus('player-edit-menu')!.focus();
    await click('player-edit-menu');
    await press('Escape');
    expect(document.querySelector('.overlay-layer')).toBeNull();
    expect(active()).toBe('player-more');
  });
});

describe('sleep timer', () => {
  const openSleep = async () => { await act(() => { document.querySelector<HTMLDetailsElement>('details.player-menu')!.open = true; }); await click('player-menu-SLEEP_TIMER'); };

  it('sets a timer from hours and minutes, shows what is left on the button, and cancel removes it', async () => {
    await mount();
    await openSleep();
    await setRange(overlayItem('minutes') as HTMLInputElement, 45);
    await clickOverlay('set');
    expect(document.querySelector('.overlay-layer')).toBeNull();
    expect(api().sleep.getSnapshot().deadlineAt).toBeGreaterThan(Date.now() + 44 * 60_000);
    expect(services.prefs.get('sleep.deadlineAt', 0)).toBe(api().sleep.getSnapshot().deadlineAt);
    expect(byFocus('player-menu-SLEEP_TIMER')?.getAttribute('aria-pressed')).toBe('true');
    await openSleep();
    expect(document.querySelector('.overlay-body')?.textContent).toMatch(/Sisa 4[45]:\d\d/);
    await clickOverlay('cancel');
    expect(api().sleep.isActive).toBe(false);
    await vi.waitFor(() => expect(services.prefs.get('sleep.deadlineAt', undefined)).toBeUndefined());
  });

  it('will not set an empty timer', async () => {
    await mount();
    await openSleep();
    await setRange(overlayItem('minutes') as HTMLInputElement, 0);
    expect(overlayItem('set')?.hasAttribute('disabled')).toBe(true);
  });

  it('"stop when this song ends" holds the next song paused instead of playing on', async () => {
    await mount();
    await openSleep();
    await clickOverlay('songend');
    expect(api().store.root.stopAfterTrack).toBe(true);
    expect(player.plays).toBe(1);
    await act(() => { player.emit({ status: 'playing', positionMs: 1000, durationMs: 180000 }); });
    await act(() => { player.emit({ status: 'ended', positionMs: 180000, durationMs: 180000 }); });
    await flush();
    expect(player.loads.map((track) => track.id)).toEqual(['a', 'b']);
    expect(player.plays).toBe(1);                       // the next song is ready, not playing
    expect(api().store.root.stopAfterTrack).toBe(false);
    expect(api().sleep.isActive).toBe(false);
  });

  it('a timer saved before a relaunch that has already passed does not pause or play anything', async () => {
    await services.prefs.set('sleep.deadlineAt', Date.now() - 1000);
    await mount();
    expect(api().sleep.isActive).toBe(false);
    expect(player.plays).toBe(1);                       // only the song the test started
    await vi.waitFor(() => expect(services.prefs.get('sleep.deadlineAt', undefined)).toBeUndefined());
  });
});

describe('speed and output', () => {
  const openFromOther = async (suffix: string) => {
    await act(() => { document.querySelector<HTMLDetailsElement>('details.player-menu')!.open = true; });
    await click('player-menu-OTHER_MENU');
    await clickOverlay(suffix);
  };

  it('changes the tempo of the engine, remembers it and offers a reset', async () => {
    await mount();
    await openFromOther('speed');
    await setRange(overlayItem('speed') as HTMLInputElement, 1.5);
    expect(player.rates[player.rates.length - 1]).toBe(1.5);
    expect(services.prefs.get('playback.speed', 1)).toBe(1.5);
    unmount();
    await mount();
    expect(player.rates[player.rates.length - 1]).toBe(1.5);          // applied again at launch
    await openFromOther('speed');
    await clickOverlay('reset');
    expect(player.rates[player.rates.length - 1]).toBe(1);
    expect(services.prefs.get('playback.speed', 0)).toBe(1);
  });

  it('pitch is shown but locked, with the reason', async () => {
    await mount();
    await openFromOther('speed');
    expect(overlayItem('pitch')?.hasAttribute('disabled')).toBe(true);
    expect(document.querySelector('.overlay-layer.is-top')?.textContent).toContain('pitch');
  });

  it('device output only claims what works: the app volume moves, the TV output and volume are explained as unsupported', async () => {
    await mount();
    await openFromOther('output');
    await setRange(overlayItem('volume') as HTMLInputElement, 0.4);
    expect(api().controls.volume).toBe(0.4);
    const text = document.querySelector('.overlay-layer.is-top')?.textContent ?? '';
    expect(text).toContain('volume sistem TV');
    expect(text).toContain('perangkat output');
  });
});

describe('other menu and song details', () => {
  const openOther = async () => { await act(() => { document.querySelector<HTMLDetailsElement>('details.player-menu')!.open = true; }); await click('player-menu-OTHER_MENU'); };

  it('lists what Android lists, leaves out Share (it does nothing there either), and explains the downloads it lacks', async () => {
    await mount();
    await openOther();
    const labels = Array.from(document.querySelectorAll('.overlay-layer.is-top .overlay-item')).map((el) => el.querySelector('span')?.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Tambah ke playlist', 'Unduh', 'Output perangkat', 'Timer tidur', 'Layar tetap menyala', 'Kecepatan dan tempo', 'Sukai', 'Simpan ke koleksi', 'Detail lagu', 'Ubah tampilan pemutar', 'Atur menu']));
    expect(labels.join(' ')).not.toMatch(/bagikan|share/i);
    await clickOverlay('download');
    expect(document.querySelector('.overlay-layer')).toBeNull();
  });

  it('Add to playlist opens the picker for this song; Save to library really saves', async () => {
    await mount();
    await openOther();
    await clickOverlay('playlist');
    expect(document.querySelector('.overlay-layer.is-top')).toBeTruthy();
    await press('Escape');
    await openOther();
    await clickOverlay('library');
    await vi.waitFor(async () => expect((await services.repo.getTracks(['youtube:track:a'])).size).toBeGreaterThan(0));
    expect(api().library.getSnapshot().libraryKeys.has('youtube:track:a')).toBe(true);
  });

  it('Song details offers each artist with an id, the album and About song, and opening one navigates', async () => {
    await mount([song('a', { artists: [{ id: 'UC1', name: 'Senja' }, { id: 'UC2', name: 'Fajar' }, { name: 'Tanpa id' }] })]);
    await openOther();
    await clickOverlay('details');
    const rows = Array.from(document.querySelectorAll('.overlay-layer.is-top .overlay-item')).map((el) => el.textContent);
    expect(rows).toEqual(['Lihat Senja', 'Lihat Fajar', 'Lihat Album A', 'Tentang lagu']);
    await clickOverlay('artist-UC2');
    expect(api().store.nav.stacks[api().store.nav.tab].some((entry) => entry.route.name === 'artist')).toBe(true);
  });

  it('About song says there is no description when the song came without one', async () => {
    await mount();
    await openOther();
    await clickOverlay('details');
    await clickOverlay('about');
    expect(document.querySelector('.pm-about')?.textContent).toBe('Tidak ada deskripsi untuk lagu ini.');
    await press('Escape');
    expect(document.querySelector('.overlay-layer.is-top h2')?.textContent).toBe('Detail lagu');
  });

  it('Edit player opens the studio beside the player', async () => {
    await mount();
    await openOther();
    await clickOverlay('edit');
    expect(document.querySelector('.overlay-layer.is-top')?.getAttribute('data-overlay-kind')).toBe('studio');
    expect(document.querySelector('.overlay-layer.is-top h2')?.textContent).toBe('Edit pemutar');
  });
});
