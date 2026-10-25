import { describe, expect, it } from 'vitest';
import { DEFAULT_SORT, entityMetrics, readSort, sortItems, yearOf, type SortAccessors } from './sort';
import type { LibrarySnapshot } from './data';
import { track } from '../home/testkit';

interface Item { name: string; artist: string; date: number; play: number; count: number }
const get: SortAccessors<Item> = { name: (i) => i.name, artist: (i) => i.artist, date: (i) => i.date, playTime: (i) => i.play, songCount: (i) => i.count };
const items: Item[] = [
  { name: 'Cherry', artist: 'Xi', date: 3, play: 10, count: 1 },
  { name: 'apple', artist: 'Yan', date: 1, play: 10, count: 5 },
  { name: 'Banana', artist: 'Xi', date: 2, play: 99, count: 5 },
];
const names = (list: Item[]) => list.map((i) => i.name);

describe('sortItems', () => {
  it('sorts by name ascending and descending, ignoring case', () => {
    expect(names(sortItems(items, { key: 'name', descending: false }, get))).toEqual(['apple', 'Banana', 'Cherry']);
    expect(names(sortItems(items, { key: 'name', descending: true }, get))).toEqual(['Cherry', 'Banana', 'apple']);
  });
  it('sorts by artist, with equal artists falling back to name', () => {
    expect(names(sortItems(items, { key: 'artist', descending: false }, get))).toEqual(['Banana', 'Cherry', 'apple']);
  });
  it('sorts by number with ties broken by name, in both directions', () => {
    expect(names(sortItems(items, { key: 'playTime', descending: true }, get))).toEqual(['Banana', 'apple', 'Cherry']);
    expect(names(sortItems(items, { key: 'playTime', descending: false }, get))).toEqual(['apple', 'Cherry', 'Banana']);
    expect(names(sortItems(items, { key: 'songCount', descending: true }, get))).toEqual(['apple', 'Banana', 'Cherry']);
    expect(names(sortItems(items, { key: 'date', descending: true }, get))).toEqual(['Cherry', 'Banana', 'apple']);
  });
  it('custom keeps the stored order and does not mutate the input', () => {
    const before = names(items);
    expect(names(sortItems(items, { key: 'custom', descending: true }, get))).toEqual(before);
    sortItems(items, { key: 'name', descending: false }, get);
    expect(names(items)).toEqual(before);
  });
  it('an accessor that is missing falls back to name order', () => {
    expect(names(sortItems(items, { key: 'year', descending: false }, get))).toEqual(['apple', 'Banana', 'Cherry']);
  });
});

describe('readSort', () => {
  it('accepts a valid stored choice and refuses one that does not belong to the list', () => {
    expect(readSort('songs', { key: 'playTime', descending: true })).toEqual({ key: 'playTime', descending: true });
    expect(readSort('songs', { key: 'custom', descending: true })).toEqual(DEFAULT_SORT.songs);
    expect(readSort('albums', { key: 'year', descending: false })).toEqual({ key: 'year', descending: false });
    expect(readSort('artists', 'garbage')).toEqual(DEFAULT_SORT.artists);
    expect(readSort('artists', undefined)).toEqual(DEFAULT_SORT.artists);
  });
  it('custom order is never descending', () => {
    expect(readSort('playlistSongs', { key: 'custom', descending: true })).toEqual({ key: 'custom', descending: false });
  });
});

describe('entityMetrics and yearOf', () => {
  it('adds up songs, length and listening per album and per artist', () => {
    const a = track('a', { albumId: 'MPREx', durationMs: 100_000, artists: [{ id: 'UC1', name: 'One' }, { id: 'UC2', name: 'Two' }] });
    const b = track('b', { albumId: 'MPREx', durationMs: 50_000, artists: [{ id: 'UC1', name: 'One' }] });
    const c = track('c', { durationMs: 10_000, artists: [{ name: 'No id' }] });
    const songs = [a, b, c].map((t) => ({ trackKey: `youtube:track:${t.id}`, track: t, addedAt: 0, source: 'manual', liked: false }));
    const snap = { songs, playTime: new Map([['youtube:track:a', 7], ['youtube:track:b', 3]]) } as unknown as LibrarySnapshot;
    const albums = entityMetrics(snap, 'album');
    expect(albums.get('MPREx')).toMatchObject({ songCount: 2, length: 150_000, playTime: 10 });
    const artists = entityMetrics(snap, 'artist');
    expect(artists.get('UC1')).toMatchObject({ songCount: 2, playTime: 10 });
    expect(artists.get('UC2')).toMatchObject({ songCount: 1, length: 100_000 });
    expect(artists.size).toBe(2);
  });
  it('reads a year only when one is there', () => {
    expect(yearOf('Album • 2024')).toBe(2024);
    expect(yearOf('Single')).toBe(0);
    expect(yearOf(undefined)).toBe(0);
  });
});
