import { describe, expect, it, vi } from 'vitest';
import { cleanTitle, feedShelfKind, interleave, videoShelves } from './artistVideos';
import { composeRows } from './compose';
import { isGenre } from './genres';
import { NO_FILTERS, type HomeRow } from './model';
import { weightedSample, type TasteProfile } from './profile';
import {
  arrangeCategories, becauseYouLike, communityPlaylists, dailyDiscover, mix, newGenres, pickSongs, type RecommendContext,
} from './recommend';
import { album, fakeGateway, playlist, section, seededRng, song, track, video } from './testkit';
import { homeItemFromCatalog } from './model';

const profile = (extra: Partial<TasteProfile> = {}): TasteProfile => ({
  heard: new Set(), avoidSongs: new Set(), avoidArtists: new Set(), songSeeds: [], topArtists: [], hasHistory: true, ...extra,
});
const context = (gateway = fakeGateway(), extra: Partial<RecommendContext> = {}): RecommendContext => ({
  gateway, profile: profile(), filters: NO_FILTERS, rng: seededRng(7), artistPage: async () => undefined, ...extra,
});
const row = (id: string, keys: string[]): HomeRow => ({
  id, kind: 'because', title: id, origin: 'online', items: keys.map((key) => homeItemFromCatalog(song(key))),
});

describe('pickSongs', () => {
  const songs = Array.from({ length: 30 }, (_, i) => song(`s${i}`));
  it('never offers skipped songs, skipped artists or explicit songs when hidden', () => {
    const picked = pickSongs(
      [...songs, song('x', { isExplicit: true }), song('y', { artists: [{ id: 'UCbad', name: 'Bad' }] })],
      profile({ avoidSongs: new Set(['s1']), avoidArtists: new Set(['bad']) }),
      { hideExplicit: true, hideVideoSongs: false },
      { limit: 40, perArtist: 5, rng: seededRng(3) },
    );
    const ids = picked.map((item) => item.id);
    expect(ids).not.toContain('s1');
    expect(ids).not.toContain('x');
    expect(ids).not.toContain('y');
  });
  it('keeps a few heard songs but mostly new ones, and ignores videos', () => {
    const heard = new Set(songs.slice(0, 20).map((s) => s.id));
    const picked = pickSongs([...songs, video('v1')], profile({ heard }), NO_FILTERS, { limit: 8, perArtist: 2, rng: seededRng(5) });
    expect(picked.length).toBe(8);
    expect(picked.filter((item) => heard.has(item.id)).length).toBeLessThanOrEqual(2);
    expect(picked.some((item) => item.kind === 'video')).toBe(false);
  });
  it('limits songs per artist', () => {
    const same = Array.from({ length: 6 }, (_, i) => song(`a${i}`, { artists: [{ id: 'UCone', name: 'One' }] }));
    expect(pickSongs(same, profile(), NO_FILTERS, { limit: 6, perArtist: 2, rng: seededRng(1) })).toHaveLength(2);
  });
});

describe('mix and arrangeCategories', () => {
  it('puts a playlist after every third song and the rest at the end', () => {
    expect(mix(['a', 'b', 'c', 'd', 'e', 'f', 'g'], ['P1', 'P2', 'P3'])).toEqual(['a', 'b', 'c', 'P1', 'd', 'e', 'f', 'P2', 'g', 'P3']);
  });
  it('drops rows under four cards and shows a song only in its first row', () => {
    const rows = arrangeCategories({
      because: [row('b1', ['1', '2', '3', '4', '5']), row('b2', ['1', '2', '6', '7', '8', '9'])],
      moreLike: [row('m1', ['10', '11'])],
    });
    expect(rows.map((r) => r.id)).toEqual(['b1', 'b2']);
    expect(rows[1].items.map((item) => item.id)).toEqual(['6', '7', '8', '9']);
  });
  it('orders one round of because/moreLike, then new releases, then new genres', () => {
    const k = (id: string) => row(id, [`${id}1`, `${id}2`, `${id}3`, `${id}4`]);
    const rows = arrangeCategories({ because: [k('b1'), k('b2')], moreLike: [k('m1')], newFromArtists: [k('n')], newGenre: [k('g')] });
    expect(rows.map((r) => r.id)).toEqual(['b1', 'm1', 'n', 'b2', 'g']);
  });
});

describe('profile helpers', () => {
  it('weightedSample favours stronger scores but does not always pick the same', () => {
    const candidates = [['a', 100], ['b', 1], ['c', 1]] as const;
    let a = 0;
    const rng = seededRng(11);
    for (let i = 0; i < 200; i += 1) if (weightedSample(candidates, 1, rng)[0] === 'a') a += 1;
    expect(a).toBeGreaterThan(150);
    expect(a).toBeLessThan(200);
  });
  it('recognises genre names', () => {
    expect(isGenre('Indie Rock')).toBe(true);
    expect(isGenre('Workout')).toBe(false);
  });
});

