import { entityKey, type EntityRef } from '../../domain/entity';
import type { LibraryRepository } from '../../library/repository';
import type { PlaylistRecord, SavedEntity } from '../../library/types';
import type { Track } from '../../model';

export interface LibrarySong { trackKey: string; track: Track; addedAt: number; source: string; liked: boolean; likedAt?: number }
export interface PlaylistPreview extends PlaylistRecord { trackCount: number; covers: string[] }
/** One place songs and playlists came in from (a streaming-service import, a CSV, ...). */
export interface ImportSource { id: string; label: string; songs: LibrarySong[]; playlists: PlaylistPreview[] }
export interface PinnedItem { key: string; ref: EntityRef; title: string; subtitle?: string; artworkUrl?: string; track?: Track }

export interface LibrarySnapshot {
  status: 'loading' | 'ready' | 'error';
  error?: string;
  /** Newest first. */
  songs: LibrarySong[];
  /** Most recently liked first. */
  liked: LibrarySong[];
  albums: SavedEntity[];
  artists: SavedEntity[];
  /** Online playlists kept in the library (as opposed to playlists made on this TV). */
  onlinePlaylists: SavedEntity[];
  playlists: PlaylistPreview[];
  pins: PinnedItem[];
  /** Files from the phone that are on this TV, ready to play. */
  local: LibrarySong[];
  /** Songs saved for offline (downloads and the player cache) that are ready to play. */
  cached: LibrarySong[];
  importSources: ImportSource[];
  /** Listening time per song (ms), for "play time" sorting. */
  playTime: ReadonlyMap<string, number>;
  likedKeys: ReadonlySet<string>;
  libraryKeys: ReadonlySet<string>;
}

const empty: LibrarySnapshot = { status: 'loading', songs: [], liked: [], albums: [], artists: [], onlinePlaylists: [], playlists: [], pins: [], local: [], cached: [], importSources: [], playTime: new Map(), likedKeys: new Set(), libraryKeys: new Set() };

/**
 * Everything the Library pages list, read from the repository and refreshed when it changes.
 * Reads are coalesced: ten quick changes cause one reload, and an older reload never overwrites a newer one.
 */
export class LibraryData {
  private snapshot: LibrarySnapshot = empty;
  private readonly listeners = new Set<() => void>();
  private unsubscribe?: () => void;
  private generation = 0;
  private disposed = false;

  constructor(private readonly repo: LibraryRepository) {}

  getSnapshot = (): LibrarySnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  start(): void {
    this.unsubscribe ??= this.repo.subscribe(() => this.schedule());
    this.schedule();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.listeners.clear();
  }

