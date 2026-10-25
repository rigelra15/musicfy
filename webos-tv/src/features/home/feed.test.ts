import { describe, expect, it, vi } from 'vitest';
import { CatalogRequestError } from '../../catalog/gateway';
import { CACHE_KEY, HomeFeed, PREF_HIDE_EXPLICIT, refreshAction } from './feed';
import { loadLocalRows } from './local';
import { NO_FILTERS } from './model';
import { album, DAY, fakeGateway, memoryServices, NOW, play, playlist, section, seededRng, song, track, video } from './testkit';

const homePage = (extra = {}) => ({
  chips: [{ title: 'Santai', browseId: 'FEmusic_home', params: 'chill' }],
  sections: [
    section('quick', [song('q1'), song('q2'), song('q3', { isExplicit: true })], { title: 'Quick picks' }),
    section('vid', [video('v1'), video('v2')], { title: 'Music videos' }),
    section('trend', [song('t1')], { title: 'Trending community' }),
  ],
  skipped: 0, continuation: { token: 'next' }, ...extra,
});

async function build(gatewayOverrides = {}) {
  const services = await memoryServices();
  const gateway = fakeGateway(gatewayOverrides);
  const feed = new HomeFeed({ ...services, gateway, now: () => NOW, rng: seededRng(9) });
  return { ...services, gateway, feed };
}

describe('refreshAction', () => {
  it('follows the Android policy', () => {
    const base = { now: NOW, skips: 0, plays: 0 };
    expect(refreshAction({ ...base, lastLoadAt: undefined })).toBe('all');
    expect(refreshAction({ ...base, lastLoadAt: NOW - 30_000, skips: 5 })).toBe('none');
    expect(refreshAction({ ...base, lastLoadAt: NOW - 10 * 60_000 })).toBe('none');
    expect(refreshAction({ ...base, lastLoadAt: NOW - 10 * 60_000, skips: 2 })).toBe('listening');
    expect(refreshAction({ ...base, lastLoadAt: NOW - 10 * 60_000, plays: 4 })).toBe('listening');
    expect(refreshAction({ ...base, lastLoadAt: NOW - 31 * 60_000 })).toBe('all');
  });
});

describe('local rows', () => {
  it('builds recent, quick, most played, history, forgotten and playlists from the library only', async () => {
    const { repo } = await memoryServices();
    for (const id of ['a', 'b', 'c']) await play(repo, track(id), 2);
    for (let i = 0; i < 3; i += 1) await play(repo, track('old'), 60 + i, 200_000);
    await play(repo, track('old'), 40, 100);
    await repo.setLiked(track('a'), true);
    const pl = await repo.createPlaylist('Gym');
    await repo.addToPlaylist(pl.id, [track('a')]);
    const rows = await loadLocalRows(repo, { now: NOW, filters: NO_FILTERS, likedPlayedAt: NOW - DAY });
    expect(rows.hasHistory).toBe(true);
    expect(rows.recent!.items[0].kind).toBe('liked');
    expect(rows.recent!.items.map((i) => i.id)).toEqual(expect.arrayContaining(['liked', 'a', 'b', 'c']));
    expect(rows.quick!.items.map((i) => i.id)).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    expect(rows.quick!.items.map((i) => i.id)).not.toContain('old');
    expect(rows.mostPlayed!.items[0].id).toBe('old');
    expect(rows.forgotten!.items.map((i) => i.id)).toEqual(['old']);
    expect(rows.localPlaylists!.items[0]).toMatchObject({ kind: 'localPlaylist', title: 'Gym', count: 1 });
    expect(rows.keepListening!.items.some((i) => i.kind === 'localPlaylist')).toBe(true);
  });
  it('is empty without history, with no invented rows', async () => {
    const { repo } = await memoryServices();
    const rows = await loadLocalRows(repo, { now: NOW, filters: NO_FILTERS });
    expect(rows).toMatchObject({ hasHistory: false, likedCount: 0 });
    expect(rows.recent ?? rows.quick ?? rows.history ?? rows.forgotten ?? rows.localPlaylists).toBeUndefined();
  });
  it('hides explicit songs and video songs when the filters say so', async () => {
    const { repo } = await memoryServices();
    await play(repo, track('e', { explicit: true }), 1);
    await play(repo, track('v', { isVideo: true }), 1);
    await play(repo, track('ok'), 1);
    const rows = await loadLocalRows(repo, { now: NOW, filters: { hideExplicit: true, hideVideoSongs: true } });
    expect(rows.history!.items.map((i) => i.id)).toEqual(['ok']);
  });
});

