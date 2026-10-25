import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb } from '../library/db';
import { PreferencesStore } from '../library/preferences';
import { LibraryRepository } from '../library/repository';
import type { Track } from '../model';
import { ImportFlow } from './flow';
import { exportPortable } from './portable';

const track = (id: string): Track => ({ id, title: `Lagu ${id}`, artist: 'Senja', durationMs: 1000, provider: 'youtube' });
let repo: LibraryRepository; let prefs: PreferencesStore; let flow: ImportFlow; let backupText: string;
const HEADER = 'Type,Playlist name,Track name,Artist name,Album,Duration (ms),Video ID,Thumbnail';

beforeEach(async () => {
  const source = new LibraryRepository(createMemoryDb()); const sourcePrefs = new PreferencesStore(source); await sourcePrefs.hydrate();
  await source.setLiked(track('a'), true);
  const list = await source.createPlaylist('Santai', { id: 'pl-1' });
  await source.addToPlaylist(list.id, [track('a'), track('b')]);
  backupText = JSON.stringify(await exportPortable(source, sourcePrefs, { app: 'musicfy-android', version: '8.1.0' }));
  repo = new LibraryRepository(createMemoryDb()); prefs = new PreferencesStore(repo); await prefs.hydrate();
  await repo.addToLibrary(track('z'), 'manual');
  flow = new ImportFlow(repo, prefs);
});

describe('import flow', () => {
  it('shows what would happen and writes nothing until it is applied', async () => {
    await flow.receive('portable', backupText, { from: 'phone', device: 'Pixel' });
    const state = flow.getSnapshot();
    expect(state).toMatchObject({ status: 'ready', kind: 'portable', mode: 'merge', summary: { added: { songs: 1, playlists: 1, playlistSongs: 2 } } });
    expect(await repo.listPlaylists()).toHaveLength(0);
    await flow.apply();
    expect(flow.getSnapshot()).toMatchObject({ status: 'done', kind: 'portable' });
    expect((await repo.listLibrary()).map((r) => r.trackKey).sort()).toEqual(['youtube:track:a', 'youtube:track:z']);
    expect((await repo.listPlaylists())[0].id).toBe('musicfy-android:pl-1');            // a backup from another app never collides with local ids
  });

  it('replace shows what it would remove and only then replaces', async () => {
    await flow.receive('portable', backupText, { from: 'file', name: 'backup.musicfy.json' });
    await flow.setMode('replace');
    expect(flow.getSnapshot()).toMatchObject({ mode: 'replace', summary: { removed: { songs: 1 } } });
    expect((await repo.listLibrary()).map((r) => r.trackKey)).toEqual(['youtube:track:z']);
    await flow.apply();
    expect((await repo.listLibrary()).map((r) => r.trackKey)).toEqual(['youtube:track:a']);
  });

  it('a file that is not a backup, a newer version and a broken file each say why, and nothing is kept', async () => {
    await flow.receive('portable', '{"format":"other"}', { from: 'file', name: 'x.json' });
    expect(flow.getSnapshot()).toMatchObject({ status: 'error', message: expect.stringMatching(/bukan backup/i), retry: false });
    await flow.receive('portable', JSON.stringify({ ...JSON.parse(backupText), version: 9 }), { from: 'file', name: 'x.json' });
    expect(flow.getSnapshot()).toMatchObject({ status: 'error', message: expect.stringMatching(/lebih baru/i) });
    await flow.receive('portable', 'garbage', { from: 'file', name: 'x.json' });
    expect(flow.getSnapshot()).toMatchObject({ status: 'error' });
    await flow.apply();
    expect(await repo.listPlaylists()).toHaveLength(0);
  });

  it('a failed write changes nothing and can be tried again', async () => {
    await flow.receive('portable', backupText, { from: 'phone' });
    vi.spyOn(repo, 'transaction').mockRejectedValueOnce(new Error('Penyimpanan TV penuh. Data tidak disimpan.'));
    await flow.apply();
    expect(flow.getSnapshot()).toMatchObject({ status: 'error', retry: true, message: 'Penyimpanan TV penuh. Data tidak disimpan.' });
    flow.retry();
    await vi.waitFor(() => expect(flow.getSnapshot().status).toBe('ready'));
    await flow.apply();
    expect(flow.getSnapshot().status).toBe('done');
  });

  it('discard throws the data away', async () => {
    await flow.receive('portable', backupText, { from: 'phone' });
    flow.discard();
    expect(flow.getSnapshot().status).toBe('idle');
    await flow.apply();
    expect(await repo.listPlaylists()).toHaveLength(0);
  });

  it('a later file replaces an earlier preview; a slow preview of the earlier one never wins', async () => {
    const first = flow.receive('portable', backupText, { from: 'file', name: 'a.json' });
    await flow.receive('csv', [HEADER, 'Favorite,,Lagu C,S,,,ccccccccccc,'].join('\n'), { from: 'file', name: 'b.csv' });
    await first;
    expect(flow.getSnapshot()).toMatchObject({ kind: 'csv' });
  });
});

describe('CSV through the flow', () => {
  it('previews likes and playlists, says which songs could not be placed, and imports on apply', async () => {
    const csv = [HEADER, 'Favorite,,Lagu A,Senja,,200000,abcdefghijk,', 'Favorite,,Tanpa id,Senja,,,,', 'Playlist,Santai,Lagu B,Senja,,1000,cdefghijklm,'].join('\n');
    await flow.receive('csv', csv, { from: 'phone', device: 'Pixel' });
    expect(flow.getSnapshot()).toMatchObject({ status: 'ready', kind: 'csv', csv: { likes: 1, playlists: 1, playlistSongs: 1, unresolved: 1 } });
    await flow.apply();
    expect(flow.getSnapshot()).toMatchObject({ status: 'done', kind: 'csv' });
    expect(await repo.listLiked()).toHaveLength(1);
  });
  it('refuses an empty or foreign CSV and an oversized one', async () => {
    await flow.receive('csv', 'a,b\n1,2', { from: 'file', name: 'x.csv' });
    expect(flow.getSnapshot()).toMatchObject({ status: 'error', message: expect.stringMatching(/tidak berisi/i) });
    await flow.receive('csv', 'x'.repeat(10 * 1024 * 1024 + 1), { from: 'file', name: 'x.csv' });
    expect(flow.getSnapshot()).toMatchObject({ status: 'error', message: expect.stringMatching(/terlalu besar/i) });
  });
});
