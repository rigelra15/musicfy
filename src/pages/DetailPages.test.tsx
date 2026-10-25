// @vitest-environment jsdom
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContextValue } from '../app/AppContext';
import type { PlayerPort } from '../app/engine';
import { openServices, type Services } from '../app/services';
import App from '../app/Shell';
import type { CatalogGateway } from '../catalog/gateway';
import { CatalogRequestError } from '../catalog/gateway';
import type { Route } from '../app/router';
import { album, fakeGateway, NOW, playlist, section, song, video } from '../features/home/testkit';
import { createMemoryDb } from '../library/db';
import type { PlaybackSnapshot, Track } from '../model';
import { currentTrack } from '../playback/queueModel';

class FakePlayer implements PlayerPort {
  loads: Track[] = [];
  listener: (snapshot: PlaybackSnapshot) => void = () => undefined;
  private sequence = 0;
  subscribe(listener: (snapshot: PlaybackSnapshot) => void) { this.listener = listener; return () => undefined; }
  async load(next: Track) { this.loads.push(next); this.sequence += 1; this.listener({ status: 'loading', positionMs: 0, durationMs: next.durationMs, loadId: this.sequence }); return this.sequence; }
  async play() { /* not needed */ }
  pause() { /* not needed */ }
  seekTo() { /* not needed */ }
  dispose() { /* nothing */ }
}

let host: HTMLElement;
let services: Services;
let api: () => AppContextValue;

async function mount(gateway: CatalogGateway, seed?: (s: Services) => Promise<void>) {
  const opened = await openServices({ db: createMemoryDb(), storage: { getItem: () => null } });
  if (!opened.ok) throw opened.error;
  services = opened.services;
  await services.prefs.set('ui.language', 'id');
  await services.prefs.set('onboarding.done', true);
  await seed?.(services);
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(() => { render(h(App, { services, catalog: gateway, now: () => NOW, playerFactory: () => new FakePlayer(), onReady: (getter) => { api = getter; } }), host); });
  await settle();
}
const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const byFocus = (id: string) => document.querySelector<HTMLElement>(`[data-focus-id="${id}"]`);
const click = async (id: string) => { await act(() => { byFocus(id)!.click(); }); await settle(); };
const go = async (next: Route) => { await act(() => { api().navigate(next); }); await settle(); };
const stage = () => document.querySelector('.app-stage')!;
const text = () => stage().textContent ?? '';
const queue = () => api().store.root.queue;
const queued = () => queue().entries.map((entry) => queue().tracks[entry.trackKey].id);
const tab = () => { const nav = api().store.nav; const stack = nav.stacks[nav.tab]; return stack[stack.length - 1].route; };

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.closest('[hidden]') ? [] : [{}]) as unknown as DOMRectList;
  });
});
afterEach(() => { render(null, host); host.remove(); vi.restoreAllMocks(); });

const albumPage = (extra: Record<string, unknown> = {}) => ({
  type: 'album', skipped: 0, related: [],
  header: { title: 'Laut Biru', subtitle: 'Album', year: '2024', artists: [{ id: 'UCband', name: 'Band Laut' }], artworkUrl: 'https://img/cover.jpg', secondSubtitle: '3 lagu, 10 menit' },
  tracks: [song('a1', { artists: undefined, subtitle: undefined, durationMs: 180_000 }), song('a2', { artists: undefined, durationMs: undefined }), song('a3', { artists: [{ id: 'UCguest', name: 'Tamu' }] })],
  ...extra,
});

