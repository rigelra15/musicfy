// @vitest-environment jsdom
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContextValue } from '../app/AppContext';
import type { PlayerPort } from '../app/engine';
import { openServices, type Services } from '../app/services';
import App from '../app/Shell';
import type { Route } from '../app/router';
import { fakeGateway, NOW, track } from '../features/home/testkit';
import { createMemoryDb } from '../library/db';
import type { PlaybackSnapshot, Track } from '../model';
import { trackKeyOf } from '../domain/entity';
import { currentTrack } from '../playback/queueModel';

class FakePlayer implements PlayerPort {
  listener: (snapshot: PlaybackSnapshot) => void = () => undefined;
  subscribe(listener: (snapshot: PlaybackSnapshot) => void) { this.listener = listener; return () => undefined; }
  async load(next: Track) { this.listener({ status: 'loading', positionMs: 0, durationMs: next.durationMs, loadId: 1 }); return 1; }
  async play() { /* not needed */ }
  pause() { /* not needed */ }
  seekTo() { /* not needed */ }
  dispose() { /* nothing */ }
}

let host: HTMLElement;
let services: Services;
let api: () => AppContextValue;

async function mount(seed?: (s: Services) => Promise<void>) {
  const opened = await openServices({ db: createMemoryDb(), storage: { getItem: () => null } });
  if (!opened.ok) throw opened.error;
  services = opened.services;
  await services.prefs.set('ui.language', 'id');
  await services.prefs.set('onboarding.done', true);
  await seed?.(services);
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(() => { render(h(App, { services, catalog: fakeGateway(), now: () => NOW, playerFactory: () => new FakePlayer(), onReady: (getter) => { api = getter; } }), host); });
  await settle();
}
const settle = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const byFocus = (id: string) => document.querySelector<HTMLElement>(`[data-focus-id="${id}"]`);
const click = async (id: string) => { expect(byFocus(id), id).not.toBeNull(); await act(() => { byFocus(id)!.click(); }); await settle(); };
const go = async (next: Route) => { await act(() => { api().navigate(next); }); await settle(); };
const stage = () => document.querySelector('.app-stage')!;
const text = () => stage().textContent ?? '';
const overlay = () => document.querySelector('.overlay-root');
const overlayButton = (label: string) => [...(overlay()?.querySelectorAll<HTMLElement>('button') ?? [])].find((button) => button.textContent?.trim() === label);
const choose = async (label: string) => { const button = overlayButton(label) ?? [...(overlay()?.querySelectorAll<HTMLElement>('button') ?? [])].find((candidate) => candidate.querySelector('span')?.textContent === label); expect(button, label).toBeDefined(); await act(() => { button!.click(); }); await settle(); };
const typeInto = async (element: HTMLInputElement, value: string) => { await act(() => { element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); }); };
const toastText = () => document.querySelector('.toast')?.textContent ?? '';
const queue = () => api().store.root.queue;
const titles = (selector = '.result-title') => [...stage().querySelectorAll(selector)].map((node) => node.textContent);
const nameInput = () => overlay()!.querySelector<HTMLInputElement>('input[type=text]')!;
const submit = async () => { await act(() => { overlay()!.querySelector<HTMLFormElement>('form')!.requestSubmit(); }); await settle(); };
const holdOk = async (element: HTMLElement) => {
  await act(() => { element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
};

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.closest('[hidden]') ? [] : [{}]) as unknown as DOMRectList;
  });
});
afterEach(() => { render(null, host); host.remove(); vi.restoreAllMocks(); });

const banana = () => track('b1', { title: 'Banana', artist: 'Zed' });
const apple = () => track('a1', { title: 'Apple', artist: 'Yan' });
const cherry = () => track('c1', { title: 'Cherry', artist: 'Xi' });
async function seedSongs(s: Services) { for (const t of [banana(), apple(), cherry()]) await s.repo.addToLibrary(t); }

