import { sanitizeArtist } from '../features/home/model';
import type { LibraryRepository } from '../library/repository';
import { parseSession, serializeSession, type PersistedSession, type QueueState } from './queueModel';

export interface LiveSession {
  queue: QueueState;
  positionMs: number;
  playing: boolean;
}

const SAVE_INTERVAL_MS = 15_000;
const CHANGE_DEBOUNCE_MS = 1_000;

/**
 * Keeps the queue and listening position in the repository so a relaunch picks up where the user
 * left off. Nothing is written until `restore()` has finished: otherwise the empty queue of a
 * fresh start would overwrite the very session about to be restored.
 */
export class SessionPersister {
  private restored = false;
  private interval: ReturnType<typeof setInterval> | undefined;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private writing: Promise<void> = Promise.resolve();
  lastError: Error | undefined;

  constructor(
    private readonly repo: LibraryRepository,
    private readonly live: () => LiveSession,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The saved session, or null when there is none or it cannot be read. Always unlocks saving. */
  async restore(): Promise<PersistedSession | null> {
    try {
      const saved = await this.repo.loadSession<unknown>();
      const parsed = saved ? parseSession(saved.data) : null;
      if (parsed) for (const [key, track] of Object.entries(parsed.queue.tracks)) parsed.queue.tracks[key] = { ...track, artist: sanitizeArtist(track.artist) };
      return parsed && parsed.queue.entries.length > 0 ? parsed : null;
    } catch (error) {
      this.lastError = error instanceof Error ? error : new Error(String(error));
      return null;
    } finally {
      this.restored = true;
    }
  }

  /** Writes the current queue and position now. A failed write is recorded and does not throw. */
  flush(): Promise<void> {
    if (!this.restored) return Promise.resolve();
    this.writing = this.writing.then(async () => {
      const { queue, positionMs } = this.live();
      try {
        if (queue.entries.length === 0) await this.repo.clearSession();
        else await this.repo.saveSession(serializeSession(queue, positionMs, this.now()));
        this.lastError = undefined;
      } catch (error) {
        this.lastError = error instanceof Error ? error : new Error(String(error));
      }
    });
    return this.writing;
  }

  /** Call when the queue or play state changed; coalesces bursts into one write. */
  notifyChange(): void {
    if (!this.restored) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => { this.debounce = undefined; void this.flush(); }, CHANGE_DEBOUNCE_MS);
  }

  start(): void {
    this.stop();
    this.interval = setInterval(() => { if (this.live().playing) void this.flush(); }, SAVE_INTERVAL_MS);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onHide);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = undefined;
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onHide);
  }

  dispose(): void {
    this.stop();
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = undefined;
  }

  private readonly onVisibility = () => { if (document.visibilityState === 'hidden') void this.flush(); };
  private readonly onHide = () => { void this.flush(); };
}
