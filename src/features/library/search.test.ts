import { describe, expect, it } from 'vitest';
import { fold, resultCount, searchLibrary } from './search';
import type { LibrarySong } from './data';

const song = (id: string, title: string, artist: string, album?: string): LibrarySong => ({
  trackKey: `youtube:track:${id}`, track: { id, title, artist, album, durationMs: 1, provider: 'youtube' }, addedAt: 1, source: 'manual', liked: false,
});
const snapshot = {
  songs: [song('1', 'Hujan Deras', 'Kota Kita', 'Musim'), song('2', 'Éclair', 'Chef'), song('3', 'Reda', 'Hujan Senja')],
  artists: [{ key: 'a', ref: { provider: 'youtube' as const, kind: 'artist' as const, id: 'UC1' }, title: 'Hujan Senja', savedAt: 1 }],
  albums: [{ key: 'b', ref: { provider: 'youtube' as const, kind: 'album' as const, id: 'MP1' }, title: 'Setelah Hujan', subtitle: 'Hujan Senja', savedAt: 1 }],
  playlists: [{ id: 'p', name: 'Santai Sore', createdAt: 1, updatedAt: 1, trackCount: 0, covers: [] }],
};

describe('library search', () => {
  it('folds accents, width and case', () => {
    expect(fold('  Éclair ')).toBe('eclair');
    expect(fold('ＡＢＣ')).toBe('abc');
  });

  it('finds songs by title, artist or album and the other kinds by name', () => {
    const results = searchLibrary('hujan', snapshot);
    expect(results.songs.map((s) => s.track.id)).toEqual(['1', '3']);
    expect(results.artists).toHaveLength(1);
    expect(results.albums).toHaveLength(1);
    expect(results.playlists).toHaveLength(0);
    expect(resultCount(results)).toBe(4);
    expect(searchLibrary('musim', snapshot).songs.map((s) => s.track.id)).toEqual(['1']);
    expect(searchLibrary('eclair', snapshot).songs.map((s) => s.track.id)).toEqual(['2']);
    expect(searchLibrary('santai', snapshot).playlists).toHaveLength(1);
  });

  it('a blank query finds nothing', () => {
    expect(resultCount(searchLibrary('   ', snapshot))).toBe(0);
  });
});
