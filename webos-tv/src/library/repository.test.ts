import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { trackKeyOf } from '../domain/entity';
import type { Track } from '../model';
import { createMemoryDb, openIndexedDb, StorageError, type Db } from './db';
import { migrateLegacyPreferences, PREF_PLAYER_APPEARANCE } from './migrations';
import { PreferencesStore } from './preferences';
import { LibraryRepository } from './repository';

const track = (id: string, extra: Partial<Track> = {}): Track => ({
  id,
  title: `Song ${id}`,
  artist: 'Artist',
  durationMs: 180000,
  ...extra,
});

let clock = 1_000;
const tick = () => (clock += 10);

type Factory = { name: string; create: () => Promise<Db> };
const factories: Factory[] = [
  { name: 'memory', create: async () => createMemoryDb() },
  { name: 'indexeddb', create: () => openIndexedDb(`test-${Math.random()}`, new IDBFactory()) },
];

describe.each(factories)('LibraryRepository on $name', ({ create }) => {
  let db: Db;
  let repo: LibraryRepository;
  beforeEach(async () => {
    clock = 1_000;
    db = await create();
    repo = new LibraryRepository(db, tick);
  });

  it('keeps provider-qualified tracks apart', async () => {
    await repo.upsertTracks([track('a'), track('a', { provider: 'monochrome', title: 'Other' })]);
    expect((await repo.getTrack('youtube:track:a'))?.title).toBe('Song a');
    expect((await repo.getTrack('monochrome:track:a'))?.title).toBe('Other');
  });

  it('adds to the library once and lists newest first', async () => {
    await repo.addToLibrary(track('a'));
    await repo.addToLibrary(track('b'));
    await repo.addToLibrary(track('a'));
    const library = await repo.listLibrary();
    expect(library.map((item) => item.trackKey)).toEqual(['youtube:track:b', 'youtube:track:a']);
    expect(await repo.isInLibrary('youtube:track:a')).toBe(true);
    await repo.removeFromLibrary('youtube:track:a');
    expect(await repo.isInLibrary('youtube:track:a')).toBe(false);
  });

  it('liking adds to the library and unliking keeps it', async () => {
    await repo.setLiked(track('a'), true);
    expect(await repo.isLiked('youtube:track:a')).toBe(true);
    expect(await repo.isInLibrary('youtube:track:a')).toBe(true);
    await repo.setLiked(track('a'), false);
    expect(await repo.isLiked('youtube:track:a')).toBe(false);
    expect(await repo.isInLibrary('youtube:track:a')).toBe(true);
  });

  it('pins in order and compacts positions on unpin', async () => {
    const refs = ['1', '2', '3'].map((id) => ({ provider: 'youtube', kind: 'artist', id }) as const);
    for (const ref of refs) await repo.pin(ref);
    await repo.pin(refs[0]);
    await repo.unpin(refs[0]);
    const pins = await repo.listPins();
    expect(pins.map((pin) => pin.ref.id)).toEqual(['2', '3']);
    expect(pins.map((pin) => pin.position)).toEqual([0, 1]);
  });

  it('keeps duplicate entries and same-named playlists', async () => {
    const a = await repo.createPlaylist('Mix');
    const b = await repo.createPlaylist('Mix');
    expect(a.id).not.toBe(b.id);
    await repo.addToPlaylist(a.id, [track('x'), track('x'), track('y')]);
    const loaded = await repo.getPlaylist(a.id);
    expect(loaded?.entries.map((entry) => entry.trackKey)).toEqual(['youtube:track:x', 'youtube:track:x', 'youtube:track:y']);
    expect(new Set(loaded?.entries.map((entry) => entry.entryId)).size).toBe(3);
    expect((await repo.getPlaylist(b.id))?.entries).toEqual([]);
  });

  it('skips duplicates only when asked and reports them', async () => {
    const list = await repo.createPlaylist('L');
    await repo.addToPlaylist(list.id, [track('x')]);
    expect(await repo.findDuplicates(list.id, ['youtube:track:x', 'youtube:track:z'])).toEqual(['youtube:track:x']);
    const result = await repo.addToPlaylist(list.id, [track('x'), track('z')], { onDuplicate: 'skip' });
    expect(result.added).toHaveLength(1);
    expect(result.skipped.map((item) => item.id)).toEqual(['x']);
  });

  it('reorders and removes entries keeping positions dense', async () => {
    const list = await repo.createPlaylist('L');
    const { added } = await repo.addToPlaylist(list.id, [track('a'), track('b'), track('c'), track('d')]);
    await repo.moveEntry(added[3].entryId, 0);
    expect((await repo.getPlaylist(list.id))?.entries.map((e) => e.track?.id)).toEqual(['d', 'a', 'b', 'c']);
    await repo.removeEntry(added[0].entryId);
    const entries = (await repo.getPlaylist(list.id))!.entries;
    expect(entries.map((e) => e.track?.id)).toEqual(['d', 'b', 'c']);
    expect(entries.map((e) => e.position)).toEqual([0, 1, 2]);
  });

  it('deletes a playlist together with its entries', async () => {
    const list = await repo.createPlaylist('L');
    await repo.addToPlaylist(list.id, [track('a')]);
    await repo.deletePlaylist(list.id);
    expect(await repo.getPlaylist(list.id)).toBeUndefined();
    expect(await repo.read(['playlistEntries'], (tx) => tx.getAll('playlistEntries'))).toEqual([]);
  });

  it('is idempotent when the same import key arrives again', async () => {
    const list = await repo.createPlaylist('Imported');
    await repo.addToPlaylist(list.id, [track('a'), track('b')], { importKeys: ['k1', 'k2'] });
    const again = await repo.addToPlaylist(list.id, [track('a'), track('b')], { importKeys: ['k1', 'k2'] });
    expect(again.added).toHaveLength(0);
    expect((await repo.getPlaylist(list.id))?.entries).toHaveLength(2);
  });

  it('records a play once per deterministic id', async () => {
    const play = { id: 's1:0', track: track('a'), sessionId: 's1', startedAt: 5000, listenedMs: 40000 };
    expect(await repo.recordPlay(play)).toBe(true);
    expect(await repo.recordPlay(play)).toBe(false);
    await repo.recordPlay({ ...play, id: 's1:1', startedAt: 9000, listenedMs: 31000 });
    await repo.recordPlay({ id: 's2:0', track: track('b'), sessionId: 's2', startedAt: 10000, listenedMs: 35000 });
    const counts = await repo.playCounts();
    expect(counts[0]).toMatchObject({ trackKey: 'youtube:track:a', plays: 2, listenedMs: 71000 });
    expect(await repo.totalListenedMs()).toBe(106000);
    expect((await repo.listHistory({ limit: 1 }))[0].id).toBe('s2:0');
  });

  it('extends a play while it is running, but never shrinks it or invents one', async () => {
    await repo.recordPlay({ id: 's1:0', track: track('a'), sessionId: 's1', startedAt: 5000, listenedMs: 31000 });
    expect(await repo.extendPlay('s1:0', 90000)).toBe(true);
    expect(await repo.extendPlay('s1:0', 40000)).toBe(false);
    expect(await repo.extendPlay('nope', 40000)).toBe(false);
    expect(await repo.totalListenedMs()).toBe(90000);
    expect(await repo.listHistory()).toHaveLength(1);
    await repo.deletePlay('s1:0');
    expect(await repo.listHistory()).toHaveLength(0);
  });

  it('stores lyric edits, per-song provider choices and search history', async () => {
    await repo.saveLyricsEdit('youtube:track:a', '[00:01.00]hi');
    expect((await repo.getLyricsEdit('youtube:track:a'))?.provider).toBe('UserEdited');
    await repo.setLyricsChoice('youtube:track:a', 'LrcLib');
    expect(await repo.getLyricsChoice('youtube:track:a')).toBe('LrcLib');
    await repo.setLyricsChoice('youtube:track:a', null);
    expect(await repo.getLyricsChoice('youtube:track:a')).toBeUndefined();
    await repo.rememberSearch('coldplay');
    await repo.rememberSearch('queen');
    expect(await repo.listSearches()).toEqual(['queen', 'coldplay']);
  });

  it('persists the session and mappings', async () => {
    await repo.saveSession({ queue: ['a'] });
    expect((await repo.loadSession<{ queue: string[] }>())?.data.queue).toEqual(['a']);
    await repo.mapRecordings('youtube:track:a', 'monochrome:track:9', 0.9);
    expect(await repo.equivalentsOf('monochrome:track:9')).toEqual(['youtube:track:a']);
  });

  it('reconciles asset state with the files the service holds', async () => {
    for (const id of ['ok', 'gone', 'partial', 'orphan-meta']) await repo.registerAsset({ assetId: id, trackKey: `youtube:track:${id}`, kind: 'download', state: id === 'partial' ? 'staging' : 'ready', bytes: 10 });
    await repo.addToLibrary(track('gone'));
    const summary = await repo.reconcileAssets([
      { assetId: 'ok', bytes: 99, state: 'ready' },
      { assetId: 'partial', bytes: 5, state: 'staging' },
      { assetId: 'stray', bytes: 1, state: 'ready' },
    ]);
    expect(summary).toMatchObject({ ready: 1, missing: 2, failed: 1, orphans: ['stray'] });
    const states = Object.fromEntries((await repo.listAssets()).map((a) => [a.assetId, a.state]));
    expect(states).toEqual({ ok: 'ready', gone: 'missing', partial: 'failed', 'orphan-meta': 'missing' });
    expect(await repo.isInLibrary('youtube:track:gone')).toBe(true);
  });

  it('survives a reload of the same database', async () => {
    await repo.addToLibrary(track('a'));
    const again = new LibraryRepository(db, tick);
    expect((await again.listLibrary()).map((item) => item.trackKey)).toEqual([trackKeyOf(track('a'))]);
  });
});

