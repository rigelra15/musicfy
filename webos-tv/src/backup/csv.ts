import { trackKeyOf } from '../domain/entity';
import type { LibraryRepository } from '../library/repository';
import type { LibraryRecord, LikeRecord, PlaylistEntryRecord, PlaylistRecord, StoredTrack } from '../library/types';
import type { Track } from '../model';

/**
 * Playlist CSV files: Musicfy's own export from Android, TuneMyMusic and Exportify-style files.
 * Same columns, found by name, as the Android reader. A file carries liked songs and playlists,
 * and nothing else (no history, no settings).
 */
export interface CsvTrack { title: string; artist: string; album?: string; durationMs?: number; videoId?: string; artworkUrl?: string }
export interface ParsedCsv { liked: CsvTrack[]; playlists: Array<{ name: string; tracks: CsvTrack[] }> }

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
export const MAX_CSV_BYTES = 10 * 1024 * 1024;
const normalize = (name: string) => name.replace(/^﻿/, '').trim().toLowerCase().replace(/[\s_]+/g, ' ');

function rowsOf(input: string): string[][] {
  const content = input.replace(/^﻿/, '');
  const head = content.slice(0, content.indexOf('\n') < 0 ? content.length : content.indexOf('\n'));
  const delimiter = head.split(';').length > head.split(',').length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (quoted) {
      if (ch === '"') { if (content[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false; } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && content[i + 1] === '\n') i += 1; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function durationOf(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parts = value.split(':').map((part) => Number(part.trim()));
  if (parts.some((part) => !Number.isFinite(part) || part < 0) || parts.length > 3) return undefined;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return seconds > 0 ? seconds * 1000 : undefined;
}

export function parseCsv(text: string): ParsedCsv {
  const rows = rowsOf(text);
  const empty: ParsedCsv = { liked: [], playlists: [] };
  if (rows.length === 0) return empty;
  const header = rows[0].map(normalize);
  const column = (...names: string[]) => { for (const name of names) { const at = header.indexOf(normalize(name)); if (at >= 0) return at; } return -1; };
  const titleIdx = column('Track name', 'Track', 'Title', 'Song', 'Song name', 'Name');
  const artistIdx = column('Artist name', 'Artist name(s)', 'Artist', 'Artists', 'Artist names');
  const albumIdx = column('Album', 'Album name', 'Album title');
  const playlistIdx = column('Playlist name', 'Playlist');
  const typeIdx = column('Type');
  const msIdx = column('Duration (ms)', 'Duration ms', 'Track duration (ms)');
  const durationIdx = column('Duration', 'Length', 'Time');
  const idIdx = column('Video ID', 'YouTube ID', 'VideoId');
  const thumbIdx = column('Thumbnail', 'Thumbnail URL');
  if (titleIdx < 0) return empty;

  const liked: CsvTrack[] = [];
  const playlists = new Map<string, CsvTrack[]>();
  for (const row of rows.slice(1)) {
    const cell = (index: number) => (index >= 0 ? row[index]?.trim() || undefined : undefined);
    const type = cell(typeIdx)?.toLowerCase();
    const isLiked = type === 'favorite' || type === 'favorites' || type === 'liked' || type === 'liked songs';
    if (type !== undefined && !isLiked && !['playlist', 'track', 'song'].includes(type)) continue;   // followed albums and artists
    const title = cell(titleIdx);
    const playlistName = cell(playlistIdx) ?? 'Imported playlist';
    if (!title) {
      if (!isLiked && playlistIdx >= 0 && cell(playlistIdx)) playlists.set(playlistName, playlists.get(playlistName) ?? []);
      continue;
    }
    const videoId = cell(idIdx);
    const artist = cell(artistIdx) ?? '';
    if (!artist && !(videoId && YOUTUBE_ID.test(videoId))) continue;
    const thumb = cell(thumbIdx);
    const track: CsvTrack = {
      title: title.slice(0, 500), artist: artist.slice(0, 500),
      ...(cell(albumIdx) ? { album: cell(albumIdx)!.slice(0, 500) } : {}),
      ...(Number(cell(msIdx)) > 0 ? { durationMs: Number(cell(msIdx)) } : durationOf(cell(durationIdx)) ? { durationMs: durationOf(cell(durationIdx)) } : {}),
      ...(videoId && YOUTUBE_ID.test(videoId) ? { videoId } : {}),
      ...(thumb && thumb.startsWith('https://') && thumb.length <= 2000 ? { artworkUrl: thumb } : {}),
    };
    if (isLiked) liked.push(track);
    else playlists.set(playlistName, [...(playlists.get(playlistName) ?? []), track]);
  }
  return { liked, playlists: [...playlists].map(([name, tracks]) => ({ name, tracks })) };
}

export interface CsvSummary {
  likes: number;
  playlists: number;
  playlistSongs: number;
  /** Songs with no YouTube id: they need the online matching of a later step, so they are not added. */
  unresolved: number;
  unresolvedTitles: string[];
}

const trackOf = (item: CsvTrack): Track => ({
  id: item.videoId!, title: item.title, artist: item.artist, durationMs: item.durationMs ?? 0, provider: 'youtube',
  ...(item.album ? { album: item.album } : {}), ...(item.artworkUrl ? { artworkUrl: item.artworkUrl } : {}),
  ...(item.artist ? { artists: [{ name: item.artist }] } : {}),
});

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function run(repo: LibraryRepository, parsed: ParsedCsv, write: boolean, now: number, tx: Parameters<Parameters<LibraryRepository['transaction']>[1]>[0]): Promise<CsvSummary> {
  const summary: CsvSummary = { likes: 0, playlists: 0, playlistSongs: 0, unresolved: 0, unresolvedTitles: [] };
  const lost = (item: CsvTrack) => { summary.unresolved += 1; if (summary.unresolvedTitles.length < 50) summary.unresolvedTitles.push(item.artist ? `${item.title} · ${item.artist}` : item.title); };
  const put = async (store: Parameters<typeof tx.put>[0], value: object) => { if (write) await tx.put(store, value); };
  const remember = async (track: Track) => {
    const key = trackKeyOf(track);
    if (!(await tx.get('tracks', key))) await put('tracks', { trackKey: key, track, updatedAt: now } satisfies StoredTrack);
    return key;
  };
  const libraried = new Set<string>();
  const ensureLibrary = async (key: string) => {
    if (libraried.has(key) || (await tx.get('library', key))) return;
    libraried.add(key);
    await put('library', { trackKey: key, addedAt: now, source: 'import:csv' } satisfies LibraryRecord);
  };

  const liked = new Set<string>();
  for (let i = 0; i < parsed.liked.length; i += 1) {
    const item = parsed.liked[i];
    if (!item.videoId) { lost(item); continue; }
    const key = await remember(trackOf(item));
    if (liked.has(key) || (await tx.get('likes', key))) continue;
    liked.add(key);
    summary.likes += 1;
    // The first row is the newest like, so it gets the latest time.
    await put('likes', { trackKey: key, likedAt: now - i } satisfies LikeRecord);
    await ensureLibrary(key);
  }

  for (const list of parsed.playlists) {
    const id = `csv:${hash(list.name)}`;
    const existing = await tx.get<PlaylistRecord>('playlists', id);
    const entries = existing ? await tx.getAllBy<PlaylistEntryRecord>('playlistEntries', 'playlistId', id) : [];
    const known = new Set(entries.map((entry) => entry.entryId));
    let position = entries.reduce((max, entry) => Math.max(max, entry.position + 1), 0);
    let added = 0;
    const seenIds = new Map<string, number>();
    for (const item of list.tracks) {
      if (!item.videoId) { lost(item); continue; }
      const key = await remember(trackOf(item));
      // The same song listed twice is two entries; the nth copy always gets the same identity.
      const nth = (seenIds.get(item.videoId) ?? 0) + 1;
      seenIds.set(item.videoId, nth);
      const entryId = `csv:${hash(list.name)}:${item.videoId}:${nth}`;
      if (known.has(entryId)) continue;
      known.add(entryId);
      added += 1;
      await put('playlistEntries', { entryId, playlistId: id, position: position++, trackKey: key, addedAt: now, importKey: entryId } satisfies PlaylistEntryRecord);
      await ensureLibrary(key);
    }
    if (!existing) {
      summary.playlists += 1;
      await put('playlists', { id, name: list.name.slice(0, 200), createdAt: now, updatedAt: now, source: { provider: 'csv', id: list.name, title: list.name, importedAt: now } } satisfies PlaylistRecord);
    } else if (added > 0) await put('playlists', { ...existing, updatedAt: now });
    summary.playlistSongs += added;
  }
  return summary;
}

const STORES = ['tracks', 'library', 'likes', 'playlists', 'playlistEntries'] as const;
export const importCsv = (repo: LibraryRepository, parsed: ParsedCsv, now = Date.now()) => repo.transaction(STORES, (tx) => run(repo, parsed, true, now, tx));
export const previewCsv = (repo: LibraryRepository, parsed: ParsedCsv) => repo.read(STORES, (tx) => run(repo, parsed, false, Date.now(), tx as never));