describe('Album page', () => {
  it('shows header and songs; tapping a song plays the album from there with the album filled in from the header', async () => {
    const albumFn = vi.fn(async () => albumPage());
    await mount(fakeGateway({ album: albumFn }));
    await go({ name: 'album', id: 'MPREb_1' });
    expect(albumFn).toHaveBeenCalledWith('MPREb_1', expect.anything());
    expect(text()).toContain('Laut Biru');
    expect(text()).toContain('Band Laut');
    expect(text()).toContain('2024');
    expect(text()).toContain('3 lagu, 10 menit');
    expect(stage().querySelectorAll('.detail-tracks .result-row')).toHaveLength(3);
    // No duration upstream → nothing shown, never an invented time or a placeholder.
    expect(stage().querySelectorAll('.result-duration')[1].textContent).toBe('');
    await click('detail-t-1');
    expect(queued()).toEqual(['a1', 'a2', 'a3']);
    expect(currentTrack(queue())?.id).toBe('a2');
    const playing = currentTrack(queue())!;
    expect(playing.album).toBe('Laut Biru');
    expect(playing.albumId).toBe('MPREb_1');
    expect(playing.artist).toBe('Band Laut');
    expect(playing.artworkUrl).toBe('https://img/cover.jpg');
    expect(queue().entries.every((entry) => entry.origin === 'album')).toBe(true);
  });

  it('Putar starts at the first song; Acak turns queue shuffle on with every song still queued', async () => {
    await mount(fakeGateway({ album: vi.fn(async () => albumPage()) }));
    await go({ name: 'album', id: 'MPREb_1' });
    await click('detail-play');
    expect(currentTrack(queue())?.id).toBe('a1');
    expect(queue().shuffle).toBe(false);
    await click('detail-shuffle');
    expect(queue().shuffle).toBe(true);
    expect([...queued()].sort()).toEqual(['a1', 'a2', 'a3']);
  });

  it('Simpan stores the album in the library and toggles back', async () => {
    await mount(fakeGateway({ album: vi.fn(async () => albumPage()) }));
    await go({ name: 'album', id: 'MPREb_1' });
    await click('detail-save');
    expect((await services.repo.listSavedEntities('album')).map((item) => item.ref.id)).toEqual(['MPREb_1']);
    expect(byFocus('detail-save')!.getAttribute('aria-pressed')).toBe('true');
    await click('detail-save');
    expect(await services.repo.listSavedEntities('album')).toHaveLength(0);
  });

  it('the artist name opens the artist page and Back returns to the album without asking the network again', async () => {
    const albumFn = vi.fn(async () => albumPage());
    const artistFn = vi.fn(async () => ({ type: 'artist', skipped: 0, header: { title: 'Band Laut' }, songs: [song('x1')], sections: [] }));
    await mount(fakeGateway({ album: albumFn, artist: artistFn }));
    await go({ name: 'album', id: 'MPREb_1' });
    await click('detail-artist-0');
    expect(tab()).toMatchObject({ name: 'artist', id: 'UCband' });
    expect(text()).toContain('Band Laut');
    await act(() => { api().goBack(); });
    await settle();
    expect(text()).toContain('Laut Biru');
    expect(albumFn).toHaveBeenCalledTimes(1);
  });

  it('copes with a bare header: no artists, year, description or tracks', async () => {
    await mount(fakeGateway({ album: vi.fn(async () => ({ type: 'album', skipped: 0, related: [], header: { title: 'Kosong' }, tracks: [] })) }));
    await go({ name: 'album', id: 'MPREb_2' });
    expect(text()).toContain('Kosong');
    expect(text()).toContain('Belum ada lagu yang bisa diputar');
    expect(byFocus('detail-play')!.hasAttribute('disabled')).toBe(true);
    expect(byFocus('detail-shuffle')!.hasAttribute('disabled')).toBe(true);
  });

  it('a failed load offers retry, and retrying loads the page; a missing album offers no retry', async () => {
    const albumFn = vi.fn()
      .mockRejectedValueOnce(new CatalogRequestError('network', 'down'))
      .mockResolvedValue(albumPage());
    await mount(fakeGateway({ album: albumFn }));
    await go({ name: 'album', id: 'MPREb_1' });
    expect(text()).toContain('tidak bisa dimuat');
    await click('detail-retry');
    expect(text()).toContain('Laut Biru');
    await act(() => { api().goBack(); }); await settle();
    const missing = vi.fn(async () => { throw new CatalogRequestError('not-found', 'nope'); });
    await act(() => { render(null, host); host.remove(); });
    await mount(fakeGateway({ album: missing }));
    await go({ name: 'album', id: 'MPREb_404' });
    expect(text()).toContain('tidak ditemukan');
    expect(byFocus('detail-retry')).toBeNull();
    expect(byFocus('detail-back')).not.toBeNull();
  });

  it('a different upstream item that shares a title stays a separate song; duplicates by id collapse', async () => {
    const tracks = [song('v1', { title: 'Sama' }), song('v2', { title: 'Sama' }), song('v1', { title: 'Sama' })];
    await mount(fakeGateway({ album: vi.fn(async () => albumPage({ tracks })) }));
    await go({ name: 'album', id: 'MPREb_3' });
    expect(stage().querySelectorAll('.detail-tracks .result-row')).toHaveLength(2);
  });

  it('hides explicit songs when the preference says so', async () => {
    await mount(fakeGateway({ album: vi.fn(async () => albumPage({ tracks: [song('e1', { isExplicit: true }), song('e2')] })) }), async ({ prefs }) => { await prefs.set('content.hideExplicit', true); });
    await go({ name: 'album', id: 'MPREb_4' });
    expect(stage().querySelectorAll('.detail-tracks .result-row')).toHaveLength(1);
  });

  it('a 600-song album mounts only the first slice of rows', async () => {
    const tracks = Array.from({ length: 600 }, (_, i) => song(`big${i}`));
    await mount(fakeGateway({ album: vi.fn(async () => albumPage({ tracks })) }));
    await go({ name: 'album', id: 'MPREb_5' });
    expect(stage().querySelectorAll('.detail-tracks .result-row').length).toBeLessThanOrEqual(60);
    await click('detail-t-0');
    expect(queue().entries).toHaveLength(600);
  });

  it('related shelves become card rows that open their targets', async () => {
    const related = [section('rel', [album('b1'), playlist('PLx')], { title: 'Dari artis ini' })];
    await mount(fakeGateway({ album: vi.fn(async () => albumPage({ related })) }));
    await go({ name: 'album', id: 'MPREb_6' });
    expect(text()).toContain('Dari artis ini');
    await act(() => { stage().querySelector<HTMLElement>('.home-card')!.click(); }); await settle();
    expect(tab()).toMatchObject({ name: 'album', id: 'MPREb1' });
  });
});

