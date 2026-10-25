// @vitest-environment jsdom
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContextValue } from '../app/AppContext';
import type { PlayerPort } from '../app/engine';
import { openServices, type Services } from '../app/services';
import App from '../app/Shell';
import type { CatalogGateway } from '../catalog/gateway';
import { CACHE_KEY } from '../features/home/feed';
import { album, fakeGateway, NOW, play, playlist, section, song, track, video } from '../features/home/testkit';
import { createMemoryDb } from '../library/db';
import { currentIndex } from '../playback/queueModel';
import type { PlaybackSnapshot, Track } from '../model';

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

async function mount(gateway: CatalogGateway, options: { onboarded?: boolean; seed?: (s: Services) => Promise<void> } = {}) {
  const opened = await openServices({ db: createMemoryDb(), storage: { getItem: () => null } });
  if (!opened.ok) throw opened.error;
  services = opened.services;
  await services.prefs.set('ui.language', 'id');
  if (options.onboarded !== false) await services.prefs.set('onboarding.done', true);
  await options.seed?.(services);
  player = new FakePlayer();
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(() => { render(h(App, { services, catalog: gateway, now: () => NOW, playerFactory: () => player, onReady: (getter) => { api = getter; } }), host); });
  await settle();
}
const settle = async () => { for (let i = 0; i < 12; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const byFocus = (id: string) => document.querySelector<HTMLElement>(`[data-focus-id="${id}"]`);
const click = async (id: string) => { await act(() => { byFocus(id)!.click(); }); await settle(); };
const text = () => document.querySelector('.app-stage')!.textContent ?? '';
const rowTitles = () => Array.from(document.querySelectorAll('.home-row-head h2')).map((el) => el.textContent);

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.closest('[hidden]') ? [] : [{}]) as unknown as DOMRectList;
  });
});
afterEach(() => { render(null, host); host.remove(); vi.restoreAllMocks(); });

const feedHome = (sections = [section('quick', [song('q1'), song('q2')], { title: 'Pilihan cepat YT' })]) => vi.fn(async () => ({ chips: [], sections, skipped: 0 }));

