import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDb } from '../library/db';
import { LibraryRepository } from '../library/repository';
import { importCsv, parseCsv, previewCsv } from './csv';

const HEADER = 'Type,Playlist name,Track name,Artist name,Album,Duration (ms),Video ID,Thumbnail';
let repo: LibraryRepository;
beforeEach(() => { repo = new LibraryRepository(createMemoryDb()); });

describe('CSV parsing (Musicfy export, TuneMyMusic, Exportify-style)', () => {
  it('reads the Android export: liked songs and playlists, with ids, quotes and an empty playlist', () => {
    const csv = [
      HEADER,
      'Favorite,,Lagu A,Senja,Album A,200000,abcdefghijk,https://img.test/a.jpg',
      'Favorite,,"Lagu, dengan koma",Fajar,,,bcdefghijkl,',
      'Playlist,Santai,Lagu B,"Senja, Fajar",,180000,cdefghijklm,',
      'Playlist,Santai,Lagu B,"Senja, Fajar",,180000,cdefghijklm,',
      'Playlist,Kosong,,,,,,',
    ].join('\r\n');
    const parsed = parseCsv(csv);
    expect(parsed.liked.map((t) => [t.title, t.videoId])).toEqual([['Lagu A', 'abcdefghijk'], ['Lagu, dengan koma', 'bcdefghijkl']]);
    expect(parsed.playlists.map((p) => [p.name, p.tracks.length])).toEqual([['Santai', 2], ['Kosong', 0]]);
    expect(parsed.liked[0]).toMatchObject({ artist: 'Senja', album: 'Album A', durationMs: 200000, artworkUrl: 'https://img.test/a.jpg' });
  });
  it('finds columns by name in any order, accepts semicolons, a BOM and TuneMyMusic names', () => {
    const csv = '﻿Artist name;Track name;Playlist name;Type;Duration\nSenja;Lagu C;Favorit;Playlist;3:25\n';
    const parsed = parseCsv(csv);
    expect(parsed.playlists[0]).toMatchObject({ name: 'Favorit' });
    expect(parsed.playlists[0].tracks[0]).toMatchObject({ title: 'Lagu C', artist: 'Senja', durationMs: 205000 });
  });
  it('ignores followed albums/artists, and keeps rows with no id as songs the TV cannot place yet', () => {
    const parsed = parseCsv(['Type,Playlist name,Track name,Artist name,Video ID', 'Album,,Album X,Senja,', 'Playlist,P,Lagu D,Senja,', 'Playlist,P,Tanpa artis,,'].join('\n'));
    expect(parsed.playlists[0].tracks.map((t) => t.title)).toEqual(['Lagu D']);
    expect(parsed.playlists[0].tracks[0].videoId).toBeUndefined();
  });
  it('says what it is when it is not a playlist file', () => {
    expect(parseCsv('').liked).toEqual([]);
    expect(parseCsv('a,b\n1,2').playlists).toEqual([]);
  });
});

describe('CSV import', () => {
  const csv = [HEADER, 'Favorite,,Lagu A,Senja,,200000,abcdefghijk,', 'Favorite,,Tanpa id,Senja,,,,', 'Playlist,Santai,Lagu B,Senja,,180000,cdefghijklm,', 'Playlist,Santai,Lagu B,Senja,,180000,cdefghijklm,'].join('\n');

  it('adds likes and playlists, keeps a song twice in a playlist, and lists what could not be placed', async () => {
    const summary = await importCsv(repo, parseCsv(csv));
    expect(summary).toMatchObject({ likes: 1, playlists: 1, playlistSongs: 2, unresolved: 1 });
    expect(summary.unresolvedTitles).toEqual(['Tanpa id · Senja']);
    expect((await repo.listLiked()).map((r) => r.trackKey)).toEqual(['youtube:track:abcdefghijk']);
    const [playlist] = await repo.listPlaylists();
    expect(playlist.name).toBe('Santai');
    expect((await repo.getPlaylist(playlist.id))!.entries).toHaveLength(2);
    expect((await repo.listLibrary()).every((r) => r.source === 'import:csv' || r.source === 'like')).toBe(true);
  });

  it('importing the same file twice changes nothing; a changed file adds only what is new', async () => {
    await importCsv(repo, parseCsv(csv));
    const again = await importCsv(repo, parseCsv(csv));
    expect(again).toMatchObject({ likes: 0, playlists: 0, playlistSongs: 0 });
    expect((await repo.listPlaylists())).toHaveLength(1);
    const more = await importCsv(repo, parseCsv(csv + '\nPlaylist,Santai,Lagu E,Senja,,100000,defghijklmn,'));
    expect(more).toMatchObject({ playlistSongs: 1, playlists: 0 });
  });

  it('keeps liked songs in the order of the file (first is newest)', async () => {
    await importCsv(repo, parseCsv([HEADER, 'Favorite,,Baru,S,,,aaaaaaaaaaa,', 'Favorite,,Lama,S,,,bbbbbbbbbbb,'].join('\n')));
    expect((await repo.listLiked()).map((r) => r.track?.title)).toEqual(['Baru', 'Lama']);
  });

  it('the preview counts without writing, and a failed write leaves nothing behind', async () => {
    expect(await previewCsv(repo, parseCsv(csv))).toMatchObject({ likes: 1, playlists: 1, playlistSongs: 2, unresolved: 1 });
    expect(await repo.listLiked()).toHaveLength(0);
    const db = createMemoryDb();
    const fragile = new LibraryRepository(db);
    (db as unknown as { failWriteNumber: number }).failWriteNumber = 5;
    await expect(importCsv(fragile, parseCsv(csv))).rejects.toThrow();
    expect(await fragile.listLiked()).toHaveLength(0);
    expect(await fragile.listPlaylists()).toHaveLength(0);
  });
});
