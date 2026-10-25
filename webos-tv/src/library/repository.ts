import { entityKey, newEntryId, trackKeyOf, type EntityRef } from '../domain/entity';
import type { Track } from '../model';
import { sanitizeArtist } from '../features/home/model';
import { StorageError, type Db, type StoreName, type Tx } from './db';
import type {
  ImportLogRecord,
  AssetRecord,
  AssetState,
  HistoryRecord,
  LibraryRecord,
  LikeRecord,
  LyricsChoiceRecord,
  LyricsEditRecord,
  MappingRecord,
  PinRecord,
  PlaylistEntry,
  PlaylistEntryRecord,
  PlaylistRecord,
  PlaylistSource,
  PrefRecord,
  SavedEntity,
  SessionRecord,
  StoredTrack,
} from './types';
import { tr } from '../app/i18n';

export type DuplicatePolicy = 'add' | 'skip';

export interface AddToPlaylistResult {
  added: PlaylistEntry[];
  skipped: Track[];
}

export interface PlayCount {
  trackKey: string;
  plays: number;
  listenedMs: number;
  lastPlayedAt: number;
}

export interface AssetInventoryItem {
  assetId: string;
  bytes: number;
  state: 'ready' | 'staging';
}

export interface ReconcileSummary {
  ready: number;
  missing: number;
  failed: number;
  /** Files on the service that no metadata refers to; the caller should delete them. */
  orphans: string[];
}

const MAX_PLAYLIST_NAME = 120;

function sortByPosition<T extends { position: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.position - b.position);
}

/** Methods whose success changes what the Library, playlists, pins or offline assets show. */
const CHANGING_METHODS = [
  'upsertTracks', 'addToLibrary', 'removeFromLibrary', 'setLiked', 'pin', 'unpin', 'saveEntity', 'unsaveEntity', 'createPlaylist',
  'renamePlaylist', 'deletePlaylist', 'addToPlaylist', 'removeEntry', 'moveEntry', 'registerAsset', 'setAssetState', 'removeAsset', 'reconcileAssets', 'recordPlay', 'deletePlay', 'clearHistory', 'logImport', 'clearImportLog',
] as const;