describe('Home: first run (onboarding, as on the phone)', () => {
  const artistPage = (names: string[]) => ({ type: 'search', filter: 'artists', skipped: 0, sections: [], items: names.map((n, i) => ({ kind: 'artist' as const, id: `UC${i}`, browseId: `UC${i}`, title: n })) });
  const stepText = () => document.querySelector('.onb-root')!.textContent ?? '';
  const type = async (value: string) => { const input = byFocus('onb-primary') as HTMLInputElement; await act(() => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }); };

  it('owns the whole screen: no navbar and no mini player while it runs, both back afterwards', async () => {
    await mount(fakeGateway(), { onboarded: false });
    expect(document.querySelector('.onb-root')).toBeTruthy();
    expect(document.querySelector('.primary-nav')).toBeNull();
    expect(document.querySelector('.mini-player')).toBeNull();
    expect(document.querySelector('.app-stage')).toBeNull();
    await act(() => { services.prefs.set('onboarding.done', true); });
    await settle();
    expect(document.querySelector('.onb-root')).toBeNull();
    expect(document.querySelector('.primary-nav')).toBeTruthy();
  });

  it('follows the phone: welcome, importing music, profile, hello, build your home, done', async () => {
    const search = vi.fn(async (_text: string, filter?: string) => filter === 'artists' ? artistPage(['Artist 1', 'Artist 2', 'Artist 3', 'Artist 4', 'Artist 5', 'Artist 6']) : { type: 'search', filter: 'songs', skipped: 0, sections: [], items: [] });
    await mount({ ...fakeGateway({ home: feedHome() }), search } as never, { onboarded: false });
    expect(stepText()).toContain('Selamat datang di');
    await click('onb-primary');                                     // Next
    await new Promise((resolve) => setTimeout(resolve, 450)); await settle();
    expect(stepText()).toContain('Impor musik');
    await click('onb-skip');                                        // Skip: straight to the profile
    expect(stepText()).toContain('Ayo buat profilmu');
    expect((byFocus('onb-next') as HTMLButtonElement).disabled).toBe(true);   // a name is needed, as on the phone
    await type('Rigel');
    expect(document.querySelector('.idc-name')!.textContent).toBe('Rigel');
    await click('onb-next');
    expect(document.querySelector('.onb-moment')).toBeTruthy();     // Hello moves on by itself
    await new Promise((resolve) => setTimeout(resolve, 3100)); await settle();
    expect(stepText()).toContain('Ayo bangun berandamu');
    expect(stepText()).toContain('pilih 3 artis dulu');
    await settle();
    await click('onb-artist-0');
    expect(stepText()).toContain('2 lagi');
    await click('onb-artist-1');
    expect(stepText()).toContain('satu artis lagi');
    expect((byFocus('onb-next') as HTMLButtonElement).disabled).toBe(true);
    await click('onb-artist-2');
    expect((byFocus('onb-next') as HTMLButtonElement).disabled).toBe(false);
    await click('onb-next');
    expect(document.querySelector('.onb-done')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 3100)); await settle();
    expect(services.prefs.get('profile.name', '')).toBe('Rigel');
    expect(String(services.prefs.get('profile.cardNumber', ''))).toMatch(/^\d{11}$/);
    expect(services.prefs.get('onboarding.done', false)).toBe(true);
    expect((await services.repo.listSavedEntities('artist')).map((entity) => entity.ref.id)).toEqual(['UC2', 'UC1', 'UC0']);
  }, 20000);

  it('Back on the remote steps back through the pages, and the page asks for what the phone asks for', async () => {
    await mount(fakeGateway(), { onboarded: false });
    await click('onb-primary');
    await new Promise((resolve) => setTimeout(resolve, 450)); await settle();
    await click('onb-primary');                                     // Yes!
    expect(stepText()).toContain('mau yang mana');
    expect(stepText()).toContain('Dari HP');                        // the phone transfer is what this TV can import
    await act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(stepText()).toContain('Impor musik');
  });
});