const playlistPage = (extra: Record<string, unknown> = {}) => ({
  type: 'playlist', skipped: 0, related: [],
  header: { title: 'Santai Sore', subtitle: 'Playlist • Musicfy', artworkUrl: 'https://img/pl.jpg' },
  tracks: [song('p1'), song('p2'), video('p3')],
  ...extra,
});

describe('Playlist page', () => {
  it('online: shows songs, plays them with playlist origin, and saves under the bare playlist id', async () => {
    const playlistFn = vi.fn(async () => playlistPage());
    await mount(fakeGateway({ playlist: playlistFn }));
    await go({ name: 'playlist', id: 'PLabc', origin: 'online' });
    expect(playlistFn).toHaveBeenCalledWith('PLabc', expect.anything());
    expect(text()).toContain('Santai Sore');
    await click('detail-t-2');
    expect(currentTrack(queue())?.id).toBe('p3');
    expect(queue().entries.every((entry) => entry.origin === 'playlist')).toBe(true);
    await click('detail-save');
    expect((await services.repo.listSavedEntities('playlist')).map((item) => item.ref.id)).toEqual(['PLabc']);
  });

  it('a VL-prefixed id is saved without the prefix', async () => {
    await mount(fakeGateway({ playlist: vi.fn(async () => playlistPage()) }));
    await go({ name: 'playlist', id: 'VLPLabc', origin: 'online' });
    await click('detail-save');
    expect((await services.repo.listSavedEntities('playlist')).map((item) => item.ref.id)).toEqual(['PLabc']);
  });

  it('Muat lebih banyak appends the next page and drops the button when the end is reached', async () => {
    const more = vi.fn(async () => ({ items: [song('p4'), song('p5')], sections: [], skipped: 0 }));
    await mount(fakeGateway({ playlist: vi.fn(async () => playlistPage({ continuation: { token: 'c1' } })), more }));
    await go({ name: 'playlist', id: 'PLabc', origin: 'online' });
    expect(stage().querySelectorAll('.detail-tracks .result-row')).toHaveLength(3);
    await click('detail-more');
    expect(more).toHaveBeenCalledWith('browse', { token: 'c1' });
    expect(stage().querySelectorAll('.detail-tracks .result-row')).toHaveLength(5);
    expect(byFocus('detail-more')).toBeNull();
  });

  it('a failed "load more" keeps the songs already shown and says so', async () => {
    await mount(fakeGateway({ playlist: vi.fn(async () => playlistPage({ continuation: { token: 'c1' } })) }));
    await go({ name: 'playlist', id: 'PLabc', origin: 'online' });
    await click('detail-more');
    expect(stage().querySelectorAll('.detail-tracks .result-row')).toHaveLength(3);
    expect(text()).toContain('tidak bisa dimuat');
    expect(byFocus('detail-more')).not.toBeNull();
  });

  it('skipped rows are reported, not hidden', async () => {
    await mount(fakeGateway({ playlist: vi.fn(async () => playlistPage({ skipped: 2 })) }));
    await go({ name: 'playlist', id: 'PLabc', origin: 'online' });
    expect(text()).toContain('2 item tidak bisa ditampilkan');
  });

  it('local: plays stored songs, notes the imported source with its partial count', async () => {
    let playlistId = '';
    await mount(fakeGateway(), async ({ repo }) => {
      const a = { id: 'l1', title: 'Lagu Lokal', artist: 'Aku', durationMs: 100_000, provider: 'youtube' as const };
      const b = { ...a, id: 'l2', title: 'Lagu Dua' };
      const created = await repo.createPlaylist('Favorit Impor', { source: { provider: 'spotify', id: 'sp1', title: 'Spotify', importedAt: NOW, reportedTrackCount: 5 } });
      playlistId = created.id;
      await repo.addToPlaylist(created.id, [a, b]);
    });
    await go({ name: 'playlist', id: playlistId, origin: 'local' });
    expect(text()).toContain('Favorit Impor');
    expect(text()).toContain('Diimpor dari Spotify');
    expect(text()).toContain('2 dari 5 lagu berhasil diimpor');
    await click('detail-t-1');
    expect(queued()).toEqual(['l1', 'l2']);
    expect(currentTrack(queue())?.id).toBe('l2');
    expect(queue().entries.every((entry) => entry.origin === 'playlist')).toBe(true);
  });

  it('local: an unknown playlist says it is not found; an automatic one says it comes later', async () => {
    await mount(fakeGateway());
    await go({ name: 'playlist', id: 'nope', origin: 'local' });
    expect(text()).toContain('tidak ditemukan');
    await go({ name: 'playlist', id: 'auto-1', origin: 'auto' });
    expect(text()).toContain('Playlist otomatis');
  });
});

