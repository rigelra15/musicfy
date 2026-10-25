import { isProviderId, parseEntityKey, trackKeyOf, entityKey, type EntityRef } from '../domain/entity';
import type { Tx, StoreName } from '../library/db';
import type { PreferencesStore } from '../library/preferences';
import type { LibraryRepository } from '../library/repository';
import type {
  AssetRecord, HistoryRecord, LibraryRecord, LikeRecord, LyricsChoiceRecord, LyricsEditRecord, PinRecord, PlaylistEntryRecord, PlaylistRecord,
  PrefRecord, SavedEntity, StoredTrack,
} from '../library/types';
import type { Track } from '../model';
import { tr } from '../app/i18n';

/**
 * The Musicfy portable backup (`.musicfy.json`, version 1): the collection and the settings that
 * belong to it, as plain JSON. It never carries accounts, cookies, keys, signed URLs or media files.
 */
export const PORTABLE_FORMAT = 'musicfy-portable';
export const PORTABLE_VERSION = 1;
export const MAX_RECORDS = 200_000;
export const MAX_PINS = 9;

export class BackupError extends Error {
  readonly name = 'BackupError';
}

/** Settings that travel with a backup. Everything else (timers, caches, onboarding) stays on the TV. */
const PREF_WHITELIST: readonly string[] = [
  'ui.language', 'profile.name', 'player.appearance', 'player.menuSlots', 'player.sideButton', 'playback.speed', 'playback.autoplay',
  'content.hideExplicit', 'content.hideVideoSongs', 'history.minSeconds', 'history.paused',
  'lyrics.detail', 'lyrics.motion', 'lyrics.source', 'lyrics.translate.target', 'lyrics.translate.source', 'lyrics.readings',
];

export interface PortableBackup {
  format: typeof PORTABLE_FORMAT;
  version: typeof PORTABLE_VERSION;
  exportId: string;
  exportedAt: number;
  exporter: { app: string; version: string };
  tracks: Track[];
  library: Array<{ trackKey: string; addedAt: number; source: string }>;
  likes: Array<{ trackKey: string; likedAt: number }>;
  pins: Array<{ ref: EntityRef; position: number; pinnedAt: number }>;
  savedEntities: Array<{ ref: EntityRef; title: string; subtitle?: string; artworkUrl?: string; savedAt: number }>;
  playlists: Array<{
    id: string; name: string; createdAt: number; updatedAt: number; source?: PlaylistRecord['source'];
    entries: Array<{ entryId: string; trackKey: string; addedAt: number }>;
  }>;
  history: Array<{ id: string; trackKey: string; startedAt: number; listenedMs: number }>;
  lyricsEdits: Array<{ trackKey: string; lrc: string; editedAt: number }>;
  lyricsChoice: Array<{ trackKey: string; provider: string }>;
  prefs: Record<string, unknown>;
}

/** A backup that passed validation, with how many records were left out because they were not valid. */
export type ParsedBackup = PortableBackup & { skipped: number };

// ---- parsing ------------------------------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): string | undefined => (typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined);
const num = (value: unknown, fallback = 0): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback);
const httpsUrl = (value: unknown): string | undefined => (typeof value === 'string' && value.length <= 2000 && value.startsWith('https://') ? value : undefined);

function sanitizeTrack(raw: unknown): Track | undefined {
  if (!isObject(raw)) return undefined;
  const id = text(raw.id, 200);
  const title = text(raw.title, 500);
  if (!id || !title) return undefined;
  const provider = raw.provider === undefined ? 'youtube' : raw.provider;
  if (!isProviderId(provider)) return undefined;
  const artists = Array.isArray(raw.artists)
    ? raw.artists.filter(isObject).flatMap((artist) => { const name = text(artist.name, 300); return name ? [{ name, ...(text(artist.id, 200) ? { id: artist.id as string } : {}) }] : []; }).slice(0, 20)
    : undefined;
  const track: Track = {
    id, title, provider,
    artist: typeof raw.artist === 'string' ? raw.artist.slice(0, 500) : '',
    durationMs: num(raw.durationMs),
  };
  const album = text(raw.album, 500); if (album) track.album = album;
  const albumId = text(raw.albumId, 200); if (albumId) track.albumId = albumId;
  const artwork = httpsUrl(raw.artworkUrl); if (artwork) track.artworkUrl = artwork;
  const isrc = text(raw.isrc, 20); if (isrc) track.isrc = isrc;
  if (artists?.length) track.artists = artists;
  if (raw.explicit === true) track.explicit = true;
  if (raw.isVideo === true) track.isVideo = true;
  return track;
}