describe('Home: with a library', () => {
  const seed = async ({ repo }: Services) => {
    for (const id of ['a', 'b', 'c']) await play(repo, track(id), 1);
    await repo.setLiked(track('a'), true);
  };

  it('paints local rows without the network, continues the last song, and plays a card as a queue', async () => {
    await mount(fakeGateway(), { seed });
    expect(rowTitles()).toEqual(expect.arrayContaining(['Pilihan cepat', 'Riwayat']));
    expect(document.querySelector('.hero-card.kind-continue')?.textContent).toContain('Lanjutkan');
    const quick = document.querySelector('.row-quick')!;
    const cards = Array.from(quick.querySelectorAll<HTMLElement>('.home-card'));
    await act(() => { cards[1].click(); });
    expect(player.loads).toHaveLength(1);
    const queue = api().store.root.queue;
    expect(queue.entries.length).toBe(cards.length);
    expect(`${player.loads[0].title}, ${player.loads[0].artist}`).toBe(cards[1].getAttribute('aria-label'));
    expect(currentIndex(api().store.root.queue)).toBe(1);
  });

  it('shows the last good feed with a note when the network fails', async () => {
    await mount(fakeGateway(), {
      seed: async ({ repo }) => {
        await repo.setMeta(CACHE_KEY, {
          v: 1, savedAt: NOW - 1000, chips: [], categories: [],
          feed: [{ id: 'feed:home:cached', kind: 'feed', title: 'Tersimpan', origin: 'online', items: [{ key: 'track:z', kind: 'track', id: 'z', title: 'Lagu Z', track: track('z') }] }],
        });
      },
    });
    expect(rowTitles()).toContain('Tersimpan');
    expect(text()).toContain('Menampilkan data terakhir');
    expect(byFocus('home-retry')).toBeTruthy();
  });

  it('opens albums, playlists and artists through their detail routes', async () => {
    const sections = [section('mix', [album('al1'), playlist('PL1'), { kind: 'artist' as const, id: 'UCx', browseId: 'UCx', title: 'Xena' }, song('s1')], { title: 'Campuran' })];
    await mount(fakeGateway({ home: feedHome(sections) }));
    const cards = Array.from(document.querySelectorAll<HTMLElement>('.row-feed .home-card'));
    await act(() => { cards[0].click(); });
    const stack = api().store.nav.stacks.home;
    expect(stack[stack.length - 1].route).toEqual({ name: 'album', id: 'MPREal1' });
  });

  it('renders rows progressively and adds more when the end of the list comes near', async () => {
    const seen: Array<() => void> = [];
    vi.stubGlobal('IntersectionObserver', class { constructor(private cb: (e: Array<{ isIntersecting: boolean }>) => void) {} observe() { seen.push(() => this.cb([{ isIntersecting: true }])); } disconnect() {} });
    const sections = Array.from({ length: 9 }, (_, i) => section(`s${i}`, [song(`${i}a`), song(`${i}b`)], { title: `Baris ${i}` }));
    await mount(fakeGateway({ home: feedHome(sections) }));
    const initial = document.querySelectorAll('.home-row').length;
    expect(initial).toBeLessThan(9 + 5);
    expect(byFocus('home-show-more')).toBeNull();
    expect(document.body.textContent).not.toContain('Muat');
    await act(() => { seen.forEach((fire) => fire()); });
    expect(document.querySelectorAll('.home-row').length).toBeGreaterThan(initial);
    vi.unstubAllGlobals();
  });

  it('chips filter the feed and "Semua" returns', async () => {
    const home = vi.fn(async (o?: { params?: string }) => o?.params
      ? { chips: [], sections: [section('chill', [song('c1'), song('c2')], { title: 'Santai' })], skipped: 0 }
      : { chips: [{ title: 'Santai', browseId: 'FEmusic_home', params: 'chill' }], sections: [section('quick', [song('q1')], { title: 'Biasa' })], skipped: 0 });
    await mount(fakeGateway({ home }));
    expect(rowTitles()).toContain('Biasa');
    await click('home-chip-0');
    expect(rowTitles()).toEqual(['Santai']);
    expect(byFocus('home-chip-0')!.getAttribute('aria-pressed')).toBe('true');
    await click('home-chip-all');
    expect(rowTitles()).toContain('Biasa');
  });

  it('"Lihat semua" opens the full shelf and loads the next page', async () => {
    const sections = [section('rel', [album('r1')], { title: 'Rilis', more: { browseId: 'FEmusic_new_releases', params: 'p' } })];
    const page = vi.fn(async (browseId: string) => browseId === 'FEmusic_new_releases'
      ? { type: 'page', skipped: 0, sections: [section('all', [album('r1'), album('r2')])], continuation: { token: 't' } }
      : { type: 'page', skipped: 0, sections: [] });
    const more = vi.fn(async () => ({ items: [album('r3')], sections: [], skipped: 0 }));
    await mount(fakeGateway({ home: feedHome(sections), page, more }));
    await click('home-more-0');
    expect(document.querySelector('.section-view h1')!.textContent).toBe('Rilis');
    expect(document.querySelectorAll('.card-grid .home-card')).toHaveLength(2);
    await click('section-more');
    expect(document.querySelectorAll('.card-grid .home-card')).toHaveLength(3);
    expect(byFocus('section-more')).toBeNull();
  });

  it('video cards from the feed play as songs marked as videos', async () => {
    const sections = [section('vids', [video('v1'), video('v2')], { title: 'Music videos' })];
    await mount(fakeGateway({ home: feedHome(sections) }));
    const card = document.querySelector<HTMLElement>('.row-videos .home-card')!;
    await act(() => { card.click(); });
    expect(player.loads[0]).toMatchObject({ id: 'v1', isVideo: true });
  });
});