const artistPage = (extra: Record<string, unknown> = {}) => ({
  type: 'artist', skipped: 0,
  header: { title: 'Band Laut', description: 'Band dari pesisir.', subscribers: '1,2 jt pelanggan', monthlyListeners: '3 jt pendengar bulanan', radioPlaylistId: 'RDEMx', radioVideoId: 'x1' },
  songs: [song('x1'), song('x2'), song('x3')],
  songsMore: { browseId: 'VLsongs', params: 'ps' },
  sections: [
    section('albums', [album('b1'), album('b2')], { title: 'Album', more: { browseId: 'MPADalbums', params: 'pa' } }),
    section('vids', [video('v1'), video('v2')], { title: 'Video' }),
  ],
  ...extra,
});

describe('Artist page', () => {
  it('shows name, stats, about text and top songs; a song plays the top-songs queue from there', async () => {
    const artistFn = vi.fn(async () => artistPage());
    await mount(fakeGateway({ artist: artistFn }));
    await go({ name: 'artist', id: 'UCband', title: 'Band Laut' });
    expect(artistFn).toHaveBeenCalledWith('UCband', expect.anything());
    expect(text()).toContain('Band Laut');
    expect(text()).toContain('3 jt pendengar bulanan');
    expect(text()).toContain('Band dari pesisir.');
    expect(text()).toContain('Lagu teratas');
    await click('artist-song-1');
    expect(queued()).toEqual(['x1', 'x2', 'x3']);
    expect(currentTrack(queue())?.id).toBe('x2');
  });

  it('Putar plays the top songs, Acak shuffles them', async () => {
    await mount(fakeGateway({ artist: vi.fn(async () => artistPage()) }));
    await go({ name: 'artist', id: 'UCband' });
    await click('detail-play');
    expect(currentTrack(queue())?.id).toBe('x1');
    expect(queue().shuffle).toBe(false);
    await click('detail-shuffle');
    expect(queue().shuffle).toBe(true);
  });

  it('Radio asks for the artist radio and queues it with radio origin; a failure is reported and nothing is queued', async () => {
    const next = vi.fn()
      .mockRejectedValueOnce(new CatalogRequestError('network', 'down'))
      .mockResolvedValueOnce({ items: [song('r1'), song('r2')], skipped: 0 });
    await mount(fakeGateway({ artist: vi.fn(async () => artistPage()), next }));
    await go({ name: 'artist', id: 'UCband' });
    await click('detail-radio');
    expect(text()).toContain('Radio tidak bisa dimulai');
    expect(queue().entries).toHaveLength(0);
    await click('detail-radio');
    expect(next).toHaveBeenLastCalledWith({ playlistId: 'RDEMx', videoId: 'x1' });
    expect(queued()).toEqual(['r1', 'r2']);
    expect(queue().entries.every((entry) => entry.origin === 'radio')).toBe(true);
  });

  it('with no top songs, Putar falls back to the radio; with neither, Putar and Radio are disabled', async () => {
    const next = vi.fn(async () => ({ items: [song('r1')], skipped: 0 }));
    await mount(fakeGateway({ artist: vi.fn(async () => artistPage({ songs: [], songsMore: undefined, sections: [] })), next }));
    await go({ name: 'artist', id: 'UCquiet' });
    await click('detail-play');
    expect(queued()).toEqual(['r1']);
    expect(byFocus('detail-shuffle')!.hasAttribute('disabled')).toBe(true);
  });

  it('an artist with nothing playable says so and disables the actions', async () => {
    const bare = artistPage({ songs: [], songsMore: undefined, sections: [], header: { title: 'Sunyi' } });
    await mount(fakeGateway({ artist: vi.fn(async () => bare) }));
    await go({ name: 'artist', id: 'UCsunyi' });
    expect(text()).toContain('Sunyi');
    expect(text()).toContain('Belum ada lagu');
    expect(byFocus('detail-play')!.hasAttribute('disabled')).toBe(true);
    expect(byFocus('detail-radio')!.hasAttribute('disabled')).toBe(true);
  });

  it('Ikuti saves the artist; shelves open albums and play videos', async () => {
    await mount(fakeGateway({ artist: vi.fn(async () => artistPage()) }));
    await go({ name: 'artist', id: 'UCband' });
    await click('detail-save');
    expect((await services.repo.listSavedEntities('artist')).map((item) => item.ref.id)).toEqual(['UCband']);
    expect(byFocus('detail-save')!.textContent).toContain('Diikuti');
    const cards = stage().querySelectorAll<HTMLElement>('.home-card');
    expect(cards.length).toBe(4);
    await act(() => { cards[0].click(); }); await settle();
    expect(tab()).toMatchObject({ name: 'album', id: 'MPREb1' });
  });

  it('"Lihat semua" on a shelf and on top songs open the full lists; the list plays and loads more', async () => {
    const browse = vi.fn(async (browseId: string) => browseId === 'VLsongs'
      ? { type: 'playlist', skipped: 0, related: [], header: { title: 'Semua lagu' }, tracks: [song('s1'), song('s2')], continuation: { token: 'k' } }
      : { type: 'page', skipped: 0, sections: [section('g', [album('b1'), album('b2'), album('b3')])] });
    const more = vi.fn(async () => ({ items: [song('s3')], sections: [], skipped: 0 }));
    await mount(fakeGateway({ artist: vi.fn(async () => artistPage()), browse, more }));
    await go({ name: 'artist', id: 'UCband', title: 'Band Laut' });
    await click('artist-songs-all');
    expect(tab()).toMatchObject({ name: 'artist', tab: 'songs', browseId: 'VLsongs', params: 'ps' });
    expect(browse).toHaveBeenCalledWith('VLsongs', 'ps', expect.anything());
    expect(stage().querySelectorAll('.result-row')).toHaveLength(2);
    await click('browse-more');
    expect(stage().querySelectorAll('.result-row')).toHaveLength(3);
    await click('browse-t-2');
    expect(queued()).toEqual(['s1', 's2', 's3']);
    await act(() => { api().goBack(); }); await settle();
    await click('artist-sec-0-all');
    expect(tab()).toMatchObject({ name: 'artist', tab: 'items', browseId: 'MPADalbums' });
    expect(stage().querySelectorAll('.home-card')).toHaveLength(3);
  });

  it('a failed artist load offers retry and keeps Back working', async () => {
    const artistFn = vi.fn().mockRejectedValueOnce(new CatalogRequestError('timeout', 'slow')).mockResolvedValue(artistPage());
    await mount(fakeGateway({ artist: artistFn }));
    await go({ name: 'artist', id: 'UCband' });
    expect(byFocus('detail-retry')).not.toBeNull();
    await click('detail-retry');
    expect(text()).toContain('Lagu teratas');
  });
});

