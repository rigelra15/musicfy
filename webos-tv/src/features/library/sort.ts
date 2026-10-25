import { sortForIndex } from './index';
import type { LibrarySnapshot } from './data';

/** The same sort choices the Android Library offers on each list. */
export type SortScope = 'songs' | 'liked' | 'playlistSongs' | 'playlists' | 'albums' | 'artists';
export type SortKey = 'custom' | 'date' | 'name' | 'artist' | 'playTime' | 'songCount' | 'updated' | 'year' | 'length';
export interface SortSettings { key: SortKey; descending: boolean }

export const SORT_OPTIONS: Record<SortScope, readonly SortKey[]> = {
  songs: ['date', 'name', 'artist', 'playTime'],
  liked: ['date', 'name', 'artist', 'playTime'],
  playlistSongs: ['custom', 'date', 'name', 'artist', 'playTime'],
  playlists: ['date', 'name', 'songCount', 'updated'],
  albums: ['date', 'name', 'artist', 'year', 'songCount', 'length', 'playTime'],
  artists: ['date', 'name', 'songCount', 'playTime'],
};

export const DEFAULT_SORT: Record<SortScope, SortSettings> = {
  songs: { key: 'name', descending: false },
  liked: { key: 'date', descending: true },
  playlistSongs: { key: 'custom', descending: false },
  playlists: { key: 'name', descending: false },
  albums: { key: 'name', descending: false },
  artists: { key: 'name', descending: false },
};

export const sortPrefKey = (scope: SortScope) => `library.sort.${scope}`;

/** A stored value that is not a valid choice for this list (older version, damaged data) falls back to the default. */
export function readSort(scope: SortScope, stored: unknown): SortSettings {
  const value = stored as Partial<SortSettings> | undefined;
  if (value && typeof value === 'object' && SORT_OPTIONS[scope].includes(value.key as SortKey)) {
    return { key: value.key as SortKey, descending: value.key === 'custom' ? false : value.descending === true };
  }
  return DEFAULT_SORT[scope];
}

export interface SortAccessors<T> {
  name(item: T): string;
  artist?(item: T): string;
  date?(item: T): number;
  playTime?(item: T): number;
  songCount?(item: T): number;
  updated?(item: T): number;
  year?(item: T): number;
  length?(item: T): number;
}

/**
 * Sort a copy of `items`. Ties always fall back to the name, so the order is stable and does not jump
 * around when two items share a play time or a date. `custom` keeps the order the items came in.
 */
export function sortItems<T>(items: readonly T[], settings: SortSettings, get: SortAccessors<T>): T[] {
  if (settings.key === 'custom') return [...items];
  const byName = sortForIndex(items, get.name);
  if (settings.key === 'name') return settings.descending ? byName.reverse() : byName;
  if (settings.key === 'artist' && get.artist) {
    const sorted = sortForIndex(byName, get.artist);
    return settings.descending ? sorted.reverse() : sorted;
  }
  const number = get[settings.key as 'date'] as ((item: T) => number) | undefined;
  if (!number) return byName;
  const direction = settings.descending ? -1 : 1;
  return [...byName].sort((a, b) => direction * (number(a) - number(b)));
}

export interface EntityMetrics { songCount: number; length: number; playTime: number; artist: string }

/**
 * What an album or artist adds up to across the songs saved in the Library: how many, how long, how
 * much has been listened to. Albums and artists with no saved songs simply count zero.
 */
export function entityMetrics(snapshot: LibrarySnapshot, kind: 'album' | 'artist'): Map<string, EntityMetrics> {
  const metrics = new Map<string, EntityMetrics>();
  for (const song of snapshot.songs) {
    const ids = kind === 'album' ? (song.track.albumId ? [song.track.albumId] : []) : (song.track.artists ?? []).flatMap((artist) => (artist.id ? [artist.id] : []));
    for (const id of ids) {
      const current = metrics.get(id) ?? { songCount: 0, length: 0, playTime: 0, artist: song.track.artist };
      current.songCount += 1;
      current.length += song.track.durationMs ?? 0;
      current.playTime += snapshot.playTime.get(song.trackKey) ?? 0;
      metrics.set(id, current);
    }
  }
  return metrics;
}

/** The release year inside a subtitle such as "Album • 2024", or 0 when there is none. */
export function yearOf(subtitle: string | undefined): number {
  const match = subtitle?.match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : 0;
}
