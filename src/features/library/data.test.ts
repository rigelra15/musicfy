import { describe, expect, it, vi } from 'vitest';
import { memoryServices, track, NOW } from '../home/testkit';
import { LibraryData } from './data';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('LibraryData', () => {
  it('lists the collection and refreshes when the repository changes', async () => {
    const { repo } = await memoryServices();
    const data = new LibraryData(repo);
    data.start(); await tick(); await tick();
    expect(data.getSnapshot().status).toBe('ready');
    expect(data.getSnapshot().songs).toHaveLength(0);
    const listener = vi.fn();
    data.subscribe(listener);
    await repo.addToLibrary(track('a'));
    await tick(); await tick();
    expect(data.getSnapshot().songs.map((song) => song.track.id)).toEqual(['a']);
    await repo.setLiked(track('b'), true);
    await tick(); await tick();
    const snap = data.getSnapshot();
    expect(snap.liked.map((song) => song.track.id)).toEqual(['b']);
    expect(snap.songs.map((song) => song.track.id).sort()).toEqual(['a', 'b']);
    expect(snap.songs.find((song) => song.track.id === 'b')!.liked).toBe(true);
    expect(snap.likedKeys.has('youtube:track:b')).toBe(true);
    expect(snap.libraryKeys.has('youtube:track:a')).toBe(true);
    expect(listener).toHaveBeenCalled();
    data.dispose();
  });

  it('coalesces a burst of changes into few reloads and never publishes an older read over a newer one', async () => {
    const { repo } = await memoryServices();
    const data = new LibraryData(repo);
    data.start(); await tick();
    const reload = vi.spyOn(data, 'reload');
    await Promise.all(['1', '2', '3', '4', '5'].map((id) => repo.addToLibrary(track(id))));
    await tick(); await tick();
    expect(reload.mock.calls.length).toBeLessThanOrEqual(2);
    expect(data.getSnapshot().songs).toHaveLength(5);
    data.dispose();
  });

  it('a failed write does not notify and a failed read keeps what was shown', async () => {
    const { repo } = await memoryServices();
    const seen = vi.fn();
    repo.subscribe(seen);
    await expect(repo.createPlaylist('   ')).rejects.toThrow();
    expect(seen).not.toHaveBeenCalled();
    const data = new LibraryData(repo);
    data.start(); await tick(); await tick();
    await repo.addToLibrary(track('keep'));
    await tick(); await tick();
    vi.spyOn(repo, 'listLibrary').mockRejectedValueOnce(new Error('disk'));
    await data.reload();
    expect(data.getSnapshot().status).toBe('error');
    expect(data.getSnapshot().songs.map((song) => song.track.id)).toEqual(['keep']);
    await data.reload();
    expect(data.getSnapshot().status).toBe('ready');
    data.dispose();
  });

  it('resolves pins to titles and covers: songs, saved albums, local playlists; skips pins whose data is gone', async () => {
    const { repo } = await memoryServices();
    const first = track('p1', { title: 'Satu', artworkUrl: 'https://img/p1' });
    await repo.addToLibrary(first);
    await repo.saveEntity({ ref: { provider: 'youtube', kind: 'album', id: 'MPRE1' }, title: 'Album Satu', artworkUrl: 'https://img/al' });
    const playlist = await repo.createPlaylist('Santai');
    await repo.addToPlaylist(playlist.id, [first]);
    await repo.pin({ provider: 'youtube', kind: 'track', id: 'p1' });
    await repo.pin({ provider: 'youtube', kind: 'album', id: 'MPRE1' });
    await repo.pin({ provider: 'local', kind: 'playlist', id: playlist.id });
    await repo.pin({ provider: 'youtube', kind: 'artist', id: 'UCghost' });
    const data = new LibraryData(repo);
    data.start(); await tick(); await tick();
    expect(data.getSnapshot().pins.map((pin) => pin.title)).toEqual(['Satu', 'Album Satu', 'Santai']);
    expect(data.getSnapshot().pins[2].artworkUrl).toBe('https://img/p1');
    expect(data.getSnapshot().playlists[0].covers).toEqual(['https://img/p1']);
    data.dispose();
  });

  it('keeps recently added order (newest first)', async () => {
    const { repo } = await memoryServices();
    let clock = NOW;
    const timed = new (repo.constructor as new (db: unknown, now: () => number) => typeof repo)((repo as unknown as { db: unknown }).db, () => (clock += 1000));
    await timed.addToLibrary(track('old'));
    await timed.addToLibrary(track('new'));
    const data = new LibraryData(timed);
    await data.reload();
    expect(data.getSnapshot().songs.map((song) => song.track.id)).toEqual(['new', 'old']);
  });
});
