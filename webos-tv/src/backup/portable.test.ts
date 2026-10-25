import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDb } from '../library/db';
import { PreferencesStore } from '../library/preferences';
import { LibraryRepository } from '../library/repository';
import type { Track } from '../model';
import { PORTABLE_FORMAT, PORTABLE_VERSION, BackupError, exportPortable, importPortable, parsePortable, previewPortable } from './portable';

const track = (id: string, extra: Partial<Track> = {}): Track => ({ id, title: `Lagu ${id}`, artist: 'Senja', durationMs: 180_000, provider: 'youtube', ...extra });
let repo: LibraryRepository;
let prefs: PreferencesStore;
let other: LibraryRepository;
let otherPrefs: PreferencesStore;

async function fill(r: LibraryRepository, p: PreferencesStore) {
  await r.addToLibrary(track('a'), 'manual');
  await r.setLiked(track('b'), true);
  await r.pin({ provider: 'youtube', kind: 'track', id: 'a' });
  await r.saveEntity({ ref: { provider: 'youtube', kind: 'album', id: 'MPREx' }, title: 'Album X', artworkUrl: 'https://img.test/x.jpg' });
  const list = await r.createPlaylist('Santai', { id: 'pl-santai' });
  await r.addToPlaylist(list.id, [track('a'), track('b'), track('a')]);            // the same song twice is legitimate
  await r.recordPlay({ id: 's1:1', track: track('a'), sessionId: 's1', startedAt: 1000, listenedMs: 40_000 });
  await r.saveLyricsEdit('youtube:track:a', '[00:01.00]halo');
  await r.setLyricsChoice('youtube:track:a', 'LrcLib');
  await p.set('ui.language', 'en');
  await p.set('player.menuSlots', 'SHUFFLE,QUEUE,SPEED,OUTPUT');
  await p.set('sleep.deadlineAt', 123);                                             // not a setting that travels
  await p.set('onboarding.done', true);
}
const sizes = async (r: LibraryRepository) => ({
  library: (await r.listLibrary()).length, liked: (await r.listLiked()).length, pins: (await r.listPins()).length,
  playlists: (await r.listPlaylists()).length, history: (await r.listHistory()).length,
  entries: (await r.getPlaylist('pl-santai'))?.entries.length ?? 0,
});

beforeEach(async () => {
  repo = new LibraryRepository(createMemoryDb()); prefs = new PreferencesStore(repo); await prefs.hydrate();
  other = new LibraryRepository(createMemoryDb()); otherPrefs = new PreferencesStore(other); await otherPrefs.hydrate();
  await fill(repo, prefs);
});

