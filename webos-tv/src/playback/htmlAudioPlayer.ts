import { resolveAudioStream, type ResolvedStream } from '../data/youtubePlayback';
import type { PlaybackSnapshot, Track } from '../model';
import { SourceFailure, describeFailure } from '../sources/errors';
import { shakaLoader, type HlsLoader, type HlsSession } from './hls';
import { tr } from '../app/i18n';

export type TrackStreamResolver = (track: Track) => Promise<ResolvedStream>;
export type PlaybackListener = (snapshot: PlaybackSnapshot) => void;

/** What the player learned about songs it resolved (their descriptions), for "About song". */
const descriptions = new Map<string, string>();
export const descriptionOf = (trackId: string): string | undefined => descriptions.get(trackId);

export const MIN_RATE = 0.25;
export const MAX_RATE = 3;
export const clampRate = (rate: number) => (Number.isFinite(rate) ? Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(rate * 20) / 20)) : 1);

function readDurationMs(audio: HTMLAudioElement, fallbackMs: number): number {
  return Number.isFinite(audio.duration) && audio.duration > 0
    ? Math.round(audio.duration * 1000)
    : fallbackMs;
}

function readPositionMs(audio: HTMLAudioElement): number {
  return Number.isFinite(audio.currentTime) && audio.currentTime > 0
    ? Math.round(audio.currentTime * 1000)
    : 0;
}

function playbackErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return tr('err.audio.pressPlay');
  }
  return tr('err.audio.cannotPlayRetry');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export class HtmlAudioPlayer {
  private snapshot: PlaybackSnapshot = { status: 'idle', positionMs: 0, durationMs: 0 };
  private readonly listeners = new Set<PlaybackListener>();
  private loadSequence = 0;
  private fallbackDurationMs = 0;
  private pendingSeekMs = 0;
  private rate = 1;
  private hls: HlsSession | undefined;
  private attached = false;

  private readonly onLoadedMetadata = () => {
    if (this.pendingSeekMs > 0) {
      const target = this.pendingSeekMs;
      this.pendingSeekMs = 0;
      try {
        this.audio.currentTime = target / 1000;
      } catch {
        // The engine refused the seek; the track simply starts from the beginning.
      }
    }
    this.update({
      status: this.audio.paused ? 'paused' : 'playing',
      positionMs: readPositionMs(this.audio),
      durationMs: readDurationMs(this.audio, this.fallbackDurationMs),
      error: undefined,
    });
  };

  private readonly onTimeUpdate = () => {
    this.update({
      positionMs: readPositionMs(this.audio),
      durationMs: readDurationMs(this.audio, this.fallbackDurationMs),
    });
  };

  private readonly onWaiting = () => this.update({ status: 'buffering', error: undefined });
  private readonly onPlaying = () => this.update({ status: 'playing', error: undefined });
  private readonly onPause = () => {
    this.update({ status: this.audio.ended ? 'ended' : 'paused' });
  };
  private readonly onEnded = () => {
    if (!this.audio.ended) return;
    this.update({
      status: 'ended',
      positionMs: readDurationMs(this.audio, this.fallbackDurationMs),
    });
  };
  private readonly onError = () => {
    const code = this.audio.error?.code;
    const kind = code === 2 ? 'network' : code === 3 || code === 4 ? 'decode' : 'stream';
    const label = this.snapshot.source?.label;
    const base = kind === 'decode' ? tr('err.audio.decode') : kind === 'network' ? tr('err.audio.network') : tr('err.audio.cannotPlay');
    this.update({ status: 'error', errorKind: kind, error: `${label ? `${label}: ` : ''}${base}. ${tr('err.audio.chooseAgain')}` });
  };

  constructor(
    private readonly audio: HTMLAudioElement,
    private readonly resolveStream: TrackStreamResolver = (track) => resolveAudioStream(track.id),
    private readonly loadHls: HlsLoader = shakaLoader,
  ) {
    this.audio.preload = 'metadata';
    this.audio.addEventListener('loadedmetadata', this.onLoadedMetadata);
    this.audio.addEventListener('timeupdate', this.onTimeUpdate);
    this.audio.addEventListener('waiting', this.onWaiting);
    this.audio.addEventListener('playing', this.onPlaying);
    this.audio.addEventListener('pause', this.onPause);
    this.audio.addEventListener('ended', this.onEnded);
    this.audio.addEventListener('error', this.onError);
  }

  /** `startAtMs` is applied once metadata is available; used to restore a saved position. */
  async load(track: Track, options: { startAtMs?: number } = {}): Promise<number | undefined> {
    const sequence = ++this.loadSequence;
    this.fallbackDurationMs = track.durationMs;
    this.pendingSeekMs = options.startAtMs && options.startAtMs > 0 ? options.startAtMs : 0;
    this.audio.pause();
    await this.release();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.update({ status: 'loading', positionMs: 0, durationMs: track.durationMs, error: undefined, errorKind: undefined, source: undefined });

    try {
      const stream = await this.resolveStream(track);
      if (sequence !== this.loadSequence) return undefined;

      if (stream.expiresAtMs !== undefined && stream.expiresAtMs <= Date.now()) {
        throw new Error(tr('err.audio.expired'));
      }

      if (stream.format !== 'hls' && typeof this.audio.canPlayType === 'function' && this.audio.canPlayType(stream.mimeType) === '') {
        throw new SourceFailure('decode', tr('err.audio.format', { format: stream.source?.codec ?? stream.mimeType }), stream.source?.label);
      }

      if (stream.description) {
        descriptions.set(track.id, stream.description);
        if (descriptions.size > 200) descriptions.delete(descriptions.keys().next().value as string);
      }
      if (stream.format === 'hls') {
        const session = await this.loadHls(this.audio, stream, (failure) => {
          if (sequence === this.loadSequence) this.update({ status: 'error', error: describeFailure(failure), errorKind: failure.kind });
        });
        if (sequence !== this.loadSequence) { await session.destroy(); return undefined; }
        this.hls = session;
        this.attached = true;
      } else {
        this.audio.src = stream.url;
        this.audio.load();
        this.attached = true;
      }
      this.applyRate();
      this.update({ source: stream.source });
      return sequence;
    } catch (error) {
      if (sequence !== this.loadSequence) return undefined;
      const failure = error instanceof SourceFailure ? error : undefined;
      const message = failure ? describeFailure(failure) : error instanceof Error ? error.message : tr('err.audio.prepare');
      this.update({ status: 'error', error: message, errorKind: failure?.kind });
      throw error;
    }
  }

  async play(loadId = this.loadSequence): Promise<void> {
    if (loadId !== this.loadSequence) return;
    if (!this.attached) {
      const error = new Error(tr('err.audio.notReady'));
      this.update({ status: 'error', error: error.message });
      throw error;
    }

    try {
      await this.audio.play();
    } catch (error) {
      if (loadId !== this.loadSequence || isAbortError(error)) return;
      const message = playbackErrorMessage(error);
      this.update({ status: 'error', error: message });
      throw new Error(message);
    }

    if (loadId !== this.loadSequence) return;
  }

  pause(): void {
    this.audio.pause();
  }

  /** Tempo only (pitch is kept); remembered across songs because loading a source resets the element's rate. */
  setPlaybackRate(rate: number): void {
    this.rate = clampRate(rate);
    this.applyRate();
  }

  private applyRate(): void {
    const audio = this.audio as HTMLAudioElement & { preservesPitch?: boolean };
    try {
      audio.defaultPlaybackRate = this.rate;
      audio.playbackRate = this.rate;
      if ('preservesPitch' in audio || this.rate !== 1) audio.preservesPitch = true;
    } catch {
      // An engine that refuses a rate keeps playing at normal speed.
    }
  }

  seekTo(positionMs: number): void {
    if (!Number.isFinite(positionMs) || positionMs < 0) return;
    const durationMs = readDurationMs(this.audio, this.fallbackDurationMs);
    const clampedPositionMs = durationMs > 0 ? Math.min(positionMs, durationMs) : positionMs;
    try {
      this.audio.currentTime = clampedPositionMs / 1000;
      this.update({ positionMs: clampedPositionMs, durationMs });
    } catch {
      // Some media engines do not accept seeking until metadata has loaded.
    }
  }

  subscribe(listener: PlaybackListener): () => void {
    this.listeners.add(listener);
    listener({ ...this.snapshot });
    return () => this.listeners.delete(listener);
  }

  /** Lets go of the previous song's player library session (and its MSE/DRM objects) before another one starts. */
  private async release(): Promise<void> {
    this.attached = false;
    const session = this.hls;
    this.hls = undefined;
    if (session) await session.destroy();
  }

  dispose(): void {
    this.loadSequence += 1;
    void this.release();
    this.audio.removeEventListener('loadedmetadata', this.onLoadedMetadata);
    this.audio.removeEventListener('timeupdate', this.onTimeUpdate);
    this.audio.removeEventListener('waiting', this.onWaiting);
    this.audio.removeEventListener('playing', this.onPlaying);
    this.audio.removeEventListener('pause', this.onPause);
    this.audio.removeEventListener('ended', this.onEnded);
    this.audio.removeEventListener('error', this.onError);
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.listeners.clear();
  }

  private update(patch: Partial<PlaybackSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch, loadId: this.loadSequence };
    const nextSnapshot = { ...this.snapshot };
    this.listeners.forEach((listener) => listener(nextSnapshot));
  }
}

/** Loads a track without starting it (a restored session never autoplays). */
export async function loadTrackPaused(
  player: HtmlAudioPlayer,
  track: Track,
  startAtMs: number,
): Promise<void> {
  await player.load(track, { startAtMs });
}

export async function loadAndPlayTrack(
  player: HtmlAudioPlayer,
  track: Track,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const loadId = await player.load(track);
  if (loadId === undefined || !isCurrent()) return;
  await player.play(loadId);
}