  /** Reload now and resolve when the snapshot reflects the repository. */
  async reload(): Promise<void> {
    const generation = ++this.generation;
    try {
      const [library, liked, saved, playlists, pins, assets, counts] = await Promise.all([
        this.repo.listLibrary(), this.repo.listLiked(), this.repo.listSavedEntities(), this.repo.listPlaylistPreviews(), this.repo.listPins(), this.repo.listAssets(), this.repo.playCounts(),
      ]);
      if (this.disposed || generation !== this.generation) return;
      const likedAt = new Map(liked.map((like) => [like.trackKey, like.likedAt]));
      const toSong = (record: { trackKey: string; track?: Track; addedAt: number; source: string }): LibrarySong[] =>
        record.track ? [{ trackKey: record.trackKey, track: record.track, addedAt: record.addedAt, source: record.source, liked: likedAt.has(record.trackKey), likedAt: likedAt.get(record.trackKey) }] : [];
      const songs = library.flatMap(toSong);
      const bySong = new Map(songs.map((song) => [song.trackKey, song]));
      const likedSongs = liked.flatMap((like) => (like.track ? [{ trackKey: like.trackKey, track: like.track, addedAt: bySong.get(like.trackKey)?.addedAt ?? like.likedAt, source: bySong.get(like.trackKey)?.source ?? 'like', liked: true, likedAt: like.likedAt }] : []));
      const savedByKey = new Map(saved.map((entity) => [entity.key, entity]));
      const playlistByKey = new Map(playlists.map((playlist) => [playlist.id, playlist]));
      const pinned: PinnedItem[] = [];
      for (const pin of pins) {
        const ref = pin.ref;
        if (ref.kind === 'track') {
          const track = bySong.get(entityKey(ref))?.track ?? (await this.repo.getTrack(entityKey(ref)));
          if (track) pinned.push({ key: pin.key, ref, title: track.title, subtitle: track.artist, artworkUrl: track.artworkUrl, track });
        } else if (ref.provider === 'local' && ref.kind === 'playlist') {
          const playlist = playlistByKey.get(ref.id);
          if (playlist) pinned.push({ key: pin.key, ref, title: playlist.name, artworkUrl: playlist.covers[0] });
        } else {
          const entity = savedByKey.get(pin.key);
          if (entity) pinned.push({ key: pin.key, ref, title: entity.title, subtitle: entity.subtitle, artworkUrl: entity.artworkUrl });
        }
      }
      const ready = assets.filter((asset) => asset.state === 'ready');
      const known = new Map<string, Track>(songs.map((song) => [song.trackKey, song.track]));
      const missing = [...new Set(ready.map((asset) => asset.trackKey))].filter((key) => !known.has(key));
      if (missing.length > 0) for (const [key, track] of await this.repo.getTracks(missing)) known.set(key, track);
      const offline = (kinds: string[]): LibrarySong[] => {
        const keys = [...new Set(ready.filter((asset) => kinds.includes(asset.kind)).map((asset) => asset.trackKey))];
        return keys.flatMap((key) => {
          const track = known.get(key);
          const record = bySong.get(key);
          return track ? [{ trackKey: key, track, addedAt: record?.addedAt ?? 0, source: record?.source ?? 'offline', liked: likedAt.has(key), likedAt: likedAt.get(key) }] : [];
        });
      };
      if (this.disposed || generation !== this.generation) return;
      const sources = new Map<string, ImportSource>();
      const SOURCE_NAMES: Record<string, string> = { spotify: 'Spotify', applemusic: 'Apple Music', deezer: 'Deezer', youtube: 'YouTube Music', tidal: 'Tidal', csv: 'CSV' };
      const sourceOf = (id: string, label: string) => {
        const found = sources.get(id) ?? { id, label, songs: [], playlists: [] };
        sources.set(id, found);
        return found;
      };
      for (const song of songs) if (song.source.startsWith('import:')) sourceOf(song.source.slice(7), SOURCE_NAMES[song.source.slice(7)] ?? song.source.slice(7)).songs.push(song);
      for (const playlist of playlists) if (playlist.source) sourceOf(playlist.source.provider, SOURCE_NAMES[playlist.source.provider] ?? playlist.source.provider).playlists.push(playlist);
      this.set({
        status: 'ready',
        songs,
        liked: likedSongs,
        albums: saved.filter((entity) => entity.ref.kind === 'album'),
        artists: saved.filter((entity) => entity.ref.kind === 'artist'),
        onlinePlaylists: saved.filter((entity) => entity.ref.kind === 'playlist'),
        playlists,
        pins: pinned,
        local: offline(['local']),
        cached: offline(['download', 'cache']),
        importSources: [...sources.values()].sort((a, b) => a.label.localeCompare(b.label)),
        playTime: new Map(counts.map((count) => [count.trackKey, count.listenedMs])),
        likedKeys: new Set(likedSongs.map((song) => song.trackKey)),
        libraryKeys: new Set(songs.map((song) => song.trackKey)),
      });
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.set({ ...this.snapshot, status: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  }

  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private dirty = false;

  /** One reload at a time: changes that arrive while it runs cause exactly one more afterwards. */
  private schedule(): void {
    if (this.disposed) return;
    if (this.running) { this.dirty = true; return; }
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.run(); }, 0);
  }

  private async run(): Promise<void> {
    this.running = true;
    try {
      do {
        this.dirty = false;
        await this.reload();
      } while (this.dirty && !this.disposed);
    } finally {
      this.running = false;
    }
  }

  private set(next: LibrarySnapshot): void {
    this.snapshot = next;
    for (const listener of [...this.listeners]) listener();
  }
}