describe('portable backup', () => {
  it('exports everything that belongs to the collection and nothing that is a secret or a leftover', async () => {
    const backup = await exportPortable(repo, prefs, { app: 'musicfy-tv', version: '0.4.0' });
    expect(backup).toMatchObject({ format: PORTABLE_FORMAT, version: PORTABLE_VERSION, exporter: { app: 'musicfy-tv' } });
    expect(backup.tracks.map((t) => t.id).sort()).toEqual(['a', 'b']);
    expect(backup.playlists[0].entries.map((e) => e.trackKey)).toEqual(['youtube:track:a', 'youtube:track:b', 'youtube:track:a']);
    expect(backup.history).toHaveLength(1);
    expect(backup.lyricsEdits).toEqual([expect.objectContaining({ trackKey: 'youtube:track:a', lrc: '[00:01.00]halo' })]);
    expect(Object.keys(backup.prefs).sort()).toEqual(['player.menuSlots', 'ui.language']);
    expect(JSON.stringify(backup)).not.toMatch(/token|cookie|apikey|password/i);
  });

  it('round-trips into an empty TV with the same content, order and duplicates', async () => {
    const backup = await exportPortable(repo, prefs, { app: 'musicfy-tv', version: '0.4.0' });
    const summary = await importPortable(other, otherPrefs, parsePortable(JSON.parse(JSON.stringify(backup))), { mode: 'merge' });
    expect(summary.skipped).toBe(0);
    expect(await sizes(other)).toEqual(await sizes(repo));
    expect((await other.getPlaylist('pl-santai'))!.entries.map((e) => e.trackKey)).toEqual(['youtube:track:a', 'youtube:track:b', 'youtube:track:a']);
    expect((await other.getLyricsEdit('youtube:track:a'))?.lrc).toBe('[00:01.00]halo');
    expect(await other.getLyricsChoice('youtube:track:a')).toBe('LrcLib');
    expect(otherPrefs.get('ui.language', '')).toBe('en');
    expect(otherPrefs.get('sleep.deadlineAt', undefined)).toBeUndefined();
  });

  it('importing the same backup again changes nothing (no doubled history, entries, library or playlists)', async () => {
    const backup = parsePortable(JSON.parse(JSON.stringify(await exportPortable(repo, prefs, { app: 'musicfy-tv', version: '0.4.0' }))));
    await importPortable(other, otherPrefs, backup, { mode: 'merge' });
    const once = await sizes(other);
    const again = await importPortable(other, otherPrefs, backup, { mode: 'merge' });
    expect(await sizes(other)).toEqual(once);
    expect(again.added).toEqual({ songs: 0, likes: 0, pins: 0, saved: 0, playlists: 0, playlistSongs: 0, history: 0, lyrics: 0 });
  });

  it('merge keeps what the TV already has, including its settings and its own lyrics edit, and adds what is new', async () => {
    await other.addToLibrary(track('z'), 'manual');
    await otherPrefs.set('ui.language', 'id');
    await other.saveLyricsEdit('youtube:track:a', '[00:01.00]punya TV');
    const backup = parsePortable(JSON.parse(JSON.stringify(await exportPortable(repo, prefs, { app: 'musicfy-tv', version: '0.4.0' }))));
    await importPortable(other, otherPrefs, backup, { mode: 'merge' });
    expect((await other.listLibrary()).map((r) => r.trackKey).sort()).toEqual(['youtube:track:a', 'youtube:track:b', 'youtube:track:z']);
    expect(otherPrefs.get('ui.language', '')).toBe('id');
    expect(otherPrefs.get('player.menuSlots', '')).toBe('SHUFFLE,QUEUE,SPEED,OUTPUT');       // a setting the TV did not have yet
    expect((await other.getLyricsEdit('youtube:track:a'))?.lrc).toBe('[00:01.00]punya TV');
  });

  it('merge adds new entries to a playlist that is already there, in order, without touching the existing ones', async () => {
    const first = parsePortable(JSON.parse(JSON.stringify(await exportPortable(repo, prefs, { app: 'musicfy-tv', version: '0.4.0' }))));
    await importPortable(other, otherPrefs, first, { mode: 'merge' });
    await repo.addToPlaylist('pl-santai', [track('c')]);
    const second = parsePortable(JSON.parse(JSON.stringify(await exportPortable(repo, prefs, { app: 'musicfy-tv', version: '0.4.0' }))));
    const summary = await importPortable(other, otherPrefs, second, { mode: 'merge' });
    expect(summary.added.playlistSongs).toBe(1);
    expect((await other.getPlaylist('pl-santai'))!.entries.map((e) => e.trackKey)).toEqual(['youtube:track:a', 'youtube:track:b', 'youtube:track:a', 'youtube:track:c']);
  });

  it('two playlists with the same name stay two playlists', async () => {
    await repo.createPlaylist('Santai', { id: 'pl-lain' });
    const backup = parsePortable(JSON.parse(JSON.stringify(await exportPortable(repo, prefs, { app: 'musicfy-tv', version: '0.4.0' }))));
    await importPortable(other, otherPrefs, backup, { mode: 'merge' });
    expect((await other.listPlaylists()).map((p) => p.name)).toEqual(['Santai', 'Santai']);
  });

  it('replace swaps the collection for the backup, and the preview says what would be removed', async () => {
    await other.addToLibrary(track('z'), 'manual');
    await other.setLiked(track('y'), true);
    const backup = parsePortable(JSON.parse(JSON.stringify(await exportPortable(repo, prefs, { app: 'musicfy-tv', version: '0.4.0' }))));
    const preview = await previewPortable(other, backup, 'replace');
    expect(preview.removed.songs).toBe(2);
    expect(preview.removed.likes).toBe(1);
    expect(await other.listLibrary()).toHaveLength(2);                                      // preview wrote nothing
    await importPortable(other, otherPrefs, backup, { mode: 'replace' });
    expect((await other.listLibrary()).map((r) => r.trackKey).sort()).toEqual(['youtube:track:a', 'youtube:track:b']);
    expect((await other.listLiked()).map((r) => r.trackKey)).toEqual(['youtube:track:b']);
  });

  it('the preview of a merge counts only what is new and writes nothing', async () => {
    await other.addToLibrary(track('a'), 'manual');
    const backup = parsePortable(JSON.parse(JSON.stringify(await exportPortable(repo, prefs, { app: 'musicfy-tv', version: '0.4.0' }))));
    const preview = await previewPortable(other, backup, 'merge');
    expect(preview.added.songs).toBe(1);
    expect(preview.added.playlists).toBe(1);
    expect(preview.added.playlistSongs).toBe(3);
    expect(preview.total.songs).toBe(2);
    expect(await other.listPlaylists()).toHaveLength(0);
  });

  it('a failed write rolls the whole import back', async () => {
    const backup = parsePortable(JSON.parse(JSON.stringify(await exportPortable(repo, prefs, { app: 'musicfy-tv', version: '0.4.0' }))));
    const db = createMemoryDb();
    const fragile = new LibraryRepository(db);
    (db as unknown as { failWriteNumber: number }).failWriteNumber = 7;
    await expect(importPortable(fragile, new PreferencesStore(fragile), backup, { mode: 'merge' })).rejects.toThrow();
    expect(await fragile.listLibrary()).toHaveLength(0);
    expect(await fragile.listPlaylists()).toHaveLength(0);
  });

  it('local songs come back as files to transfer again, not as playable ones', async () => {
    const local = track('file-1', { provider: 'local', title: 'Rekaman', durationMs: 90_000 });
    await repo.addToLibrary(local);
    const backup = parsePortable(JSON.parse(JSON.stringify(await exportPortable(repo, prefs, { app: 'musicfy-tv', version: '0.4.0' }))));
    await importPortable(other, otherPrefs, backup, { mode: 'merge' });
    const assets = await other.listAssets();
    expect(assets).toEqual([expect.objectContaining({ trackKey: 'local:track:file-1', state: 'missing', needsTransfer: true })]);
  });
});

