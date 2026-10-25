import type { PlaybackStatus, Track } from '../model';

/** Seconds of listening before a play enters the history (Android `historyDuration`, default 30). */
export const PREF_HISTORY_SECONDS = 'history.minSeconds';
/** "Pause listening history": plays are not recorded while on. */
export const PREF_HISTORY_PAUSED = 'history.paused';
export const DEFAULT_HISTORY_SECONDS = 30;

export interface HistorySink {
  record(play: { id: string; track: Track; sessionId: string; startedAt: number; listenedMs: number }): Promise<unknown>;
  /** Raises the stored listening time of an event already recorded. */
  extend(id: string, listenedMs: number): Promise<unknown>;
}

export interface TrackerOptions {
  sink: HistorySink;
  /** Identifies this launch of the app; with the play sequence it makes event ids unique and deterministic. */
  sessionId: string;
  now?: () => number;
  /** Listening time after which a play enters the history (Android: 30 s by default). */
  thresholdMs: () => number;
  /** "Pause listening history": nothing new is recorded while on. */
  historyPaused: () => boolean;
  /** A song stopped being the current one after `listenedMs` of real listening (feeds recommendations). */
  onLeft?: (track: Track, listenedMs: number) => void;
  /** Longest stretch between two snapshots that still counts as listening. */
  maxGapMs?: number;
}

export interface TrackerInput {
  track: Track | null;
  /** Changes whenever the engine loads the current slot again, including repeating the same song. */
  playToken: number;
  status: PlaybackStatus;
}

const REWRITE_EVERY_MS = 10_000;

interface Play {
  id: string;
  track: Track;
  listened: number;
  lastTickAt: number | undefined;
  startedAt: number | undefined;
  recorded: boolean;
  /** A write is in flight; the next one waits for it so `record` always lands before `extend`. */
  writing: boolean;
  wantsFinalWrite: boolean;
  writtenMs: number;
  finished: boolean;
}

/**
 * Turns playback snapshots into history events. Listening time is the wall-clock time between
 * snapshots while the status is `playing`: seeks, buffering, pauses and a stretch in which the app
 * was not running add nothing, so moving the seek bar can never inflate the numbers.
 */
export class ListeningTracker {
  private readonly now: () => number;
  private readonly maxGapMs: number;
  private sequence = 0;
  private token: number | undefined;
  private play: Play | null = null;
  lastError: Error | undefined;

  constructor(private readonly options: TrackerOptions) {
    this.now = options.now ?? (() => Date.now());
    this.maxGapMs = options.maxGapMs ?? 5_000;
  }

  observe(input: TrackerInput): void {
    if (input.playToken !== this.token) {
      this.finish();
      this.begin(input);
    }
    const play = this.play;
    if (!play || play.finished) return;
    const at = this.now();
    if (input.status === 'playing') {
      if (play.lastTickAt !== undefined) play.listened += Math.min(Math.max(0, at - play.lastTickAt), this.maxGapMs);
      play.startedAt ??= at;
      play.lastTickAt = at;
    } else {
      play.lastTickAt = undefined;
    }
    const resting = input.status === 'paused' || input.status === 'ended' || input.status === 'error';
    this.persist(play, resting);
    if (input.status === 'ended') this.finish();
  }

  /** Writes the running total now (the page is being hidden or closed). */
  flush(): void {
    if (this.play) this.persist(this.play, true);
  }

  private begin(input: TrackerInput): void {
    this.token = input.playToken;
    this.sequence += 1;
    this.play = input.track
      ? { id: `${this.options.sessionId}:${this.sequence}`, track: input.track, listened: 0, lastTickAt: undefined, startedAt: undefined, recorded: false, writing: false, wantsFinalWrite: false, writtenMs: 0, finished: false }
      : null;
  }

  private finish(): void {
    const play = this.play;
    if (!play || play.finished) return;
    play.finished = true;
    this.persist(play, true);
    if (play.listened > 0) this.options.onLeft?.(play.track, play.listened);
  }

  /** `force` writes any unsaved time; otherwise a rewrite waits until enough has piled up. */
  private persist(play: Play, force: boolean): void {
    if (play.writing) {
      if (force) play.wantsFinalWrite = true;
      return;
    }
    const listened = Math.round(play.listened);
    if (!play.recorded) {
      if (listened < this.options.thresholdMs() || this.options.historyPaused()) return;
      play.writing = true;
      this.settle(play, this.options.sink.record({ id: play.id, track: play.track, sessionId: this.options.sessionId, startedAt: play.startedAt ?? this.now(), listenedMs: listened }), () => { play.recorded = true; play.writtenMs = listened; });
      return;
    }
    if (listened <= play.writtenMs || (!force && listened - play.writtenMs < REWRITE_EVERY_MS)) return;
    play.writing = true;
    this.settle(play, this.options.sink.extend(play.id, listened), () => { play.writtenMs = listened; });
  }

  private settle(play: Play, write: Promise<unknown>, ok: () => void): void {
    void write.then(
      () => { ok(); this.lastError = undefined; },
      (error: unknown) => { this.lastError = error instanceof Error ? error : new Error(String(error)); },
    ).then(() => {
      play.writing = false;
      if (play.wantsFinalWrite) { play.wantsFinalWrite = false; this.persist(play, true); }
    });
  }
}
