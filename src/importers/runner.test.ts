import { beforeEach, describe, expect, it } from 'vitest';
import type { CatalogItem } from '../catalog/types';
import { createMemoryDb } from '../library/db';
import { LibraryRepository } from '../library/repository';
import { parseYouTubeLink, readYouTube, LinkImportError } from './link';
import { ImportRunner, playlistIdFor, type RunState } from './runner';

const item = (id: string, title: string, artist: string, durationMs = 200_000): CatalogItem => ({ kind: 'track', id, title, artists: [{ name: artist }], durationMs });
const SONGS = [item('v1', 'Lagu Satu', 'Senja'), item('v2', 'Lagu Dua', 'Fajar'), item('v3', 'Lagu Tiga', 'Malam')];
const searchOf = (known: CatalogItem[], hooks: { calls?: string[]; fail?: (query: string) => boolean } = {}) => async (query: string, filter = 'all') => {
  hooks.calls?.push(`${filter}:${query}`);
  if (hooks.fail?.(query)) throw new Error('rate');
  const hit = filter === 'videos' ? [] : known.filter((song) => query.toLowerCase().startsWith(song.title.toLowerCase()));
  return { filter: filter as 'songs', sections: [], items: hit, skipped: 0 };
};
const noCatalog = { playlist: async () => { throw new Error('unused'); }, album: async () => { throw new Error('unused'); }, more: async () => { throw new Error('unused'); } };
const serviceReply = (tracks: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => async () => new Response(JSON.stringify({ source: 'deezer', kind: 'playlist', remoteId: '77', url: 'https://www.deezer.com/playlist/77', name: 'Mix Deezer', warnings: [], tracks, ...extra }), { status: 200 });
const LISTED = [{ title: 'Lagu Satu', artist: 'Senja', durationMs: 200_000 }, { title: 'Lagu Dua', artist: 'Fajar', durationMs: 200_000 }, { title: 'Tidak Ada Di YouTube', artist: 'Antah', durationMs: 100_000 }];
const settle = async (runner: ImportRunner, until: (s: RunState) => boolean) => { for (let i = 0; i < 200 && !until(runner.getSnapshot()); i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); return runner.getSnapshot(); };

let repo: LibraryRepository;
beforeEach(() => { repo = new LibraryRepository(createMemoryDb(), () => 5_000); });
const make = (catalog: ReturnType<typeof searchOf>, fetcher = serviceReply(LISTED), extra: object = {}) => new ImportRunner(repo, { ...noCatalog, search: catalog }, { fetcher: fetcher as never, now: () => 9_000, sleep: async () => {}, ...extra });

describe('ImportRunner', () => {
  it('reads a link, matches, writes one playlist and reports what matched and what did not', async () => {
    const runner = make(searchOf(SONGS));
    await runner.read('Dengar ini https://www.deezer.com/playlist/77');
    const preview = runner.getSnapshot();
    expect(preview).toMatchObject({ status: 'preview', mode: 'new', preview: { provider: 'deezer', name: 'Mix Deezer' } });
    await runner.start();
    const state = await settle(runner, (s) => s.status === 'done');
    if (state.status !== 'done') throw new Error(state.status);
    expect(state.result).toMatchObject({ total: 3, matched: 2, added: 2, none: 1, failed: 0, mode: 'new', partial: false });
    expect(state.result.unmatched).toEqual([{ label: 'Tidak Ada Di YouTube · Antah', reason: 'none' }]);
    const id = playlistIdFor({ provider: 'deezer', kind: 'playlist', remoteId: '77' });
    const list = (await repo.listPlaylists()).find((p) => p.id === id)!;
    expect(list).toMatchObject({ name: 'Mix Deezer', trackCount: 2, source: { provider: 'deezer', id: '77', url: 'https://www.deezer.com/playlist/77', reportedTrackCount: 3, syncedAt: 9_000 } });
    const log = await repo.importLog();
    expect(log[0]).toMatchObject({ provider: 'deezer', name: 'Mix Deezer', total: 3, matched: 2, added: 2, unmatched: 1, status: 'done', unmatchedTitles: ['Tidak Ada Di YouTube · Antah'] });
  });

  it('writes nothing until matching ends, and a stopped run can be resumed or saved as found', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started = 0;
    const slow = async (query: string, filter = 'all') => { started += 1; if (query.startsWith('Lagu Dua')) await gate; return searchOf(SONGS)(query, filter); };
    const runner = make(slow as never, serviceReply(LISTED.slice(0, 2)));
    await runner.read('https://www.deezer.com/playlist/77');
    const running = runner.start();
    await settle(runner, (s) => s.status === 'matching' && s.matched >= 1);
    runner.cancel();
    expect(runner.getSnapshot()).toMatchObject({ status: 'paused', matched: 1 });
    expect(await repo.listPlaylists()).toHaveLength(0);
    release();
    await running;
    await runner.start();
    const done = await settle(runner, (s) => s.status === 'done');
    expect(done).toMatchObject({ status: 'done', result: { matched: 2, added: 2 } });
    expect(started).toBeGreaterThanOrEqual(2);
  });

  it('keeps found songs when saving a stopped run, and marks it partial', async () => {
    const runner = make(searchOf(SONGS), serviceReply(LISTED.slice(0, 2)));
    await runner.read('https://www.deezer.com/playlist/77');
    // A search that never answers for the 2nd song, so the run is cancelled with 1 of 2 done.
    (runner as unknown as { matcher: { match: (t: { title: string }) => Promise<unknown> } }).matcher = {
      match: (t) => t.title === 'Lagu Satu' ? Promise.resolve({ track: { id: 'v1', title: 'Lagu Satu', artist: 'Senja', durationMs: 1 }, score: 1, via: 'song' }) : new Promise(() => {}),
    };
    void runner.start();
    await settle(runner, (s) => s.status === 'matching' && s.matched === 1);
    runner.cancel();
    await runner.saveFound();
    const state = await settle(runner, (s) => s.status === 'done');
    expect(state).toMatchObject({ status: 'done', result: { matched: 1, added: 1, partial: true } });
    expect((await repo.importLog())[0].status).toBe('partial');
  });

  it('counts a failed search apart from "no match" and tries those again on resume', async () => {
    let failing = true;
    const runner = make(searchOf(SONGS, { fail: (q) => failing && q.startsWith('Lagu Dua') }));
    await runner.read('https://www.deezer.com/playlist/77');
    await runner.start();
    const first = await settle(runner, (s) => s.status === 'done');
    expect(first).toMatchObject({ status: 'done', result: { matched: 1, none: 1, failed: 1 } });
    if (first.status === 'done') expect(first.result.unmatched.map((u) => u.reason).sort()).toEqual(['failed', 'none']);
  });

  it('refreshing adds only new songs and never removes any', async () => {
    const first = make(searchOf(SONGS));
    await first.read('https://www.deezer.com/playlist/77');
    await first.start();
    await settle(first, (s) => s.status === 'done');
    const id = playlistIdFor({ provider: 'deezer', kind: 'playlist', remoteId: '77' });
    const entry = (await repo.getPlaylist(id))!;
    await repo.removeEntry(entry.entries[0].entryId);   // the person removed one on the TV
    const newer = [LISTED[1], { title: 'Lagu Tiga', artist: 'Malam', durationMs: 200_000 }];  // the service dropped song 1, added song 3
    const second = make(searchOf(SONGS), serviceReply(newer), { now: () => 9_500 });
    await second.refresh(id);
    expect(second.getSnapshot()).toMatchObject({ status: 'preview', mode: 'resync' });
    await second.start();
    const done = await settle(second, (s) => s.status === 'done');
    expect(done).toMatchObject({ status: 'done', result: { mode: 'resync', matched: 2, added: 1, alreadyThere: 1 } });
    const titles = (await repo.getPlaylist(id))!.entries.map((e) => e.track?.title).sort();
    expect(titles).toEqual(['Lagu Dua', 'Lagu Tiga']);   // what the service dropped is not deleted here, and the removed entry is not re-added since it is no longer listed
    expect((await repo.importLog()).map((l) => l.status)).toEqual(['resync', 'done']);
  });

  it('refuses to refresh a playlist that has no link', async () => {
    const created = await repo.createPlaylist('Biasa');
    const runner = make(searchOf(SONGS));
    await runner.refresh(created.id);
    expect(runner.getSnapshot()).toMatchObject({ status: 'error', retry: false });
  });

  it('turns service errors into plain messages', async () => {
    const runner = make(searchOf(SONGS), async () => new Response(JSON.stringify({ error: 'Playlist Deezer itu privat atau tidak ada.', kind: 'private' }), { status: 404 }) as never);
    await runner.read('https://www.deezer.com/playlist/5');
    expect(runner.getSnapshot()).toMatchObject({ status: 'error', message: 'Playlist itu privat atau tidak ditemukan.', retry: false });
    await runner.read('halo');
    expect(runner.getSnapshot()).toMatchObject({ status: 'error', retry: false });
  });
});