describe('recommendation rows', () => {
  const related = (items: ReturnType<typeof song>[]) => ({ sections: [section('r', items)], skipped: 0 });
  it('builds a "because you like" row from related songs and tolerates a failing seed', async () => {
    const next = vi.fn(async ({ videoId }: { videoId: string }) => {
      if (videoId === 'bad') throw new Error('boom');
      return { items: [], relatedBrowseId: 'MPTR' + videoId };
    });
    const gateway = fakeGateway({
      next,
      related: vi.fn(async () => related([...Array.from({ length: 8 }, (_, i) => song(`r${i}`)), playlist('PL1'), playlist('PL2')])),
    });
    const rows = await becauseYouLike(context(gateway), [track('good'), track('bad')]);
    expect(rows).toHaveLength(1);
    expect(rows[0].subtitle).toBe('Artist good');
    expect(rows[0].items.some((item) => item.kind === 'playlist')).toBe(true);
    expect(rows[0].items.every((item) => item.id !== 'good')).toBe(true);
  });
  it('daily discover gives one new song per artist', async () => {
    const gateway = fakeGateway({
      next: vi.fn(async () => ({ items: [], relatedBrowseId: 'MPTRx' })),
      related: vi.fn(async () => related([song('n1', { artists: [{ id: 'UCz', name: 'Z' }] }), song('n2', { artists: [{ id: 'UCz', name: 'Z' }] })])),
    });
    const cards = await dailyDiscover(context(gateway), [track('a'), track('b')]);
    expect(cards).toHaveLength(1);
    expect(cards[0].seed.title).toMatch(/Song [ab]/);
  });
  it('community playlists skip YouTube mixes and need at least one song', async () => {
    const gateway = fakeGateway({
      next: vi.fn(async () => ({ items: [], relatedBrowseId: 'MPTRx' })),
      related: vi.fn(async () => related([playlist('PLok'), playlist('RDmix'), playlist('OLAKalbum'), playlist('PLyt', 'Playlist • YouTube Music'), playlist('PLempty')])),
      playlist: vi.fn(async (id: string) => ({ type: 'playlist', header: {}, tracks: id === 'PLempty' ? [] : [song('t')], related: [], skipped: 0 })),
    });
    const result = await communityPlaylists(context(gateway), [], [track('a')]);
    expect(result?.items.map((item) => item.id)).toEqual(['PLok']);
  });
  it('new genre rows come from genre-looking tiles only', async () => {
    const tiles = ['Rock', 'Pop', 'Jazz', 'Workout'].map((title) => ({ kind: 'link' as const, id: title, browseId: `FEg${title}`, params: 'p', title }));
    const page = vi.fn(async (browseId: string) => browseId === 'FEmusic_moods_and_genres'
      ? { type: 'page', sections: [section('g', tiles)], skipped: 0 }
      : { type: 'page', sections: [section('songs', Array.from({ length: 9 }, (_, i) => song(`${browseId}${i}`)))], skipped: 0 });
    const rows = await newGenres(context(fakeGateway({ page })), 5);
    expect(rows.map((r) => r.title).sort()).toEqual(['Jazz', 'Pop', 'Rock']);
  });
});

describe('artist videos', () => {
  it('finds the live and music video shelves by content, not by title language', () => {
    const shelves = videoShelves([
      section('songs', [song('a')]),
      section('v', [video('v1'), video('v2', 'Artist - Song (Official Lyrics)'), video('v3')], { title: 'Video' }),
      section('l', [video('l1'), video('l2')], { title: 'Konser langsung' }),
    ]);
    expect(shelves.liveShows.map((v) => v.id)).toEqual(['l1', 'l2']);
    expect(shelves.musicVideos.map((v) => v.id)).toEqual(['v1', 'v3']);
  });
  it('classifies feed shelves and cleans titles', () => {
    expect(feedShelfKind('Live performances', [video('1'), video('2')])).toBe('live');
    expect(feedShelfKind('Music videos for you', [video('1'), video('2')])).toBe('musicVideos');
    expect(feedShelfKind('Mixed', [video('1'), song('2')])).toBeUndefined();
    expect(cleanTitle('Artist X - Great Song (Official Music Video)', 'Artist X')).toBe('Great Song');
    expect(cleanTitle('Artist X', 'Artist X')).toBe('Artist X');
  });
  it('interleaves so one artist cannot fill the row', () => {
    expect(interleave([[1, 2, 3], [10, 20], [100]], 5)).toEqual([1, 10, 100, 2, 20]);
  });
});

describe('composeRows', () => {
  const r = (id: string, kind: HomeRow['kind'] = 'feed'): HomeRow => row(id, ['1']) && { ...row(id, ['1']), kind };
  it('follows the Android order and deals categories between rows', () => {
    const local = { recent: r('recent', 'recent'), mostPlayed: r('mostPlayed', 'mostPlayed'), quick: r('quick', 'quick'), history: r('history', 'history'), forgotten: r('forgotten', 'forgotten'), hasHistory: true, likedCount: 0 };
    const rows = composeRows(local, {
      categories: [r('c1'), r('c2'), r('c3'), r('c4'), r('c5'), r('c6')], community: r('community'), live: r('live'), videos: r('videos'), charts: r('charts'), feed: [r('f1'), r('f2')],
    });
    expect(rows.map((x) => x.id)).toEqual(['recent', 'mostPlayed', 'c1', 'community', 'quick', 'history', 'c2', 'live', 'c3', 'c4', 'c5', 'forgotten', 'c6', 'videos', 'f1', 'charts', 'f2']);
  });
  it('shows only the feed when there is no history and no recommendation', () => {
    expect(composeRows({ hasHistory: false, likedCount: 0 }, { categories: [], feed: [r('f1')] }).map((x) => x.id)).toEqual(['f1']);
  });
});