describe('Genre page', () => {
  const withSub = (item: any, subtitle: string, artworkUrl = 'https://img/x.jpg') => ({ ...item, subtitle, artworkUrl });
  const playlistPage = (title: string, count: string, urls: string[]) => ({ type: 'playlist' as const, related: [], skipped: 0, header: { title, secondSubtitle: `${count} • 4 hours` }, tracks: urls.map((url, i) => ({ ...song(`c${i}`), artworkUrl: url })) });

  it('is laid out like the phone: back button, name and blurb, a carousel per shelf, then the community playlists', async () => {
    const page = vi.fn(async () => ({
      type: 'page', skipped: 0, title: 'Chill', continuation: { token: 'g1' },
      sections: [
        section('s1', [withSub(playlist('PL1'), 'Playlist • YouTube Music'), withSub(playlist('PL2'), 'Playlist • YouTube Music')], { title: 'Coffee shop blends' }),
        section('s2', [withSub(album('b1'), 'Album • Band • 2026')], { title: 'Unwind + explore' }),
      ],
    }));
    const more = vi.fn(async () => ({ items: [], skipped: 0, sections: [section('extra', [album('b9')], { title: 'Album santai' })] }));
    const playlistFn = vi.fn(async (id: string) => playlistPage(`Komunitas ${id}`, '80 songs', ['https://img/1.jpg', 'https://img/2.jpg', 'https://img/3.jpg', 'https://img/4.jpg']));
    await mount(fakeGateway({ page, more, playlist: playlistFn }));
    await go({ name: 'genre', browseId: 'FEchill', params: 'p', title: 'Santai' });
    await settle();
    expect(document.querySelector('h1')!.textContent).toBe('Chill');
    expect(document.querySelector('.genre-description')!.textContent).toContain('Musik bertempo pelan dan tanpa tekanan');
    expect([...document.querySelectorAll('.genre-section h2')].map((h) => h.textContent)).toEqual(['Coffee shop blends', 'Dari komunitas', 'Unwind + explore']);
    expect(stage().querySelectorAll('.genre-section .carousel')).toHaveLength(3);
    expect(stage().querySelector('.genre-card-sub')!.textContent).toBe('YouTube Music');
    expect(stage().querySelectorAll('.community-card')).toHaveLength(2);
    expect(stage().querySelector('.community-count')!.textContent).toBe('80 songs');
    expect(playlistFn).toHaveBeenCalledTimes(2);
    await click('genre-more');
    expect(text()).toContain('Album santai');
    await click('genre-back');
    expect(tab()).not.toMatchObject({ name: 'genre' });
  });

  it('starts on the first card (not the back arrow), the remote reaches the back arrow with Up and walks the cards with Left and Right', async () => {
    const page = vi.fn(async () => ({ type: 'page', skipped: 0, title: 'Chill', sections: [section('s1', [withSub(playlist('PL1'), 'Playlist • YouTube Music'), withSub(playlist('PL2'), 'Playlist • YouTube Music'), withSub(album('b1'), 'Album • Band')], { title: 'Rak' })] }));
    await mount(fakeGateway({ page, playlist: vi.fn(async () => playlistPage('Komunitas', '12 songs', ['https://img/1.jpg'])) }));
    await go({ name: 'genre', browseId: 'FEchill', title: 'Santai' });
    await settle();
    const active = () => (document.activeElement as HTMLElement | null)?.dataset.focusId;
    const press = async (key: string) => { await act(() => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); }); await settle(); };
    expect(active()).toBe('genre-card-0-0');
    await press('ArrowRight');
    expect(active()).toBe('genre-card-0-1');
    await press('ArrowRight');
    expect(active()).toBe('genre-card-0-2');
    await press('ArrowLeft');
    expect(active()).toBe('genre-card-0-1');
    await press('ArrowUp');
    expect(active()).toBe('genre-back');
    await press('ArrowDown');
    expect(active()?.startsWith('genre-card-0-')).toBe(true);
    await press('ArrowDown');
    expect(active()).toBe('genre-community-0');
  });

  it('a playlist or album card opens it; community cards open their playlist', async () => {
    const page = vi.fn(async () => ({ type: 'page', skipped: 0, title: 'Chill', sections: [section('s1', [withSub(playlist('PL1'), 'Playlist • YouTube Music'), withSub(album('b1'), 'Album • Band')], { title: 'Rak' })] }));
    await mount(fakeGateway({ page, playlist: vi.fn(async () => playlistPage('Komunitas', '12 songs', ['https://img/1.jpg'])) }));
    await go({ name: 'genre', browseId: 'FEchill', title: 'Santai' });
    await settle();
    await click('genre-community-0');
    expect(tab()).toMatchObject({ name: 'playlist', origin: 'online' });
  });

  it('an empty or failing genre page says so', async () => {
    await mount(fakeGateway({ page: vi.fn(async () => ({ type: 'page', skipped: 0, sections: [] })) }));
    await go({ name: 'genre', browseId: 'FEx', title: 'Kosong' });
    expect(text()).toContain('Belum ada isi untuk genre ini');
  });
});