export class LibraryRepository {
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly db: Db,
    private readonly now: () => number = () => Date.now(),
  ) {
    // Pages that list the collection refresh when something they show changed, whoever changed it.
    // A failed write throws before the notification, so a failed change never looks like a success.
    const self = this as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    for (const name of CHANGING_METHODS) {
      const original = self[name].bind(this);
      self[name] = async (...args: unknown[]) => {
        const result = await original(...args);
        this.notify();
        return result;
      };
    }
  }

  /** Called after every successful change to library data. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try { listener(); } catch { /* one broken listener must not hide the change from the others */ }
    }
  }

  /** Escape hatch for multi-step operations such as backup restore: all-or-nothing. */
  async transaction<T>(stores: readonly StoreName[], fn: (tx: Tx) => Promise<T>): Promise<T> {
    const result = await this.db.tx(stores, 'rw', fn);
    this.notify();
    return result;
  }

  read<T>(stores: readonly StoreName[], fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.tx(stores, 'r', fn);
  }

  // ---- tracks -------------------------------------------------------------------------------

  async upsertTracks(tracks: readonly Track[]): Promise<void> {
    await this.db.tx(['tracks'], 'rw', async (tx) => {
      for (const track of tracks) await this.putTrack(tx, track);
    });
  }

  private async putTrack(tx: Tx, track: Track): Promise<string> {
    const trackKey = trackKeyOf(track);
    const record: StoredTrack = { trackKey, track: { ...track, artist: sanitizeArtist(track.artist), provider: track.provider ?? 'youtube' }, updatedAt: this.now() };
    await tx.put('tracks', record);
    return trackKey;
  }

  /** A song saved without a length gets the one the player found; a known length is left alone. */
  async learnDuration(trackKey: string, durationMs: number): Promise<void> {
    if (!(durationMs > 0)) return;
    await this.db.tx(['tracks'], 'rw', async (tx) => {
      const stored = await tx.get<StoredTrack>('tracks', trackKey);
      if (stored && !(stored.track.durationMs > 0)) await tx.put('tracks', { ...stored, track: { ...stored.track, durationMs } });
    });
  }

  /** Saved songs whose artist is really a copied subtitle ("Lagu • 4.02") get their artist back; returns how many changed. */
  async repairTrackArtists(): Promise<number> {
    return this.db.tx(['tracks'], 'rw', async (tx) => {
      let fixed = 0;
      for (const stored of await tx.getAll<StoredTrack>('tracks')) {
        const artist = sanitizeArtist(stored.track.artist);
        if (artist !== stored.track.artist) { await tx.put('tracks', { ...stored, track: { ...stored.track, artist } }); fixed += 1; }
      }
      return fixed;
    });
  }

  async getTrack(trackKey: string): Promise<Track | undefined> {
    return this.db.tx(['tracks'], 'r', async (tx) => (await tx.get<StoredTrack>('tracks', trackKey))?.track);
  }

  async getTracks(keys: readonly string[]): Promise<Map<string, Track>> {
    return this.db.tx(['tracks'], 'r', async (tx) => {
      const found = new Map<string, Track>();
      for (const key of keys) {
        const record = await tx.get<StoredTrack>('tracks', key);
        if (record) found.set(key, record.track);
      }
      return found;
    });
  }

  // ---- library ------------------------------------------------------------------------------

  async addToLibrary(track: Track, source = 'manual'): Promise<void> {
    await this.db.tx(['tracks', 'library'], 'rw', async (tx) => {
      const trackKey = await this.putTrack(tx, track);
      const existing = await tx.get<LibraryRecord>('library', trackKey);
      if (existing) return;
      await tx.put('library', { trackKey, addedAt: this.now(), source } satisfies LibraryRecord);
    });
  }

  async removeFromLibrary(trackKey: string): Promise<void> {
    await this.db.tx(['library'], 'rw', (tx) => tx.delete('library', trackKey));
  }

  async isInLibrary(trackKey: string): Promise<boolean> {
    return this.db.tx(['library'], 'r', async (tx) => (await tx.get('library', trackKey)) !== undefined);
  }

  /** Most recently added first. */
  async listLibrary(): Promise<Array<LibraryRecord & { track?: Track }>> {
    return this.db.tx(['library', 'tracks'], 'r', async (tx) => {
      const records = (await tx.getAll<LibraryRecord>('library')).sort((a, b) => b.addedAt - a.addedAt);
      const result: Array<LibraryRecord & { track?: Track }> = [];
      for (const record of records) {
        const stored = await tx.get<StoredTrack>('tracks', record.trackKey);
        result.push({ ...record, track: stored?.track });
      }
      return result;
    });
  }

  // ---- likes --------------------------------------------------------------------------------

  /** Liking a track also makes it part of the Library, like on Android. */
  async setLiked(track: Track, liked: boolean): Promise<void> {
    await this.db.tx(['tracks', 'likes', 'library'], 'rw', async (tx) => {
      const trackKey = await this.putTrack(tx, track);
      if (!liked) {
        await tx.delete('likes', trackKey);
        return;
      }
      if (!(await tx.get('likes', trackKey))) await tx.put('likes', { trackKey, likedAt: this.now() } satisfies LikeRecord);
      if (!(await tx.get('library', trackKey))) {
        await tx.put('library', { trackKey, addedAt: this.now(), source: 'like' } satisfies LibraryRecord);
      }
    });
    for (const listener of [...this.likeListeners]) { try { listener(track, liked); } catch { /* a listener must not undo a saved like */ } }
  }

  private readonly likeListeners = new Set<(track: Track, liked: boolean) => void>();
  /** Told after a like or unlike was saved (scrobbling services get a "love"). */
  onLikeChanged(listener: (track: Track, liked: boolean) => void): () => void {
    this.likeListeners.add(listener);
    return () => { this.likeListeners.delete(listener); };
  }

  async isLiked(trackKey: string): Promise<boolean> {
    return this.db.tx(['likes'], 'r', async (tx) => (await tx.get('likes', trackKey)) !== undefined);
  }

  async listLiked(): Promise<Array<LikeRecord & { track?: Track }>> {
    return this.db.tx(['likes', 'tracks'], 'r', async (tx) => {
      const likes = (await tx.getAll<LikeRecord>('likes')).sort((a, b) => b.likedAt - a.likedAt);
      const result: Array<LikeRecord & { track?: Track }> = [];
      for (const like of likes) result.push({ ...like, track: (await tx.get<StoredTrack>('tracks', like.trackKey))?.track });
      return result;
    });
  }

  // ---- pins and saved entities --------------------------------------------------------------

  async pin(ref: EntityRef): Promise<void> {
    await this.db.tx(['pins'], 'rw', async (tx) => {
      const key = entityKey(ref);
      if (await tx.get('pins', key)) return;
      const pins = await tx.getAll<PinRecord>('pins');
      const position = pins.reduce((max, pin) => Math.max(max, pin.position + 1), 0);
      await tx.put('pins', { key, ref, position, pinnedAt: this.now() } satisfies PinRecord);
    });
  }

  async unpin(ref: EntityRef): Promise<void> {
    await this.db.tx(['pins'], 'rw', async (tx) => {
      await tx.delete('pins', entityKey(ref));
      const rest = sortByPosition(await tx.getAll<PinRecord>('pins'));
      for (let i = 0; i < rest.length; i++) if (rest[i].position !== i) await tx.put('pins', { ...rest[i], position: i });
    });
  }

  async listPins(): Promise<PinRecord[]> {
    return this.db.tx(['pins'], 'r', async (tx) => sortByPosition(await tx.getAll<PinRecord>('pins')));
  }

  async saveEntity(entity: Omit<SavedEntity, 'key' | 'savedAt'>): Promise<void> {
    await this.db.tx(['savedEntities'], 'rw', async (tx) => {
      const key = entityKey(entity.ref);
      const existing = await tx.get<SavedEntity>('savedEntities', key);
      await tx.put('savedEntities', { ...entity, key, savedAt: existing?.savedAt ?? this.now() } satisfies SavedEntity);
    });
  }

  async unsaveEntity(ref: EntityRef): Promise<void> {
    await this.db.tx(['savedEntities'], 'rw', (tx) => tx.delete('savedEntities', entityKey(ref)));
  }

  async listSavedEntities(kind?: EntityRef['kind']): Promise<SavedEntity[]> {
    return this.db.tx(['savedEntities'], 'r', async (tx) =>
      (await tx.getAll<SavedEntity>('savedEntities'))
        .filter((item) => !kind || item.ref.kind === kind)
        .sort((a, b) => b.savedAt - a.savedAt),
    );
  }

  // ---- playlists ----------------------------------------------------------------------------

  async createPlaylist(name: string, options: { id?: string; source?: PlaylistSource } = {}): Promise<PlaylistRecord> {
    const trimmed = name.trim().slice(0, MAX_PLAYLIST_NAME);
    if (!trimmed) throw new StorageError('failed', tr('err.pl.nameEmpty'));
    const at = this.now();
    const record: PlaylistRecord = {
      id: options.id ?? newEntryId('pl'),
      name: trimmed,
      createdAt: at,
      updatedAt: at,
      ...(options.source ? { source: options.source } : {}),
    };
    await this.db.tx(['playlists'], 'rw', async (tx) => {
      if (await tx.get('playlists', record.id)) throw new StorageError('failed', tr('err.pl.exists'));
      await tx.put('playlists', record);
    });
    return record;
  }

  async renamePlaylist(id: string, name: string): Promise<void> {
    const trimmed = name.trim().slice(0, MAX_PLAYLIST_NAME);
    if (!trimmed) throw new StorageError('failed', tr('err.pl.nameEmpty'));
    await this.db.tx(['playlists'], 'rw', async (tx) => {
      const playlist = await tx.get<PlaylistRecord>('playlists', id);
      if (!playlist) throw new StorageError('failed', tr('err.pl.notFound'));
      await tx.put('playlists', { ...playlist, name: trimmed, updatedAt: this.now() });
    });
  }

  async deletePlaylist(id: string): Promise<void> {
    await this.db.tx(['playlists', 'playlistEntries'], 'rw', async (tx) => {
      const entries = await tx.getAllBy<PlaylistEntryRecord>('playlistEntries', 'playlistId', id);
      for (const entry of entries) await tx.delete('playlistEntries', entry.entryId);
      await tx.delete('playlists', id);
    });
  }

  async listPlaylists(): Promise<Array<PlaylistRecord & { trackCount: number }>> {
    return this.db.tx(['playlists', 'playlistEntries'], 'r', async (tx) => {
      const playlists = await tx.getAll<PlaylistRecord>('playlists');
      const entries = await tx.getAll<PlaylistEntryRecord>('playlistEntries');
      const counts = new Map<string, number>();
      for (const entry of entries) counts.set(entry.playlistId, (counts.get(entry.playlistId) ?? 0) + 1);
      return playlists
        .map((playlist) => ({ ...playlist, trackCount: counts.get(playlist.id) ?? 0 }))
        .sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
    });
  }

  /** Playlists with their size and the artwork of their first songs (a cover collage), most recently changed first. */
  async listPlaylistPreviews(coverCount = 4): Promise<Array<PlaylistRecord & { trackCount: number; covers: string[] }>> {
    return this.db.tx(['playlists', 'playlistEntries', 'tracks'], 'r', async (tx) => {
      const playlists = await tx.getAll<PlaylistRecord>('playlists');
      const entries = await tx.getAll<PlaylistEntryRecord>('playlistEntries');
      const byPlaylist = new Map<string, PlaylistEntryRecord[]>();
      for (const entry of entries) {
        const list = byPlaylist.get(entry.playlistId) ?? [];
        list.push(entry);
        byPlaylist.set(entry.playlistId, list);
      }
      const trackArt = new Map<string, string | undefined>();
      const result: Array<PlaylistRecord & { trackCount: number; covers: string[] }> = [];
      for (const playlist of playlists) {
        const ordered = sortByPosition(byPlaylist.get(playlist.id) ?? []);
        const covers: string[] = [];
        for (const entry of ordered) {
          if (covers.length >= coverCount) break;
          if (!trackArt.has(entry.trackKey)) trackArt.set(entry.trackKey, (await tx.get<StoredTrack>('tracks', entry.trackKey))?.track.artworkUrl);
          const art = trackArt.get(entry.trackKey);
          if (art && !covers.includes(art)) covers.push(art);
        }
        result.push({ ...playlist, trackCount: ordered.length, covers });
      }
      return result.sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
    });
  }

  async getPlaylist(id: string): Promise<{ playlist: PlaylistRecord; entries: PlaylistEntry[] } | undefined> {
    return this.db.tx(['playlists', 'playlistEntries', 'tracks'], 'r', async (tx) => {
      const playlist = await tx.get<PlaylistRecord>('playlists', id);
      if (!playlist) return undefined;
      const records = sortByPosition(await tx.getAllBy<PlaylistEntryRecord>('playlistEntries', 'playlistId', id));
      const entries: PlaylistEntry[] = [];
      for (const record of records) {
        entries.push({ ...record, track: (await tx.get<StoredTrack>('tracks', record.trackKey))?.track });
      }
      return { playlist, entries };
    });
  }

  /** Which of these tracks are already in the playlist (drives the duplicate dialog). */
  async findDuplicates(playlistId: string, trackKeys: readonly string[]): Promise<string[]> {
    return this.db.tx(['playlistEntries'], 'r', async (tx) => {
      const present = new Set((await tx.getAllBy<PlaylistEntryRecord>('playlistEntries', 'playlistId', playlistId)).map((e) => e.trackKey));
      return trackKeys.filter((key) => present.has(key));
    });
  }

  async addToPlaylist(
    playlistId: string,
    tracks: readonly Track[],
    options: { onDuplicate?: DuplicatePolicy; importKeys?: readonly (string | undefined)[] } = {},
  ): Promise<AddToPlaylistResult> {
    const policy = options.onDuplicate ?? 'add';
    return this.db.tx(['playlists', 'playlistEntries', 'tracks'], 'rw', async (tx) => {
      const playlist = await tx.get<PlaylistRecord>('playlists', playlistId);
      if (!playlist) throw new StorageError('failed', tr('err.pl.notFound'));
      const existing = await tx.getAllBy<PlaylistEntryRecord>('playlistEntries', 'playlistId', playlistId);
      const present = new Set(existing.map((entry) => entry.trackKey));
      const importKeys = new Set(existing.map((entry) => entry.importKey).filter((key): key is string => !!key));
      let position = existing.reduce((max, entry) => Math.max(max, entry.position + 1), 0);
      const added: PlaylistEntry[] = [];
      const skipped: Track[] = [];
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        const importKey = options.importKeys?.[i];
        const trackKey = await this.putTrack(tx, track);
        if ((importKey && importKeys.has(importKey)) || (policy === 'skip' && present.has(trackKey))) {
          skipped.push(track);
          continue;
        }
        const record: PlaylistEntryRecord = {
          entryId: newEntryId('pe'),
          playlistId,
          position: position++,
          trackKey,
          addedAt: this.now(),
          ...(importKey ? { importKey } : {}),
        };
        await tx.put('playlistEntries', record);
        present.add(trackKey);
        if (importKey) importKeys.add(importKey);
        added.push({ ...record, track });
      }
      await tx.put('playlists', { ...playlist, updatedAt: this.now() });
      return { added, skipped };
    });
  }

  async removeEntry(entryId: string): Promise<void> {
    await this.db.tx(['playlists', 'playlistEntries'], 'rw', async (tx) => {
      const entry = await tx.get<PlaylistEntryRecord>('playlistEntries', entryId);
      if (!entry) return;
      await tx.delete('playlistEntries', entryId);
      const rest = sortByPosition(await tx.getAllBy<PlaylistEntryRecord>('playlistEntries', 'playlistId', entry.playlistId));
      for (let i = 0; i < rest.length; i++) if (rest[i].position !== i) await tx.put('playlistEntries', { ...rest[i], position: i });
      const playlist = await tx.get<PlaylistRecord>('playlists', entry.playlistId);
      if (playlist) await tx.put('playlists', { ...playlist, updatedAt: this.now() });
    });
  }

  async moveEntry(entryId: string, toIndex: number): Promise<void> {
    await this.db.tx(['playlists', 'playlistEntries'], 'rw', async (tx) => {
      const entry = await tx.get<PlaylistEntryRecord>('playlistEntries', entryId);
      if (!entry) throw new StorageError('failed', tr('err.pl.entryNotFound'));
      const ordered = sortByPosition(await tx.getAllBy<PlaylistEntryRecord>('playlistEntries', 'playlistId', entry.playlistId));
      const from = ordered.findIndex((item) => item.entryId === entryId);
      const target = Math.max(0, Math.min(ordered.length - 1, Math.trunc(toIndex)));
      const [moved] = ordered.splice(from, 1);
      ordered.splice(target, 0, moved);
      for (let i = 0; i < ordered.length; i++) if (ordered[i].position !== i) await tx.put('playlistEntries', { ...ordered[i], position: i });
      const playlist = await tx.get<PlaylistRecord>('playlists', entry.playlistId);
      if (playlist) await tx.put('playlists', { ...playlist, updatedAt: this.now() });
    });
  }

  // ---- history ------------------------------------------------------------------------------

  /** Idempotent: recording the same `id` again (crash recovery, repeated import) changes nothing. */
  async recordPlay(play: { id: string; track: Track; sessionId: string; startedAt: number; listenedMs: number }): Promise<boolean> {
    return this.db.tx(['history', 'tracks'], 'rw', async (tx) => {
      if (await tx.get('history', play.id)) return false;
      const trackKey = await this.putTrack(tx, play.track);
      await tx.put('history', {
        id: play.id,
        trackKey,
        sessionId: play.sessionId,
        startedAt: play.startedAt,
        listenedMs: Math.max(0, Math.round(play.listenedMs)),
      } satisfies HistoryRecord);
      return true;
    });
  }

  /** Raises the listening time of an event that is still being played; never lowers it, never creates one. */
  async extendPlay(id: string, listenedMs: number): Promise<boolean> {
    return this.db.tx(['history'], 'rw', async (tx) => {
      const existing = await tx.get<HistoryRecord>('history', id);
      const next = Math.max(0, Math.round(listenedMs));
      if (!existing || next <= existing.listenedMs) return false;
      await tx.put('history', { ...existing, listenedMs: next } satisfies HistoryRecord);
      return true;
    });
  }

  async deletePlay(id: string): Promise<void> {
    await this.db.tx(['history'], 'rw', (tx) => tx.delete('history', id));
  }

  async listHistory(options: { limit?: number; sinceMs?: number } = {}): Promise<Array<HistoryRecord & { track?: Track }>> {
    return this.db.tx(['history', 'tracks'], 'r', async (tx) => {
      const all = (await tx.getAll<HistoryRecord>('history'))
        .filter((item) => options.sinceMs === undefined || item.startedAt >= options.sinceMs)
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, options.limit ?? Number.MAX_SAFE_INTEGER);
      const result: Array<HistoryRecord & { track?: Track }> = [];
      for (const item of all) result.push({ ...item, track: (await tx.get<StoredTrack>('tracks', item.trackKey))?.track });
      return result;
    });
  }

  async playCounts(options: { sinceMs?: number } = {}): Promise<PlayCount[]> {
    const history = await this.db.tx(['history'], 'r', (tx) => tx.getAll<HistoryRecord>('history'));
    const counts = new Map<string, PlayCount>();
    for (const item of history) {
      if (options.sinceMs !== undefined && item.startedAt < options.sinceMs) continue;
      const current = counts.get(item.trackKey) ?? { trackKey: item.trackKey, plays: 0, listenedMs: 0, lastPlayedAt: 0 };
      current.plays += 1;
      current.listenedMs += item.listenedMs;
      current.lastPlayedAt = Math.max(current.lastPlayedAt, item.startedAt);
      counts.set(item.trackKey, current);
    }
    return [...counts.values()].sort((a, b) => b.plays - a.plays || b.listenedMs - a.listenedMs || b.lastPlayedAt - a.lastPlayedAt);
  }

  async totalListenedMs(options: { sinceMs?: number } = {}): Promise<number> {
    return (await this.playCounts(options)).reduce((sum, item) => sum + item.listenedMs, 0);
  }

  async clearHistory(): Promise<void> {
    await this.db.tx(['history'], 'rw', (tx) => tx.clear('history'));
  }

  // ---- import history -------------------------------------------------------------------------

  async logImport(record: ImportLogRecord, keep = 100): Promise<void> {
    await this.db.tx(['importLog'], 'rw', async (tx) => {
      await tx.put('importLog', record);
      const all = (await tx.getAll<ImportLogRecord>('importLog')).sort((a, b) => b.at - a.at);
      for (const old of all.slice(keep)) await tx.delete('importLog', old.id);
    });
  }

  async importLog(): Promise<ImportLogRecord[]> {
    return this.db.tx(['importLog'], 'r', async (tx) => (await tx.getAll<ImportLogRecord>('importLog')).sort((a, b) => b.at - a.at));
  }

  async clearImportLog(): Promise<void> {
    await this.db.tx(['importLog'], 'rw', (tx) => tx.clear('importLog'));
  }

  // ---- search history -----------------------------------------------------------------------

  async rememberSearch(query: string, limit = 30): Promise<void> {
    const trimmed = query.trim();
    if (!trimmed) return;
    await this.db.tx(['searchHistory'], 'rw', async (tx) => {
      await tx.put('searchHistory', { query: trimmed, at: this.now() });
      const all = (await tx.getAll<{ query: string; at: number }>('searchHistory')).sort((a, b) => b.at - a.at);
      for (const stale of all.slice(limit)) await tx.delete('searchHistory', stale.query);
    });
  }

  async listSearches(): Promise<string[]> {
    return this.db.tx(['searchHistory'], 'r', async (tx) =>
      (await tx.getAll<{ query: string; at: number }>('searchHistory')).sort((a, b) => b.at - a.at).map((item) => item.query),
    );
  }

  async forgetSearch(query: string): Promise<void> {
    await this.db.tx(['searchHistory'], 'rw', (tx) => tx.delete('searchHistory', query));
  }

  async clearSearches(): Promise<void> {
    await this.db.tx(['searchHistory'], 'rw', (tx) => tx.clear('searchHistory'));
  }

  // ---- lyrics -------------------------------------------------------------------------------

  async saveLyricsEdit(trackKey: string, lrc: string): Promise<void> {
    await this.db.tx(['lyricsEdits'], 'rw', (tx) =>
      tx.put('lyricsEdits', { trackKey, lrc, editedAt: this.now(), provider: 'UserEdited' } satisfies LyricsEditRecord),
    );
  }

  async getLyricsEdit(trackKey: string): Promise<LyricsEditRecord | undefined> {
    return this.db.tx(['lyricsEdits'], 'r', (tx) => tx.get<LyricsEditRecord>('lyricsEdits', trackKey));
  }

  async deleteLyricsEdit(trackKey: string): Promise<void> {
    await this.db.tx(['lyricsEdits'], 'rw', (tx) => tx.delete('lyricsEdits', trackKey));
  }

  async setLyricsChoice(trackKey: string, provider: string | null): Promise<void> {
    await this.db.tx(['lyricsChoice'], 'rw', async (tx) => {
      if (provider === null) await tx.delete('lyricsChoice', trackKey);
      else await tx.put('lyricsChoice', { trackKey, provider, chosenAt: this.now() } satisfies LyricsChoiceRecord);
    });
  }

  async getLyricsChoice(trackKey: string): Promise<string | undefined> {
    return this.db.tx(['lyricsChoice'], 'r', async (tx) => (await tx.get<LyricsChoiceRecord>('lyricsChoice', trackKey))?.provider);
  }

  // ---- preferences and session --------------------------------------------------------------

  async getPref<T>(key: string): Promise<T | undefined> {
    return this.db.tx(['prefs'], 'r', async (tx) => (await tx.get<PrefRecord>('prefs', key))?.value as T | undefined);
  }

  async getAllPrefs(): Promise<Record<string, unknown>> {
    return this.db.tx(['prefs'], 'r', async (tx) => {
      const result: Record<string, unknown> = {};
      for (const item of await tx.getAll<PrefRecord>('prefs')) result[item.key] = item.value;
      return result;
    });
  }

  async setPref(key: string, value: unknown): Promise<void> {
    await this.db.tx(['prefs'], 'rw', (tx) => tx.put('prefs', { key, value, updatedAt: this.now() } satisfies PrefRecord));
  }

  async deletePref(key: string): Promise<void> {
    await this.db.tx(['prefs'], 'rw', (tx) => tx.delete('prefs', key));
  }

  // ---- generic metadata (caches, schema info) -----------------------------------------------

  async getMeta<T>(key: string): Promise<T | undefined> {
    return this.db.tx(['meta'], 'r', async (tx) => (await tx.get<{ key: string; value: T }>('meta', key))?.value);
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.tx(['meta'], 'rw', (tx) => tx.put('meta', { key, value }));
  }

  async saveSession(data: unknown): Promise<void> {
    await this.db.tx(['session'], 'rw', (tx) => tx.put('session', { key: 'current', savedAt: this.now(), data } satisfies SessionRecord));
  }

  async loadSession<T>(): Promise<{ savedAt: number; data: T } | undefined> {
    return this.db.tx(['session'], 'r', async (tx) => {
      const record = await tx.get<SessionRecord>('session', 'current');
      return record ? { savedAt: record.savedAt, data: record.data as T } : undefined;
    });
  }

  async clearSession(): Promise<void> {
    await this.db.tx(['session'], 'rw', (tx) => tx.delete('session', 'current'));
  }

  // ---- recording mappings -------------------------------------------------------------------

  async mapRecordings(a: string, b: string, confidence: number): Promise<void> {
    const [first, second] = a < b ? [a, b] : [b, a];
    await this.db.tx(['mappings'], 'rw', (tx) =>
      tx.put('mappings', { id: `${first}|${second}`, a: first, b: second, confidence, createdAt: this.now() } satisfies MappingRecord),
    );
  }

  async equivalentsOf(trackKey: string): Promise<string[]> {
    return this.db.tx(['mappings'], 'r', async (tx) =>
      (await tx.getAll<MappingRecord>('mappings')).flatMap((m) => (m.a === trackKey ? [m.b] : m.b === trackKey ? [m.a] : [])),
    );
  }

  // ---- media assets -------------------------------------------------------------------------

  async registerAsset(asset: { assetId: string; trackKey: string; kind: AssetRecord['kind']; state?: AssetState; bytes?: number; needsTransfer?: boolean }): Promise<void> {
    await this.db.tx(['assets'], 'rw', (tx) =>
      tx.put('assets', {
        assetId: asset.assetId,
        trackKey: asset.trackKey,
        kind: asset.kind,
        state: asset.state ?? 'staging',
        bytes: asset.bytes ?? 0,
        updatedAt: this.now(),
        ...(asset.needsTransfer ? { needsTransfer: true } : {}),
      } satisfies AssetRecord),
    );
  }

  async setAssetState(assetId: string, state: AssetState, patch: { bytes?: number; detail?: string } = {}): Promise<void> {
    await this.db.tx(['assets'], 'rw', async (tx) => {
      const asset = await tx.get<AssetRecord>('assets', assetId);
      if (!asset) throw new StorageError('failed', tr('err.media.notFound'));
      const next: AssetRecord = { ...asset, state, updatedAt: this.now(), ...patch };
      if (state === 'ready') delete next.needsTransfer;
      await tx.put('assets', next);
    });
  }

  async listAssets(trackKey?: string): Promise<AssetRecord[]> {
    return this.db.tx(['assets'], 'r', async (tx) =>
      trackKey ? tx.getAllBy<AssetRecord>('assets', 'trackKey', trackKey) : tx.getAll<AssetRecord>('assets'),
    );
  }

  async removeAsset(assetId: string): Promise<void> {
    await this.db.tx(['assets'], 'rw', (tx) => tx.delete('assets', assetId));
  }

  /**
   * Startup reconciliation with the files the native service actually holds. Library metadata is
   * never touched: only the asset state changes.
   */
  async reconcileAssets(inventory: readonly AssetInventoryItem[]): Promise<ReconcileSummary> {
    return this.db.tx(['assets'], 'rw', async (tx) => {
      const byId = new Map(inventory.map((item) => [item.assetId, item]));
      const known = await tx.getAll<AssetRecord>('assets');
      const summary: ReconcileSummary = { ready: 0, missing: 0, failed: 0, orphans: [] };
      for (const asset of known) {
        const file = byId.get(asset.assetId);
        let next: AssetRecord = asset;
        if (file?.state === 'ready') {
          next = { ...asset, state: 'ready', bytes: file.bytes };
          delete next.needsTransfer;
          summary.ready += 1;
        } else if (asset.state === 'staging' || file?.state === 'staging') {
          next = { ...asset, state: 'failed', detail: 'Unduhan terputus sebelum selesai.' };
          summary.failed += 1;
        } else if (asset.state === 'ready') {
          next = { ...asset, state: 'missing', detail: tr('err.media.fileMissing') };
          summary.missing += 1;
        } else if (asset.state === 'missing') {
          summary.missing += 1;
        } else {
          summary.failed += 1;
        }
        if (next !== asset) await tx.put('assets', { ...next, updatedAt: this.now() });
      }
      const knownIds = new Set(known.map((asset) => asset.assetId));
      summary.orphans = inventory.filter((item) => !knownIds.has(item.assetId)).map((item) => item.assetId);
      return summary;
    });
  }
}
