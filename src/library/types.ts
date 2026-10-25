import type { EntityRef, ProviderId } from '../domain/entity';
import type { Track } from '../model';

export interface StoredTrack {
  trackKey: string;
  track: Track;
  updatedAt: number;
}

export interface LibraryRecord {
  trackKey: string;
  addedAt: number;
  /** Where the track entered the Library: 'manual', 'import:<id>', 'download', ... */
  source: string;
}

export interface LikeRecord {
  trackKey: string;
  likedAt: number;
}

export interface PinRecord {
  key: string;
  ref: EntityRef;
  position: number;
  pinnedAt: number;
}

export interface SavedEntity {
  key: string;
  ref: EntityRef;
  title: string;
  subtitle?: string;
  artworkUrl?: string;
  savedAt: number;
}

export interface PlaylistSource {
  provider: ProviderId | 'spotify' | 'deezer' | 'tidal' | 'csv';
  id: string;
  title?: string;
  importedAt: number;
  /** Provider-reported size at import time, to explain partial imports. */
  reportedTrackCount?: number;
  /** The public link it was read from, so "perbarui" can read it again. */
  url?: string;
  /** Last time the copy was refreshed from the link. */
  syncedAt?: number;
}

/** One finished (or stopped) import, kept so the history can say what came from where. */
export interface ImportLogRecord {
  id: string;
  at: number;
  provider: PlaylistSource['provider'];
  kind: 'playlist' | 'album';
  remoteId: string;
  url?: string;
  name: string;
  playlistId?: string;
  total: number;
  matched: number;
  added: number;
  unmatched: number;
  /** "Judul · Artis" of the first songs that found no match. */
  unmatchedTitles: string[];
  warnings: string[];
  status: 'done' | 'partial' | 'resync';
}

export interface PlaylistRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  source?: PlaylistSource;
}

export interface PlaylistEntryRecord {
  entryId: string;
  playlistId: string;
  position: number;
  trackKey: string;
  addedAt: number;
  /** Stable identity inside an import/backup so re-imports do not duplicate entries. */
  importKey?: string;
}

export interface PlaylistEntry extends PlaylistEntryRecord {
  track?: Track;
}

export interface HistoryRecord {
  /** Deterministic: `${sessionId}:${sequence}` so crash recovery cannot double count. */
  id: string;
  trackKey: string;
  sessionId: string;
  startedAt: number;
  listenedMs: number;
}

export interface LyricsEditRecord {
  trackKey: string;
  lrc: string;
  editedAt: number;
  provider: 'UserEdited';
}

export interface LyricsChoiceRecord {
  trackKey: string;
  provider: string;
  chosenAt: number;
}

export interface PrefRecord {
  key: string;
  value: unknown;
  updatedAt: number;
}

export type AssetState = 'staging' | 'ready' | 'failed' | 'missing';

export interface AssetRecord {
  assetId: string;
  trackKey: string;
  state: AssetState;
  bytes: number;
  updatedAt: number;
  kind: 'download' | 'local' | 'cache';
  /** Set after restoring a backup that did not carry the media file. */
  needsTransfer?: boolean;
  detail?: string;
}

export interface MappingRecord {
  id: string;
  a: string;
  b: string;
  confidence: number;
  createdAt: number;
}

export interface SessionRecord {
  key: 'current';
  savedAt: number;
  data: unknown;
}