describe('transactions', () => {
  it('rolls back every write when one fails', async () => {
    const db = createMemoryDb();
    const repo = new LibraryRepository(db, tick);
    const list = await repo.createPlaylist('L');
    db.failWriteNumber = 3;
    await expect(repo.addToPlaylist(list.id, [track('a'), track('b'), track('c')])).rejects.toMatchObject({ kind: 'quota' });
    expect((await repo.getPlaylist(list.id))?.entries).toEqual([]);
    expect(await repo.getTrack('youtube:track:a')).toBeUndefined();
  });

  it('reports a full store as quota and stores nothing', async () => {
    const db = createMemoryDb({ maxRecords: 3 });
    const repo = new LibraryRepository(db, tick);
    await repo.addToLibrary(track('a'));
    await expect(repo.addToLibrary(track('b'))).rejects.toBeInstanceOf(StorageError);
    expect(await repo.isInLibrary('youtube:track:b')).toBe(false);
    expect(await repo.getTrack('youtube:track:b')).toBeUndefined();
  });

  it('aborts an IndexedDB transaction when the callback throws', async () => {
    const db = await openIndexedDb(`abort-${Math.random()}`, new IDBFactory());
    const repo = new LibraryRepository(db, tick);
    await expect(
      repo.transaction(['library', 'tracks'], async (tx) => {
        await tx.put('library', { trackKey: 'youtube:track:z', addedAt: 1, source: 'x' });
        throw new StorageError('quota', 'full');
      }),
    ).rejects.toMatchObject({ kind: 'quota' });
    expect(await repo.isInLibrary('youtube:track:z')).toBe(false);
  });

  it('refuses writes after close', async () => {
    const db = createMemoryDb();
    const repo = new LibraryRepository(db, tick);
    db.close();
    await expect(repo.addToLibrary(track('a'))).rejects.toMatchObject({ kind: 'closed' });
  });
});

