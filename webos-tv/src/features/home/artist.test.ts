import { describe, expect, it } from 'vitest';
import { trackKeyOf } from '../../domain/entity';
import { createMemoryDb } from '../../library/db';
import { LibraryRepository } from '../../library/repository';
import { artistFromSubtitle, sanitizeArtist, trackFromCatalog } from './model';

describe('artist from a subtitle', () => {
  it('drops the type label, the length and the counts, and keeps who made it', () => {
    expect(artistFromSubtitle('Lagu • 4.02')).toBe('');
    expect(artistFromSubtitle('Song • NIKI • 4:02')).toBe('NIKI');
    expect(artistFromSubtitle('Shabarimuhammad • 327 rb x ditonton • 3.53')).toBe('Shabarimuhammad');
    expect(artistFromSubtitle('Video • LANY • 418K views • 4:32')).toBe('LANY');
    expect(artistFromSubtitle('Album')).toBe('Album');          // a single word is never a label to drop: nothing else to show
  });
  it('a catalog row with no artists no longer gets its subtitle as the artist', () => {
    const track = trackFromCatalog({ kind: 'track', id: 'x', title: 'You’ll Be in My Heart', subtitle: 'Lagu • 4.02' });
    expect(track.artist).toBe('');
    expect(trackFromCatalog({ kind: 'track', id: 'y', title: 'T', subtitle: 'Lagu • NIKI • 4.02', artists: [{ name: 'NIKI' }] }).artist).toBe('NIKI');
  });
  it('repairs an artist that was saved as a whole subtitle, and leaves real names alone', () => {
    expect(sanitizeArtist('Lagu • 4.02')).toBe('');
    expect(sanitizeArtist('Song • NIKI • 4:02')).toBe('NIKI');
    expect(sanitizeArtist('Simon & Garfunkel')).toBe('Simon & Garfunkel');
    expect(sanitizeArtist('A • B')).toBe('A • B');
  });
  it('saved songs are repaired once when the library opens, and new saves are clean', async () => {
    const repo = new LibraryRepository(createMemoryDb());
    await repo.transaction(['tracks'], async (tx) => { await tx.put('tracks', { trackKey: 'youtube:old', track: { id: 'old', title: 'Lama', artist: 'Lagu • 4.02', durationMs: 1000, provider: 'youtube' }, updatedAt: 1 }); });
    expect(await repo.repairTrackArtists()).toBe(1);
    expect((await repo.getTrack('youtube:old'))!.artist).toBe('');
    expect(await repo.repairTrackArtists()).toBe(0);
    const fresh = { id: 'new', title: 'Baru', artist: 'Lagu • NIKI • 4.02', durationMs: 1000 };
    await repo.addToLibrary(fresh);
    expect((await repo.getTrack(trackKeyOf(fresh)))!.artist).toBe('NIKI');
  });
});