describe('Library landing', () => {
  it('is honest about an empty library and offers a way to find music — no fake import button', async () => {
    await mount();
    await go({ name: 'library' });
    expect(text()).toContain('Koleksi masih kosong');
    expect(byFocus('lib-empty-search')).not.toBeNull();
    expect(stage().querySelectorAll('.lib-card')).toHaveLength(0);
    await click('lib-empty-search');
    expect(api().store.nav.tab).toBe('search');
  });

  it('shows category cards with real counts, Recently added and Liked', async () => {
    await mount(async (s) => { await seedSongs(s); await s.repo.setLiked(banana(), true); await s.repo.createPlaylist('Santai'); });
    await go({ name: 'library' });
    expect(byFocus('lib-cat-songs')!.getAttribute('aria-label')).toContain('3 lagu');
    expect(byFocus('lib-cat-playlists')!.getAttribute('aria-label')).toContain('1 playlist');
    expect(byFocus('lib-cat-albums')!.getAttribute('aria-label')).toContain('0 album');
    expect(byFocus('lib-added')!.getAttribute('aria-label')).toContain('3 lagu');
    expect(byFocus('lib-liked')!.getAttribute('aria-label')).toContain('1 lagu');
  });

  it('Local and Cached tabs say plainly when nothing is stored, and the chosen tab survives leaving the page', async () => {
    await mount(async (s) => { await seedSongs(s); });
    await go({ name: 'library' });
    await click('lib-tab-local');
    expect(text()).toContain('Belum ada file musik lokal');
    await click('lib-tab-cached');
    expect(text()).toContain('Belum ada lagu yang disimpan untuk offline');
    await click('lib-tab-imported');
    expect(text()).toContain('Belum ada yang diimpor');
    await go({ name: 'library', section: 'songs' });
    await act(() => { api().goBack(); }); await settle();
    expect(byFocus('lib-tab-imported')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('searches the library across songs and playlists, and says so when nothing matches', async () => {
    await mount(async (s) => { await seedSongs(s); await s.repo.createPlaylist('Pagi Apel'); });
    await go({ name: 'library' });
    await typeInto(byFocus('lib-search') as HTMLInputElement, 'ap');
    await settle();
    expect(titles()).toContain('Apple');
    expect(text()).toContain('Pagi Apel');
    expect(titles()).not.toContain('Banana');
    await typeInto(byFocus('lib-search') as HTMLInputElement, 'zzzz');
    await settle();
    expect(text()).toContain('Tidak ada yang cocok');
  });
});

describe('Songs, Recently added, Liked', () => {
  it('lists songs A–Z under letter headers and plays the list from the chosen song', async () => {
    await mount(seedSongs);
    await go({ name: 'library', section: 'songs' });
    expect(titles('.letter-header')).toEqual(['A', 'B', 'C']);
    expect(titles('.track-line .result-title')).toEqual(['Apple', 'Banana', 'Cherry']);
    await click('lib-song-1');
    expect(currentTrack(queue())?.id).toBe('b1');
    expect(queue().entries).toHaveLength(3);
  });

  it('Acak shuffles the whole list; Putar semua starts at the first song', async () => {
    await mount(seedSongs);
    await go({ name: 'library', section: 'songs' });
    await click('detail-play');
    expect(currentTrack(queue())?.id).toBe('a1');
    expect(queue().shuffle).toBe(false);
    await click('detail-shuffle');
    expect(queue().shuffle).toBe(true);
    expect(queue().entries).toHaveLength(3);
  });

  it('jumps to a letter with the "Lompat ke huruf" menu', async () => {
    await mount(seedSongs);
    await go({ name: 'library', section: 'songs' });
    await click('detail-songs-jump');
    await choose('C · 1');
    expect(document.activeElement?.getAttribute('data-focus-id')).toBe('lib-song-2');
  });

  it('filters the song list as you type', async () => {
    await mount(seedSongs);
    await go({ name: 'library', section: 'songs' });
    await typeInto(byFocus('lib-search') as HTMLInputElement, 'cher');
    await settle();
    expect(titles('.track-line .result-title')).toEqual(['Cherry']);
  });

  it('Recently added is newest first and Liked shows only liked songs; unliking removes it from the list', async () => {
    let clock = 1_000;
    await mount(async (s) => {
      vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1_000));
      for (const t of [apple(), banana(), cherry()]) await s.repo.addToLibrary(t);
      await s.repo.setLiked(banana(), true);
    });
    await go({ name: 'library', section: 'added' });
    expect(titles('.track-line .result-title')).toEqual(['Cherry', 'Banana', 'Apple']);
    await go({ name: 'library', section: 'liked' });
    expect(titles('.track-line .result-title')).toEqual(['Banana']);
    await click('lib-song-0-menu');
    await choose('Batal suka');
    expect(toastText()).toBe('Batal suka');
    expect(stage().querySelectorAll('.track-line')).toHaveLength(0);
  });

  it('a song menu can remove a song from the library', async () => {
    await mount(seedSongs);
    await go({ name: 'library', section: 'songs' });
    await click('lib-song-0-menu');
    await choose('Hapus dari koleksi');
    expect(titles('.track-line .result-title')).toEqual(['Banana', 'Cherry']);
    expect(toastText()).toBe('Dihapus dari koleksi');
  });

  it('holding OK on a song opens the menu instead of playing; a short press plays', async () => {
    await mount(seedSongs);
    await go({ name: 'library', section: 'songs' });
    const row = byFocus('lib-song-0')!;
    await holdOk(row);
    expect(overlay()).not.toBeNull();
    await act(() => { row.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })); });
    expect(queue().entries).toHaveLength(0);
    await act(() => { api().closeOverlay(); });
    await act(() => { row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    await act(() => { row.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })); });
    expect(currentTrack(queue())?.id).toBe('a1');
  });

  it('a failed write is reported as a failure, not as success', async () => {
    await mount(seedSongs);
    vi.spyOn(services.repo, 'setLiked').mockRejectedValue(new Error('penyimpanan penuh'));
    await go({ name: 'library', section: 'songs' });
    await click('lib-song-0-menu');
    await choose('Sukai');
    expect(toastText()).toContain('Gagal');
    expect(toastText()).toContain('penyimpanan penuh');
    expect((await services.repo.listLiked()).length).toBe(0);
  });
});

