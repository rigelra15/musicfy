import { vi } from 'vitest';
import { CatalogRequestError, type CatalogGateway } from '../../catalog/gateway';
import type { CatalogItem, CatalogSection } from '../../catalog/types';
import { createMemoryDb } from '../../library/db';
import { PreferencesStore } from '../../library/preferences';
import { LibraryRepository } from '../../library/repository';
import type { Track } from '../../model';
import { ListeningSignals } from './signals';

export const DAY = 86_400_000;
export const NOW = 1_800_000_000_000;

export const track = (id: string, extra: Partial<Track> = {}): Track => ({
  id, title: `Song ${id}`, artist: `Artist ${id}`, durationMs: 200_000, provider: 'youtube',
  artists: [{ id: `UC${id}`, name: `Artist ${id}` }], ...extra,
});

export const song = (id: string, extra: Partial<CatalogItem> = {}): CatalogItem => ({
  kind: 'track', id, title: `Song ${id}`, artists: [{ id: `UC${id}`, name: `Artist ${id}` }], durationMs: 200_000, ...extra,
});
export const album = (id: string, year = '2026'): CatalogItem => ({ kind: 'album', id, browseId: `MPRE${id}`, title: `Album ${id}`, year });
export const playlist = (id: string, subtitle = 'Playlist • Someone'): CatalogItem => ({ kind: 'playlist', id, playlistId: id, title: `List ${id}`, subtitle });
export const video = (id: string, title = `Video ${id}`): CatalogItem => ({ kind: 'video', id, title, artists: [{ id: 'UCa', name: 'A' }] });
export const section = (id: string, items: CatalogItem[], extra: Partial<CatalogSection> = {}): CatalogSection => ({
  id, layout: 'carousel', contentKind: 'mixed', items, ...extra,
});

export async function memoryServices() {
  const repo = new LibraryRepository(createMemoryDb());
  const prefs = new PreferencesStore(repo);
  await prefs.hydrate();
  return { repo, prefs, signals: new ListeningSignals(prefs, () => NOW) };
}

let seq = 0;
export async function play(repo: LibraryRepository, t: Track, daysAgo: number, listenedMs = 120_000) {
  await repo.recordPlay({ id: `s:${seq += 1}`, track: t, sessionId: 's', startedAt: NOW - daysAgo * DAY, listenedMs });
}

const fail = (name: string) => vi.fn(async () => { throw new CatalogRequestError('network', `${name} down`); });

/** A gateway whose every call fails with a network error unless overridden. */
export function fakeGateway(overrides: Partial<Record<keyof CatalogGateway, unknown>> = {}): CatalogGateway {
  const base = {
    home: fail('home'), search: fail('search'), suggest: fail('suggest'), browse: fail('browse'), album: fail('album'), playlist: fail('playlist'),
    artist: fail('artist'), page: fail('page'), next: fail('next'), related: fail('related'), more: fail('more'),
  };
  return { ...base, ...overrides } as unknown as CatalogGateway;
}

export const seededRng = (seed = 1) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