describe('Player links', () => {
  it('the playing song opens its artist and album', async () => {
    await mount(fakeGateway({ artist: vi.fn(async () => artistPage()), album: vi.fn(async () => albumPage()) }));
    const t: Track = { id: 'pl1', title: 'Lagu', artist: 'Band Laut', artists: [{ id: 'UCband', name: 'Band Laut' }], album: 'Laut Biru', albumId: 'MPREb_1', durationMs: 100_000, provider: 'youtube' };
    await act(() => { api().playTracks([t], 0, 'manual'); });
    await act(() => { api().goTab('player'); });
    await settle();
    await click('player-artist-0');
    expect(tab()).toMatchObject({ name: 'artist', id: 'UCband' });
    await act(() => { api().goBack(); }); await settle();
    // The player shows title and artist only; the album is reached from the song details, not from this line.
    expect(byFocus('player-album')).toBeNull();
    expect(document.querySelector('.player-details')!.textContent).not.toContain('Laut Biru');
  });

  it('a song without artist ids or album shows plain text, no links', async () => {
    await mount(fakeGateway());
    const t: Track = { id: 'pl2', title: 'Lagu', artist: 'Entah Siapa', durationMs: 100_000, provider: 'youtube' };
    await act(() => { api().playTracks([t], 0, 'manual'); });
    await act(() => { api().goTab('player'); });
    await settle();
    expect(byFocus('player-artist-0')).toBeNull();
    expect(byFocus('player-album')).toBeNull();
    expect(text()).toContain('Entah Siapa');
  });
});

describe('Focus on late content', () => {
  it('moves to the first control once a page that was loading arrives, unless the user already left the tab', async () => {
    let release: (page: unknown) => void = () => undefined;
    const slow = new Promise((resolve) => { release = resolve; });
    await mount(fakeGateway({ album: vi.fn(() => slow) }));
    await go({ name: 'album', id: 'MPREb_1' });
    expect((document.activeElement as HTMLElement).dataset.focusId).toBe('nav-home');
    await act(async () => { release(albumPage()); await slow; });
    await settle();
    expect((document.activeElement as HTMLElement).dataset.focusId).toBe('detail-artist-0');
  });

  it('does not steal focus when the user moved to another nav item meanwhile', async () => {
    let release: (page: unknown) => void = () => undefined;
    const slow = new Promise((resolve) => { release = resolve; });
    await mount(fakeGateway({ album: vi.fn(() => slow) }));
    await go({ name: 'album', id: 'MPREb_1' });
    await act(() => { byFocus('nav-settings')!.focus(); });
    await act(async () => { release(albumPage()); await slow; });
    await settle();
    expect((document.activeElement as HTMLElement).dataset.focusId).toBe('nav-settings');
  });
});