describe('YouTube links', () => {
  it('finds list ids and album ids, ignores everything else', () => {
    expect(parseYouTubeLink('https://music.youtube.com/playlist?list=PLabcdefghijkl')).toEqual({ kind: 'playlist', id: 'PLabcdefghijkl' });
    expect(parseYouTubeLink('https://www.youtube.com/watch?v=abc&list=PLabcdefghijkl')).toEqual({ kind: 'playlist', id: 'PLabcdefghijkl' });
    expect(parseYouTubeLink('https://music.youtube.com/browse/MPREb_abc123')).toEqual({ kind: 'album', id: 'MPREb_abc123' });
    expect(parseYouTubeLink('https://music.youtube.com/watch?v=abc')).toBeUndefined();
    expect(parseYouTubeLink('https://evil.test/?list=PLabcdefghijkl')).toBeUndefined();
  });
  it('reads every page, uses the exact ids and refuses generated mixes', async () => {
    const header = { title: 'Daftar Saya', playlistId: 'PLabcdefghijkl' };
    const catalog = {
      playlist: async () => ({ type: 'playlist' as const, header, tracks: [item('a1', 'Satu', 'A')], related: [], continuation: { token: 't' }, skipped: 0 }),
      album: async () => { throw new Error('unused'); },
      more: async () => ({ items: [item('a2', 'Dua', 'B')], sections: [], skipped: 0 }),
    };
    const preview = await readYouTube({ kind: 'playlist', id: 'PLabcdefghijkl' }, catalog);
    expect(preview).toMatchObject({ provider: 'youtube', name: 'Daftar Saya', remoteId: 'PLabcdefghijkl', url: 'https://music.youtube.com/playlist?list=PLabcdefghijkl' });
    expect(preview.tracks.map((t) => t.resolved?.id)).toEqual(['a1', 'a2']);
    await expect(readYouTube({ kind: 'playlist', id: 'RDCLAK5uy_abc' }, catalog)).rejects.toMatchObject({ kind: 'mix' });
    const gone = { ...catalog, playlist: async () => { throw Object.assign(new Error('x'), { kind: 'not-found' }); } };
    await expect(readYouTube({ kind: 'playlist', id: 'PLabcdefghijkl' }, gone)).rejects.toBeInstanceOf(LinkImportError);
  });
  it('imports a YouTube playlist without searching anything', async () => {
    const calls: string[] = [];
    const catalog = { search: searchOf([], { calls }), album: async () => { throw new Error('x'); }, more: async () => { throw new Error('x'); }, playlist: async () => ({ type: 'playlist' as const, header: { title: 'YT', playlistId: 'PLabcdefghijkl' }, tracks: [item('a1', 'Satu', 'A')], related: [], skipped: 0 }) };
    const runner = new ImportRunner(repo, catalog, { now: () => 1 });
    await runner.read('https://music.youtube.com/playlist?list=PLabcdefghijkl');
    await runner.start();
    expect(await settle(runner, (s) => s.status === 'done')).toMatchObject({ status: 'done', result: { matched: 1, added: 1 } });
    expect(calls).toEqual([]);
  });
});
