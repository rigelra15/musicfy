import type { StreamSource } from './data/youtubePlayback';
import type { ProviderId } from './domain/entity';

export interface TrackArtist {
  id?: string;
  name: string;
}

export interface Track {
  /** Provider-local identifier (a YouTube video id, a local asset id, ...). */
  id: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  durationMs: number;
  /** Defaults to `youtube`; the identity of a track is provider + id. */
  provider?: ProviderId;
  artists?: TrackArtist[];
  albumId?: string;
  isrc?: string;
  explicit?: boolean;
  /** A video upload rather than the audio track; "hide video songs" filters these. */
  isVideo?: boolean;
}

export type AppView = 'search' | 'player' | 'queue' | 'lyrics';

export type SearchStatus = 'idle' | 'loading' | 'success' | 'error';

export type PlaybackStatus = 'idle' | 'loading' | 'buffering' | 'playing' | 'paused' | 'ended' | 'error';

export interface PlaybackSnapshot {
  status: PlaybackStatus;
  positionMs: number;
  durationMs: number;
  error?: string;
  /** Which step failed: auth, network, matching, stream, license, decode. */
  errorKind?: string;
  /** What the song is playing from, once it has been resolved. */
  source?: StreamSource;
  loadId?: number;
}

export type LyricsStatus = 'idle' | 'loading' | 'synced' | 'plain' | 'missing' | 'error';

export interface LyricsLine {
  timeMs: number;
  text: string;
}

export type LyricsDocument =
  | { type: 'synced'; lines: LyricsLine[] }
  | { type: 'plain'; text: string }
  | { type: 'missing' };

export interface AppState {
  view: AppView;
  searchQuery: string;
  searchRequestId: number;
  searchStatus: SearchStatus;
  searchError?: string;
  results: Track[];
  queue: Track[];
  currentTrackIndex: number;
  playback: PlaybackSnapshot;
  lyricsStatus: LyricsStatus;
  lyricsDocument: LyricsDocument | null;
  lyricsError?: string;
}
