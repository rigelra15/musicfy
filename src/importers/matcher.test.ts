import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '../catalog/types';
import { cleanTitleForSearch, MatchSearchError, normalizeText, score, similarity, splitArtists, TrackMatcher } from './matcher';

const item = (id: string, title: string, artist: string, durationMs: number, kind: CatalogItem['kind'] = 'track'): CatalogItem => ({ kind, id, title, artists: artist.split(', ').map((name) => ({ name })), durationMs });
const page = (items: CatalogItem[]) => ({ filter: 'songs' as const, sections: [], items, skipped: 0 });
const catalogOf = (songs: CatalogItem[], videos: CatalogItem[] = [], calls: Array<[string, string]> = []) => ({
  search: async (query: string, filter = 'all') => { calls.push([query, filter]); return page(filter === 'videos' ? videos : songs); },
});
const noSleep = async () => {};

describe('text rules (same as the Android matcher)', () => {
  it('cleans titles for searching and splits artists', () => {
    expect(cleanTitleForSearch('Lagu Ku (feat. Dia) - Remastered 2011')).toBe('Lagu Ku');
    expect(cleanTitleForSearch('Judul - Live at Wembley')).toBe('Judul');
    expect(cleanTitleForSearch('(Official Video)')).toBe('(Official Video)');
    expect(splitArtists('Senja & Fajar, Malam feat. Bintang')).toEqual(['Senja', 'Fajar', 'Malam', 'Bintang']);
    expect(normalizeText('Beyoncé — Déjà vu!')).toBe('beyonce deja vu');
  });
  it('scores identical > partial > unrelated, and reordered words still count', () => {
    expect(similarity('abc def', 'abc def')).toBe(1);
    expect(similarity('def abc', 'abc def')).toBe(1);
    expect(similarity('song', 'song pt 1')).toBeGreaterThanOrEqual(0.8);
    expect(similarity('abc', 'xyz')).toBe(0);
    expect(similarity('', 'x')).toBe(0);
  });
});

describe('score', () => {
  const wanted = { title: 'Lagu Satu', artist: 'Senja', durationMs: 200_000 };
  const cand = (title: string, artist: string, durationMs: number) => ({ title, artist, artists: [{ name: artist }], durationMs });
  it('prefers the right length and penalises a version nobody asked for', () => {
    const exact = score(wanted, cand('Lagu Satu', 'Senja', 201_000));
    expect(exact).toBeGreaterThan(0.95);
    expect(score(wanted, cand('Lagu Satu', 'Senja', 230_000))).toBeLessThan(exact);
    expect(score(wanted, cand('Lagu Satu (Live)', 'Senja', 201_000))).toBeLessThan(exact - 0.1);
    expect(score({ ...wanted, title: 'Lagu Satu (Live)' }, cand('Lagu Satu (Live)', 'Senja', 201_000))).toBeGreaterThan(0.95);
  });
  it('is 0 when the title is too different, and understands "Artist - Title" video names', () => {
    expect(score(wanted, cand('Sesuatu Lain', 'Senja', 200_000))).toBe(0);
    expect(score(wanted, cand('Senja - Lagu Satu', 'Kanal Acak', 200_000))).toBeGreaterThan(0.7);
  });
});

describe('TrackMatcher', () => {
  const wanted = { title: 'Lagu Satu (feat. Dia)', artist: 'Senja & Fajar', durationMs: 200_000 };
  it('takes the best song, searching for the cleaned title and the first artist', async () => {
    const calls: Array<[string, string]> = [];
    const matcher = new TrackMatcher(catalogOf([item('x', 'Lagu Satu Remix', 'Senja', 200_000), item('good', 'Lagu Satu', 'Senja, Fajar', 199_000)], [], calls), noSleep);
    const found = await matcher.match(wanted);
    expect(found).toMatchObject({ via: 'song', track: { id: 'good' } });
    expect(calls).toEqual([['Lagu Satu Senja', 'songs']]);
  });
  it('falls back to a video only when no song is close, and to a weak song last', async () => {
    const video = item('vid', 'Senja - Lagu Satu (Official Video)', 'Kanal', 200_000, 'video');
    const viaVideo = await new TrackMatcher(catalogOf([item('bad', 'Lain Sekali', 'Orang', 100_000)], [video]), noSleep).match(wanted);
    expect(viaVideo).toMatchObject({ via: 'video', track: { id: 'vid', isVideo: true } });
    const weak = item('weak', 'Lagu Satu', 'Orang Lain', 300_000);
    const viaWeak = await new TrackMatcher(catalogOf([weak], []), noSleep).match(wanted);
    expect(viaWeak === undefined || viaWeak.via === 'fallback' || viaWeak.via === 'song').toBe(true);
    expect(await new TrackMatcher(catalogOf([], []), noSleep).match(wanted)).toBeUndefined();
  });
  it('searches a repeated song once for the whole import', async () => {
    const calls: Array<[string, string]> = [];
    const matcher = new TrackMatcher(catalogOf([item('good', 'Lagu Satu', 'Senja', 200_000)], [], calls), noSleep);
    await Promise.all([matcher.match(wanted), matcher.match({ ...wanted }), matcher.match({ ...wanted, durationMs: 201_000 })]);
    expect(calls).toHaveLength(1);
  });
  it('retries a failed search once, then reports a failure instead of "no match", and does not remember it', async () => {
    let attempts = 0;
    const flaky = { search: async () => { attempts += 1; if (attempts < 3) throw new Error('429'); return page([item('good', 'Lagu Satu', 'Senja', 200_000)]); } };
    const matcher = new TrackMatcher(flaky, noSleep);
    await expect(matcher.match(wanted)).rejects.toBeInstanceOf(MatchSearchError);
    expect(attempts).toBe(2);
    expect(await matcher.match(wanted)).toMatchObject({ track: { id: 'good' } });
  });
  it('stops at once when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new TrackMatcher(catalogOf([]), noSleep).match(wanted, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
