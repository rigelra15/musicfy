import type { PlaybackStatus, Track } from '../model';

/** Android's `LastFMUseNowPlaying` (default on) and `LastFMUseSendLikes` (default off). */
export const PREF_SCROBBLE_NOW_PLAYING = 'scrobble.nowPlaying';
export const PREF_SCROBBLE_LIKES = 'scrobble.likes';

export const MIN_SONG_SECONDS = 30;
export const PLAYED_FRACTION = 0.5;
export const MAX_WAIT_SECONDS = 240;

export interface ScrobbleSink {
  nowPlaying(track: Track): void;
  /** `startedAt` in seconds since 1970. */
  scrobble(track: Track, startedAt: number): void;
}

export interface TimerOptions {
  sink: ScrobbleSink;
  now?: () => number;
  wantsNowPlaying?: () => boolean;
  /** Longest stretch between two snapshots that still counts as listening. */
  maxGapMs?: number;
}

/**
 * Decides when a play counts, by Last.fm's rule: a song longer than 30 seconds, once it has been
 * played for half its length or four minutes, whichever comes first. Only time spent playing
 * counts (the same wall-clock rule as the listening history), so a pause, a seek or a stretch with
 * the app suspended adds nothing. Repeating a song starts a new play.
 */
export class ScrobbleTimer {
  private readonly now: () => number;
  private readonly maxGapMs: number;
  private token: number | undefined;
  private play: { track: Track; listened: number; lastTickAt: number | undefined; startedAt: number | undefined; needed: number; done: boolean } | null = null;

  constructor(private readonly options: TimerOptions) {
    this.now = options.now ?? (() => Date.now());
    this.maxGapMs = options.maxGapMs ?? 5_000;
  }

  observe(input: { track: Track | null; playToken: number; status: PlaybackStatus }): void {
    if (input.playToken !== this.token) {
      this.token = input.playToken;
      const seconds = input.track ? Math.round(input.track.durationMs / 1000) : 0;
      // A song of 30 seconds or less never counts.
      this.play = input.track ? { track: input.track, listened: 0, lastTickAt: undefined, startedAt: undefined, needed: seconds > MIN_SONG_SECONDS ? Math.min(seconds * 1000 * PLAYED_FRACTION, MAX_WAIT_SECONDS * 1000) : Infinity, done: false } : null;
    }
    const play = this.play;
    if (!play) return;
    const at = this.now();
    if (input.status !== 'playing') { play.lastTickAt = undefined; return; }
    if (play.startedAt === undefined) {
      play.startedAt = at;
      if (this.options.wantsNowPlaying?.() !== false) this.options.sink.nowPlaying(play.track);
    }
    if (play.lastTickAt !== undefined) play.listened += Math.min(Math.max(0, at - play.lastTickAt), this.maxGapMs);
    play.lastTickAt = at;
    if (!play.done && play.listened >= play.needed) {
      play.done = true;
      this.options.sink.scrobble(play.track, Math.floor(play.startedAt / 1000));
    }
  }
}