describe('Playlists', () => {
  it('creates a playlist from the Playlist page, refuses an empty name, and lists it', async () => {
    await mount();
    await go({ name: 'library', section: 'playlists' });
    expect(text()).toContain('Belum ada playlist');
    await click('detail-create-playlist');
    await submit();
    expect(overlay()!.textContent).toContain('tidak boleh kosong');
    await typeInto(nameInput(), '  Santai  ');
    await submit();
    expect(overlay()).toBeNull();
    expect(toastText()).toBe('Playlist "Santai" dibuat');
    expect(titles('.result-title')).toEqual(['Santai']);
  });

  it('two playlists may share a name; they stay separate', async () => {
    await mount(async (s) => { await s.repo.createPlaylist('Mix'); await s.repo.createPlaylist('Mix'); });
    await go({ name: 'library', section: 'playlists' });
    expect(titles('.result-title')).toEqual(['Mix', 'Mix']);
    expect((await services.repo.listPlaylists()).length).toBe(2);
  });

  it('adds a song to a playlist from its menu; a repeat offers skip / add anyway / cancel', async () => {
    let id = '';
    await mount(async (s) => { await seedSongs(s); id = (await s.repo.createPlaylist('Santai')).id; });
    await go({ name: 'library', section: 'songs' });
    const addAgain = async () => { await click('lib-song-0-menu'); await choose('Tambah ke playlist'); await choose('Santai'); };
    await addAgain();
    expect(toastText()).toBe('Ditambahkan ke "Santai"');
    expect((await services.repo.getPlaylist(id))!.entries.map((e) => e.track?.id)).toEqual(['a1']);
    await addAgain();
    expect(overlay()!.textContent).toContain('sudah ada di playlist');
    await choose('Lewati duplikat');
    expect(toastText()).toBe('Semua lagu itu sudah ada di playlist.');
    expect((await services.repo.getPlaylist(id))!.entries).toHaveLength(1);
    await addAgain();
    await choose('Tambahkan tetap');
    expect((await services.repo.getPlaylist(id))!.entries).toHaveLength(2);
    await addAgain();
    await choose('Batal');
    expect((await services.repo.getPlaylist(id))!.entries).toHaveLength(2);
  });

  it('a failed add keeps the picker open with the reason, adds nothing and shows no success toast', async () => {
    let id = '';
    await mount(async (s) => { await seedSongs(s); id = (await s.repo.createPlaylist('Santai')).id; });
    vi.spyOn(services.repo, 'addToPlaylist').mockRejectedValue(new Error('disk penuh'));
    await go({ name: 'library', section: 'songs' });
    await click('lib-song-0-menu');
    await choose('Tambah ke playlist');
    await choose('Santai');
    expect(overlay()).not.toBeNull();
    expect(overlay()!.textContent).toContain('disk penuh');
    expect(toastText()).not.toContain('Ditambahkan');
    expect((await services.repo.getPlaylist(id))!.entries).toHaveLength(0);
  });

  it('can create a playlist right from "Tambah ke playlist" and puts the song in it', async () => {
    await mount(seedSongs);
    await go({ name: 'library', section: 'songs' });
    await click('lib-song-1-menu');
    await choose('Tambah ke playlist');
    await choose('Buat playlist');
    await typeInto(nameInput(), 'Baru');
    await submit();
    expect(toastText()).toBe('Playlist "Baru" dibuat dengan 1 lagu');
    const [created] = await services.repo.listPlaylists();
    expect((await services.repo.getPlaylist(created.id))!.entries.map((e) => e.track?.id)).toEqual(['b1']);
  });

  it('an empty local playlist says so and offers no Play', async () => {
    let id = '';
    await mount(async (s) => { id = (await s.repo.createPlaylist('Kosong')).id; });
    await go({ name: 'playlist', id, origin: 'local' });
    expect(text()).toContain('Playlist ini masih kosong');
    expect((byFocus('detail-play') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renames a playlist and the page updates', async () => {
    let id = '';
    await mount(async (s) => { id = (await s.repo.createPlaylist('Lama')).id; });
    await go({ name: 'playlist', id, origin: 'local' });
    await click('detail-manage');
    await choose('Ganti nama');
    expect(nameInput().value).toBe('Lama');
    await typeInto(nameInput(), 'Baru');
    await submit();
    expect(toastText()).toBe('Nama playlist diubah');
    expect(stage().querySelector('h1')!.textContent).toBe('Baru');
  });

  it('deletes a playlist only after confirmation, keeps its songs in the library, and goes back', async () => {
    let id = '';
    await mount(async (s) => { await seedSongs(s); id = (await s.repo.createPlaylist('Hapus')).id; await s.repo.addToPlaylist(id, [apple()]); });
    await go({ name: 'library', section: 'playlists' });
    await go({ name: 'playlist', id, origin: 'local' });
    await click('detail-manage');
    await choose('Hapus playlist');
    expect(overlay()!.textContent).toContain('Hapus playlist "Hapus"?');
    await choose('Batal');
    expect(await services.repo.getPlaylist(id)).toBeDefined();
    await click('detail-manage');
    await choose('Hapus playlist');
    await choose('Hapus playlist');
    await settle();
    expect(await services.repo.getPlaylist(id)).toBeUndefined();
    expect(toastText()).toBe('Playlist dihapus');
    expect((await services.repo.listLibrary()).length).toBe(3);
    expect(text()).toContain('Belum ada playlist');
  });

  it('removes and reorders songs inside a local playlist', async () => {
    let id = '';
    await mount(async (s) => { id = (await s.repo.createPlaylist('Urut')).id; await s.repo.addToPlaylist(id, [apple(), banana(), cherry()]); });
    await go({ name: 'playlist', id, origin: 'local' });
    const order = () => titles('.track-line .result-title');
    expect(order()).toEqual(['Apple', 'Banana', 'Cherry']);
    await click('detail-t-0-menu');
    expect(overlayButton('Naikkan')).toBeUndefined();
    await choose('Pindah ke akhir');
    expect(order()).toEqual(['Banana', 'Cherry', 'Apple']);
    await click('detail-t-1-menu');
    await choose('Naikkan');
    expect(order()).toEqual(['Cherry', 'Banana', 'Apple']);
    await click('detail-t-2-menu');
    expect(overlayButton('Turunkan')).toBeUndefined();
    await choose('Pindah ke awal');
    expect(order()).toEqual(['Apple', 'Cherry', 'Banana']);
    await click('detail-t-1-menu');
    await choose('Hapus dari playlist');
    expect(order()).toEqual(['Apple', 'Banana']);
    expect(toastText()).toBe('Dihapus dari playlist');
    expect((await services.repo.getPlaylist(id))!.entries.map((e) => e.position)).toEqual([0, 1]);
  });

  it('a song removed from a playlist stays in the library', async () => {
    let id = '';
    await mount(async (s) => { await s.repo.addToLibrary(apple()); id = (await s.repo.createPlaylist('Satu')).id; await s.repo.addToPlaylist(id, [apple()]); });
    await go({ name: 'playlist', id, origin: 'local' });
    await click('detail-t-0-menu');
    await choose('Hapus dari playlist');
    expect(text()).toContain('Playlist ini masih kosong');
    expect((await services.repo.listLibrary()).map((s) => s.track?.id)).toContain('a1');
  });
});

describe('Pinned', () => {
  it('pins a playlist, shows it on the landing page, opens it, and unpins with hold-OK', async () => {
    let id = '';
    await mount(async (s) => { await seedSongs(s); id = (await s.repo.createPlaylist('Santai')).id; });
    await go({ name: 'library', section: 'playlists' });
    await click('lib-pl-0-menu');
    await choose('Sematkan');
    expect(toastText()).toBe('Disematkan');
    await go({ name: 'library' });
    expect(stage().querySelectorAll('.lib-pinned')).toHaveLength(1);
    expect(byFocus('lib-pin-0')!.getAttribute('aria-label')).toContain('Santai');
    await click('lib-pin-0');
    expect(api().store.nav.stacks[api().store.nav.tab].slice(-1)[0].route).toMatchObject({ name: 'playlist', id, origin: 'local' });
    await act(() => { api().goBack(); }); await settle();
    await holdOk(byFocus('lib-pin-0')!);
    await choose('Lepas sematan');
    expect(toastText()).toBe('Sematan dilepas');
    expect(stage().querySelectorAll('.lib-pinned')).toHaveLength(0);
  });

  it('a pinned song plays when selected', async () => {
    await mount(seedSongs);
    await go({ name: 'library', section: 'songs' });
    await click('lib-song-1-menu');
    await choose('Sematkan');
    await go({ name: 'library' });
    await click('lib-pin-0');
    expect(currentTrack(queue())?.id).toBe('b1');
  });

  it('allows at most 9 pinned items and says so for the 10th', async () => {
    await mount(async (s) => { for (let i = 0; i < 10; i += 1) await s.repo.createPlaylist(`P${String(i).padStart(2, '0')}`); });
    await go({ name: 'library', section: 'playlists' });
    for (let i = 0; i < 9; i += 1) { await click(`lib-pl-${i}-menu`); await choose('Sematkan'); }
    expect((await services.repo.listPins()).length).toBe(9);
    await click('lib-pl-9-menu');
    await choose('Sematkan');
    expect(toastText()).toBe('Hanya 9 item yang bisa disematkan.');
    expect((await services.repo.listPins()).length).toBe(9);
  });
});

describe('Saved albums and artists', () => {
  it('lists saved albums alphabetically and saved artists', async () => {
    await mount(async (s) => {
      await s.repo.saveEntity({ ref: { provider: 'youtube', kind: 'album', id: 'MPREz' }, title: 'Zebra', subtitle: 'Album • 2024' });
      await s.repo.saveEntity({ ref: { provider: 'youtube', kind: 'album', id: 'MPREa' }, title: 'Angin', subtitle: 'Album • 2020' });
      await s.repo.saveEntity({ ref: { provider: 'youtube', kind: 'artist', id: 'UCx' }, title: 'Xena' });
    });
    await go({ name: 'library', section: 'albums' });
    expect(text().indexOf('Angin')).toBeGreaterThan(-1);
    expect(text().indexOf('Angin')).toBeLessThan(text().indexOf('Zebra'));
    await go({ name: 'library', section: 'artists' });
    expect(text()).toContain('Xena');
  });
});

describe('Local, Cached and Imported shelves', () => {
  it('Local shows only ready local files; Cached shows ready downloads and cache, not half-finished or failed ones', async () => {
    await mount(async (s) => {
      for (const t of [apple(), banana(), cherry(), track('d1', { title: 'Dermaga' })]) await s.repo.upsertTracks([t]);
      await s.repo.registerAsset({ assetId: 'l1', trackKey: trackKeyOf(apple()), kind: 'local', state: 'ready' });
      await s.repo.registerAsset({ assetId: 'c1', trackKey: trackKeyOf(banana()), kind: 'download', state: 'ready' });
      await s.repo.registerAsset({ assetId: 'c2', trackKey: trackKeyOf(cherry()), kind: 'cache', state: 'staging' });
      await s.repo.registerAsset({ assetId: 'c3', trackKey: trackKeyOf(track('d1')), kind: 'download', state: 'failed' });
    });
    await go({ name: 'library' });
    await click('lib-tab-local');
    expect(titles('.track-line .result-title')).toEqual(['Apple']);
    await click('lib-tab-cached');
    expect(titles('.track-line .result-title')).toEqual(['Banana']);
  });

  it('Imported groups songs and playlists by source, opens each filtered list, and keeps other sources out', async () => {
    await mount(async (s) => {
      await s.repo.addToLibrary(apple(), 'import:spotify');
      await s.repo.addToLibrary(banana(), 'import:spotify');
      await s.repo.addToLibrary(cherry(), 'manual');
      const imported = await s.repo.createPlaylist('Dari Spotify', { source: { provider: 'spotify', id: 'p1', title: 'spotify', importedAt: NOW } });
      await s.repo.addToPlaylist(imported.id, [apple()]);
      await s.repo.createPlaylist('Buatan sendiri');
    });
    await go({ name: 'library' });
    await click('lib-tab-imported');
    expect(text()).toContain('Spotify');
    await click('lib-src-spotify-songs');
    expect(titles('.track-line .result-title')).toEqual(['Apple', 'Banana']);
    await act(() => { api().goBack(); }); await settle();
    await click('lib-src-spotify-playlists');
    expect(titles('.result-title')).toEqual(['Dari Spotify']);
  });
});

describe('Sorting', () => {
  const order = () => titles('.track-line .result-title');
  const pick = async (label: string) => { await click('detail-sort'); await choose(label); };

  it('Songs can be sorted by artist, by play time and by date, ascending or descending, and the choice is saved', async () => {
    await mount(async (s) => {
      let clock = 1_000;
      vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1_000));
      for (const t of [apple(), banana(), cherry()]) await s.repo.addToLibrary(t);
      await s.repo.recordPlay({ id: 'x:1', track: banana(), sessionId: 'x', startedAt: NOW, listenedMs: 90_000 });
      await s.repo.recordPlay({ id: 'x:2', track: cherry(), sessionId: 'x', startedAt: NOW, listenedMs: 30_000 });
    });
    await go({ name: 'library', section: 'songs' });
    expect(byFocus('detail-sort')!.textContent).toContain('Nama');
    await pick('Artis');
    expect(order()).toEqual(['Cherry', 'Apple', 'Banana']);
    expect(titles('.letter-header')).toEqual([]);
    await click('detail-sort-dir');
    expect(order()).toEqual(['Banana', 'Apple', 'Cherry']);
    await pick('Waktu putar');
    expect(order()).toEqual(['Banana', 'Cherry', 'Apple']);
    await click('detail-sort-dir');
    expect(order()).toEqual(['Apple', 'Cherry', 'Banana']);
    await pick('Tanggal ditambahkan');
    await click('detail-sort-dir');
    expect(order()).toEqual(['Cherry', 'Banana', 'Apple']);
    expect(services.prefs.get('library.sort.songs', undefined)).toEqual({ key: 'date', descending: true });
    // Play starts from the sorted order.
    await click('detail-play');
    expect(currentTrack(queue())?.id).toBe('c1');
  });

  it('the picker marks the current choice; name order descending reverses the letters and rows', async () => {
    await mount(seedSongs);
    await go({ name: 'library', section: 'songs' });
    await click('detail-sort');
    expect(overlay()!.querySelector('.is-selected')!.textContent).toContain('Nama');
    await act(() => { api().closeOverlay(); });
    await click('detail-sort-dir');
    expect(titles('.letter-header')).toEqual(['C', 'B', 'A']);
    expect(order()).toEqual(['Cherry', 'Banana', 'Apple']);
  });

  it('a sort choice that cannot be saved is undone and reported', async () => {
    await mount(seedSongs);
    vi.spyOn(services.prefs, 'set').mockRejectedValue(new Error('penuh'));
    await go({ name: 'library', section: 'songs' });
    await pick('Artis');
    await settle();
    expect(toastText()).toBe('Pilihan urutan tidak tersimpan');
    expect(byFocus('detail-sort')!.textContent).toContain('Nama');
    expect(order()).toEqual(['Apple', 'Banana', 'Cherry']);
  });

  it('Liked offers its own choices; Recently added has none', async () => {
    await mount(async (s) => { await seedSongs(s); await s.repo.setLiked(banana(), true); await s.repo.setLiked(apple(), true); });
    await go({ name: 'library', section: 'liked' });
    await pick('Nama');
    expect(order()).toEqual(['Banana', 'Apple']); // direction is kept when the key changes, as on Android
    await click('detail-sort-dir');
    expect(order()).toEqual(['Apple', 'Banana']);
    await go({ name: 'library', section: 'added' });
    expect(byFocus('detail-sort')).toBeNull();
  });

  it('playlists sort by song count and last change', async () => {
    await mount(async (s) => {
      const a = await s.repo.createPlaylist('A-kecil'); await s.repo.addToPlaylist(a.id, [apple()]);
      const b = await s.repo.createPlaylist('B-besar'); await s.repo.addToPlaylist(b.id, [apple(), banana(), cherry()]);
    });
    await go({ name: 'library', section: 'playlists' });
    expect(titles('.result-title')).toEqual(['A-kecil', 'B-besar']);
    await pick('Jumlah lagu');
    await click('detail-sort-dir');
    expect(titles('.result-title')).toEqual(['B-besar', 'A-kecil']);
  });

  it('albums sort by release year and by how many saved songs they hold', async () => {
    await mount(async (s) => {
      await s.repo.saveEntity({ ref: { provider: 'youtube', kind: 'album', id: 'MPREa' }, title: 'Angin', subtitle: 'Album • 2020' });
      await s.repo.saveEntity({ ref: { provider: 'youtube', kind: 'album', id: 'MPREb' }, title: 'Bulan', subtitle: 'Album • 2018' });
      await s.repo.saveEntity({ ref: { provider: 'youtube', kind: 'album', id: 'MPREc' }, title: 'Cakra', subtitle: 'Album • 2024' });
      for (const t of [track('s1', { albumId: 'MPREc' }), track('s2', { albumId: 'MPREc' }), track('s3', { albumId: 'MPREb' })]) await s.repo.addToLibrary(t);
    });
    await go({ name: 'library', section: 'albums' });
    const albumNames = () => titles('.card-title');
    expect(albumNames()).toEqual(['Angin', 'Bulan', 'Cakra']);
    await pick('Tahun rilis');
    expect(albumNames()).toEqual(['Bulan', 'Angin', 'Cakra']);
    await pick('Jumlah lagu');
    await click('detail-sort-dir');
    expect(albumNames()).toEqual(['Cakra', 'Bulan', 'Angin']);
  });

  it('inside a playlist, moving songs works only in playlist order; other orders are for viewing', async () => {
    let id = '';
    await mount(async (s) => { id = (await s.repo.createPlaylist('Urut')).id; await s.repo.addToPlaylist(id, [cherry(), apple(), banana()]); });
    await go({ name: 'playlist', id, origin: 'local' });
    expect(order()).toEqual(['Cherry', 'Apple', 'Banana']);
    expect(byFocus('detail-sort-dir')).toBeNull();
    await pick('Nama');
    expect(order()).toEqual(['Apple', 'Banana', 'Cherry']);
    expect(text()).toContain('hanya di "Urutan playlist"');
    await click('detail-t-1-menu');
    expect(overlayButton('Naikkan')).toBeUndefined();
    expect(overlayButton('Hapus dari playlist')).toBeDefined();
    await act(() => { api().closeOverlay(); });
    await pick('Urutan playlist');
    expect(order()).toEqual(['Cherry', 'Apple', 'Banana']);
    await click('detail-t-1-menu');
    expect(overlayButton('Naikkan')).toBeDefined();
  });
});