function sanitizeRef(raw: unknown): EntityRef | undefined {
  if (!isObject(raw) || !isProviderId(raw.provider) || typeof raw.id !== 'string' || !raw.id || raw.id.length > 300) return undefined;
  if (raw.kind !== 'track' && raw.kind !== 'album' && raw.kind !== 'artist' && raw.kind !== 'playlist') return undefined;
  return { provider: raw.provider, kind: raw.kind, id: raw.id };
}

/** Validates a backup (text or already parsed). Bad records are dropped and counted; a bad file is an error. */
export function parsePortable(input: unknown): ParsedBackup {
  let data = input;
  if (typeof input === 'string') {
    try { data = JSON.parse(input); } catch { throw new BackupError(tr('err.backup.unreadable')); }
  }
  if (!isObject(data)) throw new BackupError(tr('err.backup.unreadable'));
  if (data.format !== PORTABLE_FORMAT) throw new BackupError(tr('err.backup.notMusicfy'));
  if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1) throw new BackupError(tr('err.backup.version'));
  if (data.version > PORTABLE_VERSION) throw new BackupError(tr('err.backup.newer'));
  const lists = ['tracks', 'library', 'likes', 'pins', 'savedEntities', 'playlists', 'history', 'lyricsEdits', 'lyricsChoice'] as const;
  let count = 0;
  for (const name of lists) {
    const list = data[name];
    if (list !== undefined && !Array.isArray(list)) throw new BackupError(tr('err.backup.unreadable'));
    count += Array.isArray(list) ? list.length : 0;
  }
  if (count > MAX_RECORDS) throw new BackupError(tr('err.backup.tooBig'));

  let skipped = 0;
  const bad = () => { skipped += 1; };
  const list = (name: string): unknown[] => (Array.isArray(data[name]) ? (data[name] as unknown[]) : []);

  const tracks: Track[] = [];
  const known = new Set<string>();
  for (const raw of list('tracks')) {
    const track = sanitizeTrack(raw);
    if (!track) { bad(); continue; }
    const key = trackKeyOf(track);
    if (known.has(key)) continue;
    known.add(key);
    tracks.push(track);
  }
  const withTrack = (raw: unknown): raw is Record<string, unknown> & { trackKey: string } => isObject(raw) && typeof raw.trackKey === 'string' && known.has(raw.trackKey);

  const library: PortableBackup['library'] = [];
  for (const raw of list('library')) withTrack(raw) ? library.push({ trackKey: raw.trackKey, addedAt: num(raw.addedAt), source: text(raw.source, 80) ?? 'import:backup' }) : bad();
  const likes: PortableBackup['likes'] = [];
  for (const raw of list('likes')) withTrack(raw) ? likes.push({ trackKey: raw.trackKey, likedAt: num(raw.likedAt) }) : bad();
  const pins: PortableBackup['pins'] = [];
  for (const raw of list('pins')) {
    const ref = isObject(raw) ? sanitizeRef(raw.ref) : undefined;
    ref ? pins.push({ ref, position: num((raw as Record<string, unknown>).position), pinnedAt: num((raw as Record<string, unknown>).pinnedAt) }) : bad();
  }
  const savedEntities: PortableBackup['savedEntities'] = [];
  for (const raw of list('savedEntities')) {
    const ref = isObject(raw) ? sanitizeRef(raw.ref) : undefined;
    const title = isObject(raw) ? text(raw.title, 500) : undefined;
    if (!ref || !title || !isObject(raw)) { bad(); continue; }
    savedEntities.push({ ref, title, ...(text(raw.subtitle, 500) ? { subtitle: raw.subtitle as string } : {}), ...(httpsUrl(raw.artworkUrl) ? { artworkUrl: raw.artworkUrl as string } : {}), savedAt: num(raw.savedAt) });
  }
  const playlists: PortableBackup['playlists'] = [];
  for (const raw of list('playlists')) {
    const id = isObject(raw) ? text(raw.id, 200) : undefined;
    const name = isObject(raw) ? text(raw.name, 200) : undefined;
    if (!id || !name || !isObject(raw) || (raw.entries !== undefined && !Array.isArray(raw.entries))) { bad(); continue; }
    const entries: PortableBackup['playlists'][number]['entries'] = [];
    const seen = new Set<string>();
    for (const entry of (raw.entries as unknown[] | undefined) ?? []) {
      const entryId = isObject(entry) ? text(entry.entryId, 200) : undefined;
      if (!entryId || !withTrack(entry) || seen.has(entryId)) { bad(); continue; }
      seen.add(entryId);
      entries.push({ entryId, trackKey: entry.trackKey, addedAt: num(entry.addedAt) });
    }
    const source = isObject(raw.source) && typeof raw.source.provider === 'string' && typeof raw.source.id === 'string'
      ? { provider: raw.source.provider as never, id: raw.source.id.slice(0, 300), ...(text(raw.source.title, 300) ? { title: raw.source.title as string } : {}), importedAt: num(raw.source.importedAt), ...(typeof raw.source.url === 'string' && /^https:\/\//.test(raw.source.url) ? { url: raw.source.url.slice(0, 500) } : {}) }
      : undefined;
    playlists.push({ id, name, createdAt: num(raw.createdAt), updatedAt: num(raw.updatedAt), ...(source ? { source } : {}), entries });
  }
  const history: PortableBackup['history'] = [];
  for (const raw of list('history')) {
    const id = isObject(raw) ? text(raw.id, 200) : undefined;
    withTrack(raw) && id ? history.push({ id, trackKey: raw.trackKey, startedAt: num(raw.startedAt), listenedMs: num(raw.listenedMs) }) : bad();
  }
  const lyricsEdits: PortableBackup['lyricsEdits'] = [];
  for (const raw of list('lyricsEdits')) withTrack(raw) && text(raw.lrc, 500_000) ? lyricsEdits.push({ trackKey: raw.trackKey, lrc: raw.lrc as string, editedAt: num(raw.editedAt) }) : bad();
  const lyricsChoice: PortableBackup['lyricsChoice'] = [];
  for (const raw of list('lyricsChoice')) withTrack(raw) && text(raw.provider, 80) ? lyricsChoice.push({ trackKey: raw.trackKey, provider: raw.provider as string }) : bad();

  const prefs: Record<string, unknown> = {};
  if (isObject(data.prefs)) for (const key of PREF_WHITELIST) if (Object.prototype.hasOwnProperty.call(data.prefs, key)) prefs[key] = data.prefs[key];
  const exporter = isObject(data.exporter) ? { app: text(data.exporter.app, 60) ?? 'unknown', version: text(data.exporter.version, 40) ?? '' } : { app: 'unknown', version: '' };
  return {
    format: PORTABLE_FORMAT, version: PORTABLE_VERSION, exportId: text(data.exportId, 100) ?? 'unknown', exportedAt: num(data.exportedAt), exporter,
    tracks, library, likes, pins, savedEntities, playlists, history, lyricsEdits, lyricsChoice, prefs, skipped,
  };
}

// ---- export -------------------------------------------------------------------------------

const EXPORT_STORES: StoreName[] = ['tracks', 'library', 'likes', 'pins', 'savedEntities', 'playlists', 'playlistEntries', 'history', 'lyricsEdits', 'lyricsChoice'];

export async function exportPortable(repo: LibraryRepository, prefs: PreferencesStore, exporter: { app: string; version: string }, now = Date.now()): Promise<PortableBackup> {
  const data = await repo.read(EXPORT_STORES, async (tx) => ({
    tracks: await tx.getAll<StoredTrack>('tracks'),
    library: await tx.getAll<LibraryRecord>('library'),
    likes: await tx.getAll<LikeRecord>('likes'),
    pins: await tx.getAll<PinRecord>('pins'),
    saved: await tx.getAll<SavedEntity>('savedEntities'),
    playlists: await tx.getAll<PlaylistRecord>('playlists'),
    entries: await tx.getAll<PlaylistEntryRecord>('playlistEntries'),
    history: await tx.getAll<HistoryRecord>('history'),
    edits: await tx.getAll<LyricsEditRecord>('lyricsEdits'),
    choices: await tx.getAll<LyricsChoiceRecord>('lyricsChoice'),
  }));
  const entriesOf = new Map<string, PlaylistEntryRecord[]>();
  for (const entry of data.entries) entriesOf.set(entry.playlistId, [...(entriesOf.get(entry.playlistId) ?? []), entry]);
  const settings: Record<string, unknown> = {};
  const all = prefs.snapshot();
  for (const key of PREF_WHITELIST) if (key in all) settings[key] = all[key];
  return {
    format: PORTABLE_FORMAT, version: PORTABLE_VERSION, exportId: `${exporter.app}-${now.toString(36)}`, exportedAt: now, exporter,
    tracks: data.tracks.map((record) => record.track),
    library: data.library.map(({ trackKey, addedAt, source }) => ({ trackKey, addedAt, source })).sort((a, b) => a.addedAt - b.addedAt),
    likes: data.likes.map(({ trackKey, likedAt }) => ({ trackKey, likedAt })).sort((a, b) => a.likedAt - b.likedAt),
    pins: data.pins.map(({ ref, position, pinnedAt }) => ({ ref, position, pinnedAt })).sort((a, b) => a.position - b.position),
    savedEntities: data.saved.map(({ ref, title, subtitle, artworkUrl, savedAt }) => ({ ref, title, ...(subtitle ? { subtitle } : {}), ...(artworkUrl ? { artworkUrl } : {}), savedAt })),
    playlists: data.playlists.map((playlist) => ({
      id: playlist.id, name: playlist.name, createdAt: playlist.createdAt, updatedAt: playlist.updatedAt, ...(playlist.source ? { source: playlist.source } : {}),
      entries: (entriesOf.get(playlist.id) ?? []).sort((a, b) => a.position - b.position).map(({ entryId, trackKey, addedAt }) => ({ entryId, trackKey, addedAt })),
    })),
    history: data.history.map(({ id, trackKey, startedAt, listenedMs }) => ({ id, trackKey, startedAt, listenedMs })).sort((a, b) => a.startedAt - b.startedAt),
    lyricsEdits: data.edits.map(({ trackKey, lrc, editedAt }) => ({ trackKey, lrc, editedAt })),
    lyricsChoice: data.choices.map(({ trackKey, provider }) => ({ trackKey, provider })),
    prefs: settings,
  };
}

// ---- import -------------------------------------------------------------------------------

export type ImportMode = 'merge' | 'replace';
export interface Counts { songs: number; likes: number; pins: number; saved: number; playlists: number; playlistSongs: number; history: number; lyrics: number }
export interface ImportSummary {
  mode: ImportMode;
  /** What the file holds. */
  total: Counts;
  /** What is new on this TV (merge) or everything (replace). */
  added: Counts;
  /** What a replace takes away; all zero for a merge. */
  removed: Counts;
  /** Records in the file that were not valid and were left out. */
  skipped: number;
  /** Songs that are files on the phone: their entries come back, the files must be sent again. */
  needsTransfer: number;
}
const zero = (): Counts => ({ songs: 0, likes: 0, pins: 0, saved: 0, playlists: 0, playlistSongs: 0, history: 0, lyrics: 0 });
const WRITE_STORES: StoreName[] = ['tracks', 'library', 'likes', 'pins', 'savedEntities', 'playlists', 'playlistEntries', 'history', 'lyricsEdits', 'lyricsChoice', 'assets', 'prefs'];
const COLLECTION_STORES: StoreName[] = ['library', 'likes', 'pins', 'savedEntities', 'playlists', 'playlistEntries', 'history', 'lyricsEdits', 'lyricsChoice'];

/** Everything a backup from another app writes gets a prefix, so it can never collide with ids made on this TV. */
const namespaced = (backup: ParsedBackup) => (id: string) => (backup.exporter.app === 'musicfy-tv' ? id : `${backup.exporter.app}:${id}`);

async function run(tx: Tx, backup: ParsedBackup, mode: ImportMode, write: boolean, now: number): Promise<ImportSummary> {
  const ns = namespaced(backup);
  const added = zero();
  const removed = zero();
  const put = async (store: StoreName, value: object) => { if (write) await tx.put(store, value); };

  const existing = async <T>(store: StoreName): Promise<T[]> => (mode === 'replace' ? [] : tx.getAll<T>(store));
  if (mode === 'replace') {
    const count = async (store: StoreName) => (await tx.getAll(store)).length;
    removed.songs = await count('library'); removed.likes = await count('likes'); removed.pins = await count('pins'); removed.saved = await count('savedEntities');
    removed.playlists = await count('playlists'); removed.playlistSongs = await count('playlistEntries'); removed.history = await count('history'); removed.lyrics = await count('lyricsEdits');
    if (write) for (const store of COLLECTION_STORES) await tx.clear(store);
  }

  for (const track of backup.tracks) {
    const key = trackKeyOf(track);
    if (mode === 'merge' && (await tx.get('tracks', key))) continue;
    await put('tracks', { trackKey: key, track, updatedAt: now } satisfies StoredTrack);
  }

  const haveLibrary = new Set((await existing<LibraryRecord>('library')).map((r) => r.trackKey));
  for (const item of backup.library) if (!haveLibrary.has(item.trackKey)) { haveLibrary.add(item.trackKey); added.songs += 1; await put('library', { ...item, addedAt: item.addedAt || now } satisfies LibraryRecord); }

  const haveLikes = new Set((await existing<LikeRecord>('likes')).map((r) => r.trackKey));
  for (const item of backup.likes) {
    if (haveLikes.has(item.trackKey)) continue;
    haveLikes.add(item.trackKey); added.likes += 1;
    await put('likes', { trackKey: item.trackKey, likedAt: item.likedAt || now } satisfies LikeRecord);
    if (!haveLibrary.has(item.trackKey)) { haveLibrary.add(item.trackKey); added.songs += 1; await put('library', { trackKey: item.trackKey, addedAt: item.likedAt || now, source: 'like' } satisfies LibraryRecord); }
  }

  const pins = [...(await existing<PinRecord>('pins'))];
  let skippedPins = 0;
  for (const item of [...backup.pins].sort((a, b) => a.position - b.position)) {
    const key = entityKey(item.ref);
    if (pins.some((pin) => pin.key === key)) continue;
    if (pins.length >= MAX_PINS) { skippedPins += 1; continue; }
    const record: PinRecord = { key, ref: item.ref, position: pins.reduce((max, pin) => Math.max(max, pin.position + 1), 0), pinnedAt: item.pinnedAt || now };
    pins.push(record); added.pins += 1;
    await put('pins', record);
  }

  const haveSaved = new Set((await existing<SavedEntity>('savedEntities')).map((r) => r.key));
  for (const item of backup.savedEntities) {
    const key = entityKey(item.ref);
    if (haveSaved.has(key)) continue;
    haveSaved.add(key); added.saved += 1;
    await put('savedEntities', { ...item, key, savedAt: item.savedAt || now } satisfies SavedEntity);
  }

  for (const playlist of backup.playlists) {
    const id = ns(playlist.id);
    const current = mode === 'replace' ? undefined : await tx.get<PlaylistRecord>('playlists', id);
    const entries = mode === 'replace' ? [] : await tx.getAllBy<PlaylistEntryRecord>('playlistEntries', 'playlistId', id);
    const known = new Set(entries.map((entry) => entry.entryId));
    let position = entries.reduce((max, entry) => Math.max(max, entry.position + 1), 0);
    let addedHere = 0;
    for (const entry of playlist.entries) {
      const entryId = ns(entry.entryId);
      if (known.has(entryId)) continue;
      known.add(entryId);
      addedHere += 1;
      await put('playlistEntries', { entryId, playlistId: id, position: position++, trackKey: entry.trackKey, addedAt: entry.addedAt || now, importKey: `bk:${entryId}` } satisfies PlaylistEntryRecord);
    }
    if (!current) { added.playlists += 1; await put('playlists', { id, name: playlist.name, createdAt: playlist.createdAt || now, updatedAt: now, ...(playlist.source ? { source: playlist.source } : {}) } satisfies PlaylistRecord); }
    else if (addedHere > 0) await put('playlists', { ...current, updatedAt: now });
    added.playlistSongs += addedHere;
  }

  const haveHistory = new Set((await existing<HistoryRecord>('history')).map((r) => r.id));
  for (const item of backup.history) {
    const id = ns(item.id);
    if (haveHistory.has(id)) continue;
    haveHistory.add(id); added.history += 1;
    await put('history', { id, trackKey: item.trackKey, sessionId: 'backup', startedAt: item.startedAt, listenedMs: item.listenedMs } satisfies HistoryRecord);
  }

  const haveEdits = new Set((await existing<LyricsEditRecord>('lyricsEdits')).map((r) => r.trackKey));
  for (const item of backup.lyricsEdits) {
    if (haveEdits.has(item.trackKey)) continue;
    haveEdits.add(item.trackKey); added.lyrics += 1;
    await put('lyricsEdits', { trackKey: item.trackKey, lrc: item.lrc, editedAt: item.editedAt || now, provider: 'UserEdited' } satisfies LyricsEditRecord);
  }
  const haveChoice = new Set((await existing<LyricsChoiceRecord>('lyricsChoice')).map((r) => r.trackKey));
  for (const item of backup.lyricsChoice) if (!haveChoice.has(item.trackKey)) { haveChoice.add(item.trackKey); await put('lyricsChoice', { trackKey: item.trackKey, provider: item.provider, chosenAt: now } satisfies LyricsChoiceRecord); }

  // Files that live on the phone: the entry is kept, the audio has to be sent again.
  let needsTransfer = 0;
  for (const track of backup.tracks) {
    if (track.provider !== 'local') continue;
    const key = trackKeyOf(track);
    needsTransfer += 1;
    if ((await tx.getAllBy<AssetRecord>('assets', 'trackKey', key)).length === 0) {
      await put('assets', { assetId: `local-${key}`, trackKey: key, state: 'missing', bytes: 0, updatedAt: now, kind: 'local', needsTransfer: true, detail: 'File ada di HP; kirim ulang ke TV.' } satisfies AssetRecord);
    }
  }

  for (const [key, value] of Object.entries(backup.prefs)) {
    if (mode === 'merge' && (await tx.get('prefs', key))) continue;
    await put('prefs', { key, value, updatedAt: now } satisfies PrefRecord);
  }

  const total: Counts = {
    songs: new Set([...backup.library.map((i) => i.trackKey), ...backup.likes.map((i) => i.trackKey)]).size,
    likes: backup.likes.length, pins: backup.pins.length, saved: backup.savedEntities.length, playlists: backup.playlists.length,
    playlistSongs: backup.playlists.reduce((sum, playlist) => sum + playlist.entries.length, 0), history: backup.history.length, lyrics: backup.lyricsEdits.length,
  };
  return { mode, total, added, removed, skipped: backup.skipped + skippedPins, needsTransfer };
}

/** What importing would do, without writing anything. */
export async function previewPortable(repo: LibraryRepository, backup: ParsedBackup, mode: ImportMode): Promise<ImportSummary> {
  return repo.read(WRITE_STORES, (tx) => run(tx, backup, mode, false, Date.now()));
}

/** All or nothing: a failed write leaves the TV exactly as it was. Settings already on the TV are kept in a merge. */
export async function importPortable(repo: LibraryRepository, prefs: PreferencesStore, backup: ParsedBackup, options: { mode: ImportMode; now?: number }): Promise<ImportSummary> {
  const summary = await repo.transaction(WRITE_STORES, (tx) => run(tx, backup, options.mode, true, options.now ?? Date.now()));
  await prefs.hydrate();
  return summary;
}

export { parseEntityKey };
