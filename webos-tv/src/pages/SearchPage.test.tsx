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
import { album, fakeGateway, NOW, playlist, section, song } from '../features/home/testkit';
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
let player: FakePlayer;
let services: Services;
let api: () => AppContextValue;

async function mount(gateway: CatalogGateway, seed?: (s: Services) => Promise<void>) {
  const opened = await openServices({ db: createMemoryDb(), storage: { getItem: () => null } });
  if (!opened.ok) throw opened.error;
  services = opened.services;
  await services.prefs.set('ui.language', 'id');
  await services.prefs.set('onboarding.done', true);
  await seed?.(services);
  player = new FakePlayer();
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(() => { render(h(App, { services, catalog: gateway, now: () => NOW, playerFactory: () => player, onReady: (getter) => { api = getter; } }), host); });
  await settle();
  await click('nav-search');
}
const settle = async (ms = 0) => {
  if (ms > 0) await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
  for (let i = 0; i < 8; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
};
const byFocus = (id: string) => document.querySelector<HTMLElement>(`[data-focus-id="${id}"]`);
const click = async (id: string) => { await act(() => { byFocus(id)!.click(); }); await settle(); };
const type = async (value: string) => {
  const input = byFocus('search-query') as HTMLInputElement;
  await act(() => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); });
};
const submit = async () => { await act(() => { (document.querySelector('.search-form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await settle(); };
const active = () => (document.activeElement as HTMLElement | null)?.dataset.focusId;
const route = () => { const stack = api().store.nav.stacks.search; return stack[stack.length - 1].route; };
const text = () => document.querySelector('.search-view')!.textContent ?? '';

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.closest('[hidden]') ? [] : [{}]) as unknown as DOMRectList;
  });
});
afterEach(() => { render(null, host); host.remove(); vi.restoreAllMocks(); });

const tile = (title: string) => ({ kind: 'link' as const, id: title, browseId: `FEg${title}`, params: 'p', title, color: '#336699' });
const searchOk = (extra: Record<string, unknown> = {}) => vi.fn(async (_q: string, filter: string) => filter === 'all'
  ? { filter, skipped: 0, items: [], sections: [section('top', [song('t1', { title: 'Hujan Deras' })], { title: 'Top', topResult: true }), section('songs', [song('s1'), song('s2')], { title: 'Lagu' }), section('rest', [album('a1'), playlist('PL1')], { title: 'Lainnya' })] }
  : { filter, skipped: 0, sections: [], items: filter === 'albums' ? [album('a1'), album('a2')] : [song('f1'), song('f2')], ...extra });