describe('HomeFeed', () => {
  it('cold start without history: local phase is ready, the feed arrives, nothing is invented', async () => {
    const { feed } = await build({
      home: vi.fn(async () => homePage()),
      page: vi.fn(async (id: string) => id === 'FEmusic_charts'
        ? { type: 'page', sections: [section('c', [song('c1'), song('c2')], { title: 'Top songs' })], skipped: 0 }
        : { type: 'page', sections: [section('n', [album('n1'), album('n2')])], skipped: 0 }),
    });
    await feed.start();
    const snap = feed.getSnapshot();
    expect(snap.localReady).toBe(true);
    expect(snap.hasHistory).toBe(false);
    expect(snap.online).toBe('ready');
    const ids = snap.rows.map((r) => r.id);
    expect(ids.some((id) => id.startsWith('feed:home:quick'))).toBe(true);
    expect(ids).toContain('charts');
    expect(ids).toContain('newReleases');
    expect(ids.some((id) => id.startsWith('feed:') && id.includes('trend'))).toBe(false);      // community/trending shelves are ours, not the feed's
    expect(ids.some((id) => id.startsWith('feed:') && id.includes('vid'))).toBe(false);         // the video shelf becomes the videos row
    expect(snap.rows.find((r) => r.kind === 'videos')?.items.map((i) => i.id)).toEqual(['v1', 'v2']);
    expect(snap.hero).toEqual([]);
    expect(snap.chips).toHaveLength(1);
    expect(snap.canLoadMore).toBe(true);
  });

  it('shows the library rows when fully offline and says the network failed', async () => {
    const { feed, repo } = await build();
    await play(repo, track('a'), 1);
    await feed.start();
    const snap = feed.getSnapshot();
    expect(snap.online).toBe('failed');
    expect(snap.errorKind).toBe('network');
    expect(snap.rows.map((r) => r.kind)).toEqual(expect.arrayContaining(['recent', 'quick', 'history']));
    expect(snap.hero[0]).toMatchObject({ kind: 'continue' });
    expect(snap.hero[0].item.id).toBe('a');
  });

  it('keeps the last good feed as a cache and shows it when the next load fails', async () => {
    const first = await build({ home: vi.fn(async () => homePage()) });
    await first.feed.start();
    const cache = await first.repo.getMeta(CACHE_KEY);
    expect(cache).toBeTruthy();
    const second = new HomeFeed({ repo: first.repo, prefs: first.prefs, signals: first.signals, gateway: fakeGateway(), now: () => NOW + 1000, rng: seededRng(2) });
    await second.start();
    const snap = second.getSnapshot();
    expect(snap.online).toBe('failed');
    expect(snap.fromCache).toBe(true);
    expect(snap.rows.some((r) => r.id.startsWith('feed:home:quick'))).toBe(true);
    expect(snap.chips).toHaveLength(1);
  });

  it('a failing source does not cancel the others and the error is reported', async () => {
    const { feed } = await build({
      home: vi.fn(async () => { throw new CatalogRequestError('rate-limited', 'slow down'); }),
      page: vi.fn(async (id: string) => {
        if (id === 'FEmusic_charts') return { type: 'page', sections: [section('c', [song('c1'), song('c2')], { title: 'Top' })], skipped: 0 };
        throw new CatalogRequestError('timeout', 'late');
      }),
    });
    await feed.start();
    const snap = feed.getSnapshot();
    expect(snap.online).toBe('partial');
    expect(snap.errorKind).toBe('rate-limited');
    expect(snap.rows.map((r) => r.id)).toContain('charts');
  });

  it('applies the hide-explicit preference to online cards', async () => {
    const { feed, prefs } = await build({ home: vi.fn(async () => homePage()) });
    await prefs.set(PREF_HIDE_EXPLICIT, true);
    await feed.start();
    const quick = feed.getSnapshot().rows.find((r) => r.id.startsWith('feed:home:quick'))!;
    expect(quick.items.map((i) => i.id)).toEqual(['q1', 'q2']);
  });

  it('with history it adds daily discover cards, a community row and artist videos', async () => {
    const related = { sections: [section('r', [song('n1'), playlist('PLok'), playlist('PLok2')])], skipped: 0 };
    const { feed, repo } = await build({
      home: vi.fn(async () => homePage({ sections: [], continuation: undefined })),
      next: vi.fn(async () => ({ items: [], relatedBrowseId: 'MPTR' })),
      related: vi.fn(async () => related),
      artist: vi.fn(async () => ({
        type: 'artist', header: { radioPlaylistId: 'RDx' }, songs: [song('top')], skipped: 0,
        sections: [section('vids', [video('av1', 'UCa - Hit (Official Video)'), video('av2'), video('av3')], { title: 'Videos' })],
      })),
      playlist: vi.fn(async () => ({ type: 'playlist', header: {}, tracks: [song('pt')], related: [], skipped: 0 })),
      page: vi.fn(async () => { throw new CatalogRequestError('network', 'x'); }),
    });
    for (const id of ['a', 'b', 'c']) await play(repo, track(id), 1);
    await feed.start();
    const snap = feed.getSnapshot();
    expect(snap.hero.some((card) => card.kind === 'discover' && card.item.id === 'n1')).toBe(true);
    expect(snap.rows.find((r) => r.kind === 'community')?.items.map((i) => i.id)).toEqual(expect.arrayContaining(['PLok']));
    const videos = snap.rows.find((r) => r.kind === 'videos');
    expect(videos?.items.length).toBeGreaterThanOrEqual(2);
    expect(snap.rows.find((r) => r.kind === 'artists')).toBeTruthy();
  });

  it('first run with chosen artists shows starter songs', async () => {
    const { feed, repo } = await build({
      home: vi.fn(async () => homePage({ sections: [] })),
      artist: vi.fn(async () => ({ type: 'artist', header: {}, songs: [song('hit1'), song('hit2')], sections: [], skipped: 0 })),
    });
    await repo.saveEntity({ ref: { provider: 'youtube', kind: 'artist', id: 'UCpicked' }, title: 'Picked' });
    await feed.start();
    const snap = feed.getSnapshot();
    expect(snap.hasHistory).toBe(false);
    expect(snap.hero.map((card) => card.kind)).toEqual(['starter']);
    expect(snap.hero[0].reason).toBe('Picked');
  });

  it('a chip replaces the feed rows and clearing it brings Home back; loadMore appends once', async () => {
    const home = vi.fn(async (o?: { params?: string }) => o?.params
      ? { chips: [], sections: [section('chill', [song('c1'), song('c2')], { title: 'Chill' })], skipped: 0 }
      : homePage());
    const more = vi.fn(async () => ({ items: [], sections: [section('extra', [song('x1')], { title: 'Extra' })], skipped: 0 }));
    const { feed } = await build({ home, more });
    await feed.start();
    await feed.selectChip(feed.getSnapshot().chips[0]);
    expect(feed.getSnapshot().rows.map((r) => r.title)).toEqual(['Chill']);
    await feed.selectChip(undefined);
    expect(feed.getSnapshot().rows.some((r) => r.id.startsWith('feed:home:quick'))).toBe(true);
    await feed.loadMore();
    await feed.loadMore();
    expect(more).toHaveBeenCalledTimes(1);
    expect(feed.getSnapshot().rows.some((r) => r.title === 'Extra')).toBe(true);
    expect(feed.getSnapshot().canLoadMore).toBe(false);
  });

  it('refreshIfNeeded reloads after skips but not within a minute', async () => {
    const home = vi.fn(async () => homePage());
    let now = NOW;
    const services = await memoryServices();
    const feed = new HomeFeed({ ...services, gateway: fakeGateway({ home }), now: () => now, rng: seededRng(1) });
    await feed.start();
    const calls = home.mock.calls.length;
    now += 30_000;
    expect(await feed.refreshIfNeeded()).toBe('none');
    now += 10 * 60_000;
    services.signals.skipsSinceRefresh = 2;
    expect(await feed.refreshIfNeeded()).toBe('listening');
    expect(home.mock.calls.length).toBe(calls);        // listening refresh leaves the YouTube feed alone
    now += 31 * 60_000;
    expect(await feed.refreshIfNeeded()).toBe('all');
    expect(home.mock.calls.length).toBe(calls + 1);
  });

  it('a stale load never overwrites a newer one', async () => {
    let release: (() => void) | undefined;
    const slow = new Promise<void>((resolve) => { release = resolve; });
    const home = vi.fn()
      .mockImplementationOnce(async () => { await slow; return homePage({ sections: [section('old', [song('o1')], { title: 'Old' })] }); })
      .mockImplementation(async () => homePage({ sections: [section('new', [song('n1')], { title: 'New' })] }));
    const { feed } = await build({ home });
    const first = feed.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await feed.refresh();
    release!();
    await first;
    expect(feed.getSnapshot().rows.map((r) => r.title)).toEqual(['New']);
  });

  it('shows no account rows or demo data: account content only exists after an import', async () => {
    const { feed, repo } = await build({ home: vi.fn(async () => homePage()) });
    for (const id of ['a', 'b', 'c']) await play(repo, track(id), 1);
    await feed.start();
    const kinds = new Set(feed.getSnapshot().rows.map((row) => row.kind));
    const allowed = new Set(['recent', 'quick', 'mostPlayed', 'history', 'forgotten', 'keepListening', 'localPlaylists', 'feed', 'newReleases', 'charts', 'community', 'live', 'videos', 'because', 'moreLike', 'newGenre', 'newFromArtists', 'artists']);
    expect([...kinds].every((kind) => allowed.has(kind))).toBe(true);
    // every card traces back to the library, the YouTube feed or a recommendation call; none is made up
    const ids = new Set(feed.getSnapshot().rows.flatMap((row) => row.items.map((item) => item.id)));
    for (const id of ids) expect(['a', 'b', 'c', 'q1', 'q2', 'q3', 'v1', 'v2', 'UCa', 'UCb', 'UCc', 'liked'].includes(id) || id.startsWith('UC')).toBe(true);
  });
});