describe('validation', () => {
  const base = () => ({ format: PORTABLE_FORMAT, version: 1, exportId: 'x', exportedAt: 1, exporter: { app: 'musicfy-android', version: '8.1.0' }, tracks: [], library: [], likes: [], pins: [], savedEntities: [], playlists: [], history: [], lyricsEdits: [], lyricsChoice: [], prefs: {} });

  it('refuses things that are not a backup, and newer versions, with a reason', () => {
    expect(() => parsePortable(null)).toThrow(BackupError);
    expect(() => parsePortable({ ...base(), format: 'other' })).toThrow(/bukan backup/i);
    expect(() => parsePortable({ ...base(), version: 2 })).toThrow(/versi/i);
    expect(() => parsePortable({ ...base(), version: 'x' })).toThrow(BackupError);
    expect(() => parsePortable('nope')).toThrow(BackupError);
    expect(() => parsePortable('{broken')).toThrow(/dibaca/i);
  });

  it('keeps the good records and counts the bad ones instead of failing the whole file', async () => {
    const data = {
      ...base(),
      tracks: [track('a'), { id: 5 }, { id: 'ok', title: 'x', artist: 'y', durationMs: 1, provider: 'nope' }, track('b', { artworkUrl: 'http://insecure.test/x.jpg' })],
      library: [{ trackKey: 'youtube:track:a', addedAt: 1, source: 'manual' }, { trackKey: 'youtube:track:ghost', addedAt: 1, source: 'manual' }, 'junk'],
      likes: [{ trackKey: 'youtube:track:b', likedAt: 2 }],
      playlists: [{ id: 'p1', name: 'Ada', createdAt: 1, updatedAt: 1, entries: [{ entryId: 'e1', trackKey: 'youtube:track:a', addedAt: 1 }, { entryId: 'e2', trackKey: 'youtube:track:ghost', addedAt: 1 }] }, { id: '', name: '' }],
    };
    const parsed = parsePortable(data);
    expect(parsed.skipped).toBeGreaterThan(3);
    const summary = await importPortable(other, otherPrefs, parsed, { mode: 'merge' });
    expect(summary.added).toMatchObject({ songs: 2, likes: 1, playlists: 1, playlistSongs: 1 });   // a liked song is part of the library
    expect(summary.skipped).toBe(parsed.skipped);
    expect((await other.getTracks(['youtube:track:b'])).get('youtube:track:b')?.artworkUrl).toBeUndefined();     // only https artwork is kept
  });

  it('does not let a backup reach settings it should not', async () => {
    const parsed = parsePortable({ ...base(), prefs: { 'ui.language': 'id', 'sleep.deadlineAt': 5, 'onboarding.done': true, '__proto__': 'x', 'lyrics.source': 'LrcLib' } });
    expect(Object.keys(parsed.prefs).sort()).toEqual(['lyrics.source', 'ui.language']);
  });

  it('caps absurd sizes', () => {
    expect(() => parsePortable({ ...base(), tracks: Array.from({ length: 200_001 }, (_, i) => track(String(i))) })).toThrow(/terlalu besar/i);
  });
});