describe('Search page', () => {
  it('idle shows history and mood/genre tiles; a tile opens the genre route; history can be forgotten', async () => {
    const page = vi.fn(async () => ({ type: 'page', skipped: 0, sections: [section('m', [tile('Santai'), tile('Fokus')], { title: 'Suasana' })] }));
    await mount(fakeGateway({ page }), async ({ repo }) => { await repo.rememberSearch('hujan'); await repo.rememberSearch('laut'); });
    await settle();
    expect(text()).not.toContain('Riwayat pencarian');            // as on the phone, history shows while the field is active
    await act(() => { byFocus('search-query')!.focus(); });
    await settle();
    expect(text()).toContain('Riwayat pencarian');
    expect(text()).toContain('hujan');
    expect(text()).toContain('Suasana & momen');
    expect(Array.from(document.querySelectorAll('.genre-tile')).map((el) => el.textContent)).toEqual(['Santai', 'Fokus']);
    await act(() => { (document.querySelector('.history-line .row-more') as HTMLElement).click(); });
    await settle();
    expect((await services.repo.listSearches()).length).toBe(1);
    await act(() => { (document.querySelector('.genre-tile') as HTMLElement).click(); });
    expect(route()).toEqual({ name: 'genre', browseId: 'FEgSantai', params: 'p', title: 'Santai' });
  });

  it('shows an honest message when moods and genres cannot be loaded, with retry', async () => {
    let failing = true;
    const page = vi.fn(async (browseId: string) => {
      if (browseId !== 'FEmusic_moods_and_genres' || failing) throw new CatalogRequestError('network', 'offline');
      return { type: 'page', skipped: 0, sections: [section('m', [tile('Santai')])] };
    });
    await mount(fakeGateway({ page }));
    expect(text()).toContain('Suasana dan genre tidak bisa dimuat');
    failing = false;
    await click('genres-retry');
    expect(document.querySelectorAll('.genre-tile')).toHaveLength(1);
  });

  it('typing shows suggestions after the debounce; choosing one searches it and pushes the results route', async () => {
    const suggest = vi.fn(async () => ({ queries: ['hujan deras', 'hujan reda'], items: [song('rec1', { title: 'Rekomen' })] }));
    await mount(fakeGateway({ suggest, search: searchOk() }));
    await type('huj');
    expect(suggest).not.toHaveBeenCalled();
    await settle(300);
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(text()).toContain('hujan deras');
    expect(text()).toContain('Rekomen');
    const suggestion = Array.from(document.querySelectorAll<HTMLElement>('.result-row.history-row')).find((el) => el.textContent === 'hujan deras')!;
    await act(() => { suggestion.click(); });
    await settle();
    expect(route()).toEqual({ name: 'search', query: 'hujan deras' });
    expect(document.querySelectorAll('.search-filters .search-chip')).toHaveLength(7);
    expect(text()).toContain('Hasil teratas');
    expect(await services.repo.listSearches()).toEqual(['hujan deras']);
  });

  it('results: filter chips load their own list; an album result opens the album and Back keeps query, filter and results', async () => {
    const search = searchOk();
    await mount(fakeGateway({ search }));
    await type('laut');
    await submit();
    expect(search).toHaveBeenCalledTimes(1);
    await click('search-filter-albums');
    expect(byFocus('search-filter-albums')!.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelectorAll('.result-row')).toHaveLength(2);
    const second = document.querySelectorAll<HTMLElement>('.result-row')[1];
    const secondId = second.dataset.focusId!;
    second.focus();
    await act(() => { (document.querySelector('.result-row') as HTMLElement).click(); });
    await settle();
    expect(route()).toEqual({ name: 'album', id: 'MPREa1' });
    await act(() => { api().goBack(); });
    await settle();
    expect(route()).toEqual({ name: 'search', query: 'laut' });
    expect(active()).toBe(secondId);                      // focus returns to the result that was focused
    expect(byFocus('search-filter-albums')!.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelectorAll('.result-row')).toHaveLength(2);
    expect(search).toHaveBeenCalledTimes(2);              // All once, Albums once; nothing re-fetched on Back
  });

  it('artist and playlist results open their detail routes instead of playing', async () => {
    const search = vi.fn(async () => ({ filter: 'all', skipped: 0, items: [], sections: [section('x', [{ kind: 'artist' as const, id: 'UCx', browseId: 'UCx', title: 'Xena' }, playlist('PL9')])] }));
    await mount(fakeGateway({ search }));
    await type('x'); await submit();
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.result-row'));
    await act(() => { rows[0].click(); });
    expect(route()).toMatchObject({ name: 'artist', id: 'UCx' });
    expect(player.loads).toHaveLength(0);
    await act(() => { api().goBack(); });
    await settle();
    await act(() => { Array.from(document.querySelectorAll<HTMLElement>('.result-row'))[1].click(); });
    expect(route()).toEqual({ name: 'playlist', id: 'PL9', origin: 'online' });
  });

  it('tapping a song plays it at once and its radio joins the queue afterwards', async () => {
    const next = vi.fn(async () => ({ items: [song('s1'), song('r1'), song('r2', { isExplicit: true })] }));
    await mount(fakeGateway({ search: searchOk(), next }));
    await type('hu'); await submit();
    const songRow = Array.from(document.querySelectorAll<HTMLElement>('.result-row')).find((el) => el.textContent?.includes('Song s1'))!;
    await act(() => { songRow.click(); });
    expect(player.loads.map((track) => track.id)).toEqual(['s1']);
    await settle();
    const queue = api().store.root.queue;
    expect(next).toHaveBeenCalledWith({ videoId: 's1' }, expect.anything());
    expect(currentTrack(queue)!.id).toBe('s1');
    expect(queue.entries.map((entry) => entry.trackKey)).toEqual(['youtube:track:s1', 'youtube:track:r1', 'youtube:track:r2']);
    expect(queue.entries[1].origin).toBe('autoplay');   // the queue refills itself once its last song is current
    expect(player.loads).toHaveLength(1);                 // the radio does not restart the current song
  });

  it('the radio is dropped when the user already moved on, and a failing radio leaves the song playing', async () => {
    const slow = new Promise<{ items: ReturnType<typeof song>[] }>((resolve) => setTimeout(() => resolve({ items: [song('r1')] }), 30));
    await mount(fakeGateway({ search: searchOk(), next: vi.fn(async (ref: { videoId?: string }) => (ref.videoId === 's1' ? slow : { items: [] })) }));
    await type('hu'); await submit();
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.result-row'));
    await act(() => { rows.find((el) => el.textContent?.includes('Song s1'))!.click(); });
    await act(() => { api().playTracks([song('other') as never], 0, 'manual'); });
    await settle(50);
    expect(api().store.root.queue.entries).toHaveLength(1);
    const failing = await (async () => {
      await act(() => { api().playSong({ id: 'z', title: 'Z', artist: 'A', durationMs: 1000, provider: 'youtube' }); });
      return settle(5);
    })();
    void failing;
    expect(currentTrack(api().store.root.queue)!.id).toBe('z');
  });

  it('going back from results to a typed query shows its history and suggestions again, never a stuck spinner', async () => {
    const suggest = vi.fn(async (_query: string) => ({ queries: ['lautan biru'], items: [] }));
    await mount(fakeGateway({ search: searchOk(), suggest }));
    await type('laut');
    await settle(300);
    await submit();
    await act(() => { api().goBack(); });
    await settle(300);
    expect(route()).toEqual({ name: 'search' });
    expect(text()).not.toContain('Sedang mencari');
    expect(text()).toContain('lautan biru');
  });

  it('editing the query inside results returns to typing with the draft kept', async () => {
    await mount(fakeGateway({ search: searchOk(), suggest: vi.fn(async () => ({ queries: ['lautan'], items: [] })) }));
    await type('laut'); await submit();
    expect(route()).toEqual({ name: 'search', query: 'laut' });
    await type('lauta');
    await settle();
    expect(route()).toEqual({ name: 'search' });
    expect((byFocus('search-query') as HTMLInputElement).value).toBe('lauta');
    expect(document.querySelector('.search-filters')).toBeNull();
  });

  it('a failed search shows the error with Coba lagi, and an empty filter says there is nothing', async () => {
    const search = vi.fn()
      .mockRejectedValueOnce(new CatalogRequestError('rate-limited', 'slow'))
      .mockResolvedValueOnce({ filter: 'all', skipped: 0, items: [], sections: [] });
    await mount(fakeGateway({ search }));
    await type('q'); await submit();
    expect(text()).toContain('membatasi permintaan');
    await click('search-retry');
    expect(text()).toContain('Tidak ada hasil untuk "q"');
  });

  it('a pasted song link shows the song it points to and tapping it plays it', async () => {
    const next = vi.fn(async () => ({ items: [song('dQw4w9WgXcQ', { title: 'Never Gonna' })] }));
    await mount(fakeGateway({ next, suggest: vi.fn() }));
    await type('https://youtu.be/dQw4w9WgXcQ');
    await settle(300);
    expect(text()).toContain('Dari tautan');
    await click('search-link');
    expect(player.loads[0].id).toBe('dQw4w9WgXcQ');
  });

  it('paging: results continue with Muat lebih banyak', async () => {
    const more = vi.fn(async () => ({ items: [song('f3')], sections: [], skipped: 0 }));
    await mount(fakeGateway({ search: searchOk({ continuation: { token: 'n' } }), more }));
    await type('q'); await submit();
    await click('search-filter-songs');
    expect(document.querySelectorAll('.result-row')).toHaveLength(2);
    await click('search-more');
    expect(document.querySelectorAll('.result-row')).toHaveLength(3);
    expect(byFocus('search-more')).toBeNull();            // the last page had no continuation
  });

  describe('laid out like the phone', () => {
    const phoneLike = () => vi.fn(async () => ({
      filter: 'all' as const, skipped: 0, continuation: undefined,
      sections: [
        section('top', [song('t1', { title: 'Prettiest Thing', artists: [{ id: 'UCa', name: 'LANY' }], durationMs: 272_000 })], { topResult: true, title: 'Top result' }),
        section('rows.track', [song('s2', { title: 'dna', artists: [{ id: 'UCa', name: 'LANY' }], durationMs: 0 })], { contentKind: 'track', layout: 'list' }),
        section('rows.album', [{ ...album('al1'), subtitle: 'Album • LANY • 2026' }], { contentKind: 'album', layout: 'list' }),
        section('rows.artist', [{ kind: 'artist' as const, id: 'ar1', browseId: 'UCa', title: 'LANY', subtitle: 'Artist • 7.62M monthly audience' }], { contentKind: 'artist', layout: 'list' }),
        section('rows.playlist', [{ ...playlist('pl1'), subtitle: 'Playlist • Giyana Yura • 14 views' }], { contentKind: 'playlist', layout: 'list' }),
      ],
      items: [],
    }));

    it('shows a top-result card with the kind, who it is by and its length, then one titled list per kind', async () => {
      await mount(fakeGateway({ search: phoneLike() as never }));
      await type('prettiest');
      await submit();
      const card = document.querySelector('.top-card')!;
      expect(card.querySelector('.top-card-title')!.textContent).toBe('Prettiest Thing');
      expect(card.querySelector('.top-card-detail')!.textContent).toBe('Lagu  •  oleh LANY  •  4:32');
      expect(card.querySelector('.top-card-play')).not.toBeNull();
      expect([...document.querySelectorAll('.result-section h2')].map((h) => h.textContent)).toEqual(['Hasil teratas', 'Lagu', 'Album', 'Artis', 'Playlist']);
      const subtitles = [...document.querySelectorAll('.result-row .result-artist')].map((el) => el.textContent);
      expect(subtitles).toEqual(['LANY', 'Album  •  LANY', 'Artis', 'Playlist  •  Giyana Yura']);
      expect(document.querySelector('.top-card-title')!.closest('.result-section')!.classList.contains('has-rule')).toBe(false);
      expect(document.querySelectorAll('.result-section.has-rule')).toHaveLength(4);
      await act(() => { (card as HTMLElement).click(); });
      await settle();
      expect(currentTrack(api().store.root.queue)?.id).toBe('t1');
    });

    it('the field has a clear button and, in results, a back arrow; the filter pills show the chosen one', async () => {
      await mount(fakeGateway({ search: phoneLike() as never }));
      expect(byFocus('search-clear')).toBeNull();
      expect(byFocus('search-back-arrow')).toBeNull();
      await type('prettiest');
      expect(byFocus('search-clear')).not.toBeNull();
      await submit();
      expect(document.querySelector('.search-chip.is-on')!.textContent).toBe('Semua');
      expect(byFocus('search-back-arrow')).not.toBeNull();
      await click('search-back-arrow');
      expect(route()).toEqual({ name: 'search' });
      await click('search-clear');
      expect((byFocus('search-query') as HTMLInputElement).value).toBe('');
    });

    it('every row has a menu button that opens the song or entity actions', async () => {
      await mount(fakeGateway({ search: phoneLike() as never }));
      await type('prettiest');
      await submit();
      await click('search-r-4-menu');
      expect(document.querySelector('.overlay-layer.is-top')).not.toBeNull();
      expect(document.querySelector('.overlay-layer.is-top')!.textContent).toMatch(/Putar|Antrean|Playlist/i);
    });

    it('history appears only while focus is in the field or the history, and stays when focus moves down into it', async () => {
      await mount(fakeGateway({ page: vi.fn(async () => ({ type: 'page' as const, skipped: 0, sections: [section('m', [tile('Santai')])] })) as never }), async ({ repo }) => { await repo.rememberSearch('hujan'); });
      expect(text()).not.toContain('Riwayat pencarian');
      await act(() => { byFocus('search-query')!.focus(); });
      expect(text()).toContain('Riwayat pencarian');
      await act(() => { (document.querySelector('.history-row') as HTMLElement).focus(); });
      expect(text()).toContain('Riwayat pencarian');
      await act(() => { (document.querySelector('.genre-tile') as HTMLElement).focus(); });
      expect(text()).not.toContain('Riwayat pencarian');
    });

    it('the songs whose title is the query come first as exact matches, and show only once', async () => {
      const search = vi.fn(async () => ({
        filter: 'all' as const, skipped: 0, items: [],
        sections: [
          section('top', [song('t1', { title: 'Lain Sama Sekali' })], { topResult: true }),
          section('rows.track', [song('s1', { title: 'Dna' }), song('s2', { title: 'Prettiest Thing I’ve Ever Seen' }), song('s3', { title: 'Prettiest Thing Ive Ever Seen (Live)' })], { contentKind: 'track', layout: 'list' }),
        ],
      }));
      await mount(fakeGateway({ search: search as never }));
      await type('prettiest thing ive ever seen');
      await submit();
      expect([...document.querySelectorAll('.result-section h2')].map((h) => h.textContent)).toEqual(['Hasil teratas', 'Cocok persis', 'Lagu']);
      const lists = [...document.querySelectorAll('.result-section')].map((sec) => [...sec.querySelectorAll('.result-title')].map((el) => el.textContent));
      expect(lists[1]).toEqual(['Prettiest Thing I’ve Ever Seen']);
      expect(lists[2]).toEqual(['Dna', 'Prettiest Thing Ive Ever Seen (Live)']);
    });

    it('mood tiles ask for their covers once and show the first two tilted at the right', async () => {
      const page = { type: 'page' as const, title: 'Moods', skipped: 0, sections: [section('m', [tile('Santai'), tile('Fokus')], { layout: 'grid' })] };
      const behind = { type: 'page' as const, skipped: 0, sections: [section('x', [{ ...song('c1'), artworkUrl: 'https://img/1.jpg' }, { ...song('c2'), artworkUrl: 'https://img/1.jpg' }, { ...song('c3'), artworkUrl: 'https://img/2.jpg' }])] };
      const browse = vi.fn(async () => behind);
      await mount(fakeGateway({ page: vi.fn(async () => page) as never, browse: browse as never }));
      await settle(20);
      expect(browse).toHaveBeenCalledTimes(2);                                   // once per tile, never again
      const covers = [...document.querySelector('.genre-tile')!.querySelectorAll('img.tile-cover')].map((img) => img.getAttribute('src'));
      expect(covers).toEqual(['https://img/2.jpg', 'https://img/1.jpg']);        // back cover first in the DOM, then the front one
      expect(document.querySelector('.genre-tile-title')!.textContent).toBe('Santai');
    });

    it('mood tiles get a tinted gradient from their stripe colour, as on the phone', async () => {
      const page = { type: 'page' as const, title: 'Moods', skipped: 0, sections: [section('m', [{ kind: 'link' as const, id: 'g1', browseId: 'FEg', title: 'Santai', color: '#ff0000' }], { layout: 'grid' })] };
      await mount(fakeGateway({ page: vi.fn(async () => page) as never }));
      const tile = document.querySelector<HTMLElement>('.genre-tile')!;
      expect(tile.getAttribute('style')).toBe('background: linear-gradient(135deg, rgb(127, 50, 51), rgb(50, 27, 29));');   // red lifted toward grey, laid over the tile colour at 55% and 16%
    });
  });
});
