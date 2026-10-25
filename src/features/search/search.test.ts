import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogRequestError } from '../../catalog/gateway';
import { PREF_HIDE_EXPLICIT } from '../home/feed';
import { album, fakeGateway, memoryServices, playlist, section, song, video } from '../home/testkit';
import { homeItemFromCatalog } from '../home/model';
import { preferSongAsTop, SearchSession, type ResultSection } from './session';
import { parseYouTubeUrl } from './url';

describe('parseYouTubeUrl', () => {
  it('reads videos and artists from the links people paste, and nothing else', () => {
    expect(parseYouTubeUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDx')).toEqual({ kind: 'video', id: 'dQw4w9WgXcQ' });
    expect(parseYouTubeUrl('youtu.be/dQw4w9WgXcQ?t=3')).toEqual({ kind: 'video', id: 'dQw4w9WgXcQ' });
    expect(parseYouTubeUrl('https://www.youtube.com/channel/UCabcdefghijk')).toEqual({ kind: 'artist', id: 'UCabcdefghijk' });
    expect(parseYouTubeUrl('https://music.youtube.com/browse/UCabcdefghijk')).toEqual({ kind: 'artist', id: 'UCabcdefghijk' });
    expect(parseYouTubeUrl('https://example.com/watch?v=dQw4w9WgXcQ')).toBeUndefined();
    expect(parseYouTubeUrl('dQw4w9WgXcQ')).toBeUndefined();
    expect(parseYouTubeUrl('two words')).toBeUndefined();
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=short')).toBeUndefined();
    expect(parseYouTubeUrl('')).toBeUndefined();
  });
});

const searchPage = (over: Record<string, unknown> = {}) => ({ filter: 'all', sections: [], items: [], skipped: 0, ...over });
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

async function build(over: Record<string, unknown> = {}) {
  const services = await memoryServices();
  const gateway = fakeGateway(over);
  const session = new SearchSession({ gateway, repo: services.repo, prefs: services.prefs, debounceMs: 250 });
  return { ...services, gateway, session };
}

describe('SearchSession suggestions', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('debounces typing into one request for the last text, and clearing cancels', async () => {
    const suggest = vi.fn(async (_query: string) => ({ queries: ['hujan deras', 'hujan'], items: [song('r1')] }));
    const { session } = await build({ suggest });
    session.setDraft('h'); session.setDraft('hu'); session.setDraft('huj');
    await vi.advanceTimersByTimeAsync(249);
    expect(suggest).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest.mock.calls[0][0]).toBe('huj');
    expect(session.getSnapshot().suggest).toMatchObject({ status: 'ready', queries: ['hujan deras', 'hujan'] });
    session.setDraft('   ');
    expect(session.getSnapshot().suggest).toEqual({ status: 'idle', queries: [], items: [] });
    session.setDraft('x'); session.setDraft('');
    await vi.advanceTimersByTimeAsync(500);
    expect(suggest).toHaveBeenCalledTimes(1);
  });

  it('aborts the request a newer one replaces and ignores its late answer', async () => {
    const first = deferred<{ queries: string[]; items: never[] }>();
    const signals: AbortSignal[] = [];
    const suggest = vi.fn(async (query: string, signal: AbortSignal) => {
      signals.push(signal);
      return query === 'aa' ? first.promise : { queries: ['bb lagi'], items: [] };
    });
    const { session } = await build({ suggest });
    session.setDraft('aa');
    await vi.advanceTimersByTimeAsync(260);
    session.setDraft('bb');
    await vi.advanceTimersByTimeAsync(260);
    expect(signals[0].aborted).toBe(true);
    first.resolve({ queries: ['aa basi'], items: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getSnapshot().suggest.queries).toEqual(['bb lagi']);
  });

  it('hides suggestions already in history, applies content filters, and reports failure without blocking search', async () => {
    const { session, prefs, repo } = await build({
      suggest: vi.fn(async () => ({ queries: ['hujan', 'hujan deras'], items: [song('a'), song('b', { isExplicit: true })] })),
    });
    await repo.rememberSearch('hujan');
    await session.loadHistory();
    await prefs.set(PREF_HIDE_EXPLICIT, true);
    session.setDraft('huj');
    await vi.advanceTimersByTimeAsync(300);
    expect(session.getSnapshot().suggest.queries).toEqual(['hujan deras']);
    expect(session.getSnapshot().suggest.items.map((item) => item.id)).toEqual(['a']);
    const down = await build();
    down.session.setDraft('x');
    await vi.advanceTimersByTimeAsync(300);
    expect(down.session.getSnapshot().suggest.status).toBe('failed');
  });

  it('a pasted link shows what it points to and does not call suggest', async () => {
    const suggest = vi.fn();
    const next = vi.fn(async (_o: { videoId: string }) => ({ items: [song('dQw4w9WgXcQ', { title: 'Never' })], currentIndex: 0 }));
    const { session } = await build({ suggest, next });
    session.setDraft('https://youtu.be/dQw4w9WgXcQ');
    await vi.advanceTimersByTimeAsync(300);
    expect(suggest).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toEqual({ videoId: 'dQw4w9WgXcQ' });
    expect(session.getSnapshot().suggest.linkItem).toMatchObject({ id: 'dQw4w9WgXcQ', title: 'Never' });
    const artistLink = await build({ artist: vi.fn(async () => ({ type: 'artist', header: { title: 'Xena', artworkUrl: 'u' }, songs: [], sections: [], skipped: 0 })) });
    artistLink.session.setDraft('https://music.youtube.com/channel/UCabcdefghijk');
    await vi.advanceTimersByTimeAsync(300);
    expect(artistLink.session.getSnapshot().suggest.linkItem).toMatchObject({ kind: 'artist', browseId: 'UCabcdefghijk', title: 'Xena' });
  });

  it('keeps at most three matching history entries while typing, and can forget or clear', async () => {
    const { session, repo } = await build();
    for (const q of ['hujan a', 'hujan b', 'hujan c', 'hujan d', 'laut']) await repo.rememberSearch(q);
    await session.loadHistory();
    expect(session.matchingHistory('')).toHaveLength(5);
    expect(session.matchingHistory('HUJAN')).toHaveLength(3);
    expect(session.matchingHistory('laut')).toEqual(['laut']);
    await session.forgetHistory('laut');
    expect(session.getSnapshot().history).not.toContain('laut');
    await session.clearHistory();
    expect(session.getSnapshot().history).toEqual([]);
  });
});