describe('legacy preference migration', () => {
  const legacy = (entries: Record<string, string>) => ({ getItem: (key: string) => entries[key] ?? null });

  it('copies old localStorage preferences once and never overwrites newer ones', async () => {
    const repo = new LibraryRepository(createMemoryDb(), tick);
    const storage = legacy({
      'musicfy.tv.playerAppearance.v1': JSON.stringify({ coverStyle: 'TURNTABLE', rotation: false }),
      'musicfy.tv.lyrics.detail': 'word',
      'musicfy.tv.lyrics.motion': 'bogus',
    });
    const first = await migrateLegacyPreferences(repo, storage);
    expect(first.migrated.sort()).toEqual(['lyrics.detail', 'player.appearance']);
    expect(await repo.getPref('lyrics.detail')).toBe('word');
    expect(((await repo.getPref(PREF_PLAYER_APPEARANCE)) as { coverStyle: string }).coverStyle).toBe('TURNTABLE');
    expect(await repo.getPref('lyrics.motion')).toBeUndefined();

    await repo.setPref('lyrics.detail', 'syllable');
    const second = await migrateLegacyPreferences(repo, storage);
    expect(second.migrated).toEqual([]);
    expect(await repo.getPref('lyrics.detail')).toBe('syllable');
  });

  it('works with no legacy storage', async () => {
    const repo = new LibraryRepository(createMemoryDb(), tick);
    expect((await migrateLegacyPreferences(repo, undefined)).migrated).toEqual([]);
  });
});

describe('PreferencesStore', () => {
  it('serves cached values and does not show a value that failed to save', async () => {
    const db = createMemoryDb();
    const repo = new LibraryRepository(db, tick);
    await repo.setPref('a', 1);
    const prefs = new PreferencesStore(repo);
    await prefs.hydrate();
    expect(prefs.get('a', 0)).toBe(1);
    expect(prefs.get('missing', 'x')).toBe('x');
    db.failWriteNumber = 1;
    await expect(prefs.set('a', 2)).rejects.toBeInstanceOf(StorageError);
    expect(prefs.get('a', 0)).toBe(1);
    expect(prefs.lastError).toBeInstanceOf(StorageError);
    await prefs.set('a', 3);
    expect(prefs.get('a', 0)).toBe(3);
    expect(prefs.lastError).toBeUndefined();
  });
});