describe('the Android companion\'s backup (golden file shared with the Kotlin tests)', () => {
  const golden = readFileSync(fileURLToPath(new URL('../../../modules/tvtransfer/src/test/resources/portable-v1.json', import.meta.url)), 'utf8');

  it('is read without losing a record, with the youtube provider as the default', () => {
    const parsed = parsePortable(golden);
    expect(parsed.skipped).toBe(0);
    expect(parsed.exporter).toEqual({ app: 'musicfy-android', version: '8.1.0' });
    expect(parsed.tracks.map((t) => [t.id, t.provider])).toEqual([['abcdefghijk', 'youtube'], ['file-1', 'local']]);
    expect(parsed.playlists[0].entries).toHaveLength(2);
    expect(parsed.prefs).toEqual({ 'ui.language': 'id' });
  });

  it('imports into the TV: ids from the phone cannot collide with the TV\'s, a song twice stays twice, a phone file waits for its audio', async () => {
    const summary = await importPortable(other, otherPrefs, parsePortable(golden), { mode: 'merge' });
    expect(summary).toMatchObject({ skipped: 0, needsTransfer: 1, added: { likes: 1, pins: 1, playlists: 1, playlistSongs: 2, history: 1, lyrics: 1 } });
    const [playlist] = await other.listPlaylists();
    expect(playlist.id).toBe('musicfy-android:12');
    expect((await other.getPlaylist(playlist.id))!.entries.map((e) => e.trackKey)).toEqual(['youtube:track:abcdefghijk', 'youtube:track:abcdefghijk']);
    expect((await other.listHistory())[0].id).toBe('musicfy-android:android:1');
    expect(await other.listAssets()).toEqual([expect.objectContaining({ trackKey: 'local:track:file-1', state: 'missing' })]);
    expect(otherPrefs.get('ui.language', '')).toBe('id');
    const again = await importPortable(other, otherPrefs, parsePortable(golden), { mode: 'merge' });
    expect(again.added).toEqual({ songs: 0, likes: 0, pins: 0, saved: 0, playlists: 0, playlistSongs: 0, history: 0, lyrics: 0 });
  });
});