describe('SearchSession results', () => {
  it('submitting while a suggestion request is in flight leaves no stuck loading state', async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<never>(() => undefined);
      const { session } = await build({ suggest: vi.fn(async () => never), search: vi.fn(async () => searchPage({ sections: [section('s', [song('x')])] })) });
      session.setDraft('hu');
      await vi.advanceTimersByTimeAsync(300);
      expect(session.getSnapshot().suggest.status).toBe('loading');
      await session.submit('hu');
      expect(session.getSnapshot().suggest.status).toBe('idle');
    } finally { vi.useRealTimers(); }
  });

  it('submit remembers the query and loads the All summary with a top result first', async () => {
    const search = vi.fn(async () => searchPage({
      sections: [
        section('top', [song('t1')], { title: 'Top result', topResult: true }),
        section('songs', [song('s1'), song('s2', { isExplicit: true })], { title: 'Songs' }),
        section('mix', [album('a1'), playlist('PL1'), video('v1')], { title: 'More' }),
      ],
    }));
    const { session, repo, prefs } = await build({ search });
    await prefs.set(PREF_HIDE_EXPLICIT, true);
    expect(await session.submit('  hujan  ')).toBe(true);
    const snap = session.getSnapshot();
    expect(snap.query).toBe('hujan');
    expect(snap.filter).toBe('all');
    expect(search).toHaveBeenCalledWith('hujan', 'all', expect.anything());
    expect(snap.bucket!.sections.map((s) => s.id)).toEqual(['top', 'songs', 'mix']);
    expect(snap.bucket!.sections[0].topResult).toBe(true);
    expect(snap.bucket!.sections[1].items.map((i) => i.id)).toEqual(['s1']);
    await vi.waitFor(async () => expect(await repo.listSearches()).toEqual(['hujan']));
    expect(await session.submit('   ')).toBe(false);
  });

  it('each filter loads once and is cached; switching back does not ask again', async () => {
    const search = vi.fn(async (_q: string, filter: string) => filter === 'all'
      ? searchPage({ sections: [section('s', [song('x')])] })
      : searchPage({ filter, items: [album('a1'), album('a2')] }));
    const { session } = await build({ search });
    await session.submit('laut');
    await session.setFilter('albums');
    expect(search).toHaveBeenLastCalledWith('laut', 'albums', expect.anything());
    expect(session.getSnapshot().bucket!.items.map((i) => i.id)).toEqual(['a1', 'a2']);
    await session.setFilter('all');
    await session.setFilter('albums');
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('loadMore appends the next page without duplicates and stops at the end', async () => {
    const more = vi.fn()
      .mockResolvedValueOnce({ items: [song('s2'), song('s3')], sections: [], continuation: { token: 'p3' }, skipped: 0 })
      .mockResolvedValueOnce({ items: [song('s3'), song('s4')], sections: [], skipped: 0 });
    const search = vi.fn(async () => searchPage({ filter: 'songs', items: [song('s1'), song('s2')], continuation: { token: 'p2' } }));
    const { session } = await build({ search, more });
    await session.submit('q');
    await session.setFilter('songs');
    await session.loadMore();
    expect(session.getSnapshot().bucket!.items.map((i) => i.id)).toEqual(['s1', 's2', 's3']);
    await session.loadMore();
    expect(session.getSnapshot().bucket!.items.map((i) => i.id)).toEqual(['s1', 's2', 's3', 's4']);
    expect(session.getSnapshot().bucket!.continuation).toBeUndefined();
    await session.loadMore();
    expect(more).toHaveBeenCalledTimes(2);
    expect(more.mock.calls[0][0]).toBe('search');
  });

  it('a failure is shown as failed with its kind and retry asks again', async () => {
    const search = vi.fn()
      .mockRejectedValueOnce(new CatalogRequestError('rate-limited', 'slow'))
      .mockResolvedValueOnce(searchPage({ sections: [section('s', [song('ok')])] }));
    const { session } = await build({ search });
    await session.submit('q');
    expect(session.getSnapshot().bucket).toMatchObject({ status: 'failed', errorKind: 'rate-limited' });
    await session.retry();
    expect(session.getSnapshot().bucket!.status).toBe('ready');
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('an empty answer is an empty result, not an error', async () => {
    const { session } = await build({ search: vi.fn(async () => searchPage({ filter: 'videos', items: [] })) });
    await session.submit('zzz');
    await session.setFilter('videos');
    expect(session.getSnapshot().bucket).toMatchObject({ status: 'ready', items: [] });
  });

  it('re-opening the same query keeps its filter and results; a new query starts at All and drops the old answers', async () => {
    const search = vi.fn(async (q: string, filter: string) => searchPage({ filter, items: [song(`${q}-${filter}`)], sections: filter === 'all' ? [section('s', [song(`${q}-all`)])] : [] }));
    const { session } = await build({ search });
    await session.submit('one');
    await session.setFilter('songs');
    await session.open('one');
    expect(session.getSnapshot().filter).toBe('songs');
    expect(search).toHaveBeenCalledTimes(2);
    await session.open('two');
    expect(session.getSnapshot().filter).toBe('all');
    expect(session.getSnapshot().bucket!.sections[0].items[0].id).toBe('two-all');
    session.closeResults();
    expect(session.getSnapshot().query).toBeUndefined();
  });

  it('a slow answer for an old query never replaces the new one', async () => {
    const slow = deferred<ReturnType<typeof searchPage>>();
    const search = vi.fn(async (q: string) => q === 'old' ? slow.promise : searchPage({ sections: [section('s', [song('new')])] }));
    const { session } = await build({ search });
    const pending = session.submit('old');
    await Promise.resolve();
    await session.submit('new');
    slow.resolve(searchPage({ sections: [section('s', [song('stale')])] }));
    await pending;
    expect(session.getSnapshot().query).toBe('new');
    expect(session.getSnapshot().bucket!.sections[0].items[0].id).toBe('new');
  });
});

describe('SearchSession mood and genres', () => {
  const tile = (title: string, color?: string) => ({ kind: 'link' as const, id: title, browseId: `FEg${title}`, params: 'p', title, color });
  it('builds groups from link tiles only, loads once, and retries after failure', async () => {
    const page = vi.fn()
      .mockRejectedValueOnce(new CatalogRequestError('network', 'x'))
      .mockResolvedValue({ type: 'page', skipped: 0, sections: [section('moods', [tile('Santai', '#123456'), tile('Fokus'), song('noise')], { title: 'Suasana' }), section('empty', [song('x')])] });
    const { session } = await build({ page });
    await session.loadGenres();
    expect(session.getSnapshot().genres.status).toBe('failed');
    await session.loadGenres(true);
    const { genres } = session.getSnapshot();
    expect(genres.status).toBe('ready');
    expect(genres.groups).toHaveLength(1);
    expect(genres.groups[0]).toMatchObject({ title: 'Suasana' });
    expect(genres.groups[0].tiles.map((t) => [t.title, t.color])).toEqual([['Santai', '#123456'], ['Fokus', undefined]]);
    await session.loadGenres();
    expect(page).toHaveBeenCalledTimes(2);
  });
});

describe('preferSongAsTop', () => {
  const same = { title: 'Prettiest Thing', artists: [{ name: 'LANY' }] };
  const items = (list: ReturnType<typeof song>[]) => list.map(homeItemFromCatalog);
  const build = (top: ReturnType<typeof video>, rest: ReturnType<typeof song>[]): ResultSection[] => [
    { id: 'top', topResult: true, items: items([top]) },
    { id: 'songs', contentKind: 'track', topResult: false, items: items(rest) },
  ];
  it('leads with the song when the top result is the video of the same song, and shows it only once', () => {
    const out = preferSongAsTop(build({ ...video('vid'), ...same }, [song('other'), { ...song('aud'), ...same }]));
    expect(out[0].items[0]).toMatchObject({ kind: 'track', id: 'aud' });
    expect(out[1].items.map((item) => item.id)).toEqual(['other']);
  });
  it('leaves everything alone when the top is already a song, or no song matches', () => {
    const topSong = build({ ...video('vid'), ...same, kind: 'track' }, [{ ...song('aud'), ...same }]);
    expect(preferSongAsTop(topSong)).toBe(topSong);
    const none = build({ ...video('vid'), ...same }, [song('other')]);
    expect(preferSongAsTop(none)).toBe(none);
  });
  it('drops a list that the move left empty', () => {
    const out = preferSongAsTop(build({ ...video('vid'), ...same }, [{ ...song('aud'), ...same }]));
    expect(out.map((section) => section.id)).toEqual(['top']);
  });
});
