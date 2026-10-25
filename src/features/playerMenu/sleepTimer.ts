export interface SleepState {
  /** When the timer ends (epoch ms), or undefined. */
  deadlineAt: number | undefined;
  /** Stop once the current song has finished instead of at a time. */
  atSongEnd: boolean;
}

export const PREF_SLEEP_DEADLINE = 'sleep.deadlineAt';
const MAX_MINUTES = 24 * 60;

type Timers = { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };

/**
 * Ports Android's SleepTimer: pause after N minutes, or when the current song ends. Only one of
 * the two is armed at a time. The deadline is a wall-clock time, so a timer that would have gone
 * off while the app was closed is simply gone on the next launch and never starts playback.
 */
export class SleepTimer {
  private state: SleepState = { deadlineAt: undefined, atSongEnd: false };
  private handle: unknown;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: {
    /** Pauses playback (the timer elapsed). */
    onElapsed(): void;
    /** The song-end flag changed (the engine stops after the current song). */
    onSongEndChanged(armed: boolean): void;
    /** Remembers the deadline across a relaunch. */
    persist?(deadlineAt: number | undefined): void;
    now?: () => number;
    timers?: Timers;
  }) {}

  private now() { return (this.options.now ?? Date.now)(); }
  private timers() { return this.options.timers ?? realTimers; }

  getSnapshot = (): SleepState => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get isActive() { return this.state.deadlineAt !== undefined || this.state.atSongEnd; }

  /** Whole minutes, 1 to 24 h. Returns false for anything else. */
  start(minutes: number): boolean {
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_MINUTES) return false;
    this.disarm();
    this.arm(this.now() + Math.round(minutes) * 60_000);
    return true;
  }

  startAtSongEnd(): void {
    this.disarm();
    this.set({ deadlineAt: undefined, atSongEnd: true });
    this.options.onSongEndChanged(true);
  }

  clear(): void {
    this.disarm();
    this.set({ deadlineAt: undefined, atSongEnd: false });
  }

  /** The engine reports the song-end stop happened (or the queue emptied). */
  songEndHandled(): void {
    if (!this.state.atSongEnd) return;
    this.set({ ...this.state, atSongEnd: false });
  }

  /** A deadline saved by an earlier run: re-armed if still ahead, dropped (never played) if it passed. */
  restore(deadlineAt: unknown): void {
    if (typeof deadlineAt === 'number' && deadlineAt > this.now()) this.arm(deadlineAt);
    else if (deadlineAt !== undefined) this.options.persist?.(undefined);
  }

  remainingMs(): number {
    return this.state.deadlineAt === undefined ? 0 : Math.max(0, this.state.deadlineAt - this.now());
  }

  dispose(): void {
    if (this.handle !== undefined) this.timers().clear(this.handle);
    this.handle = undefined;
    this.listeners.clear();
  }

  private arm(deadlineAt: number) {
    this.handle = this.timers().set(() => {
      this.handle = undefined;
      this.set({ deadlineAt: undefined, atSongEnd: false });
      this.options.persist?.(undefined);
      this.options.onElapsed();
    }, Math.max(0, deadlineAt - this.now()));
    this.set({ deadlineAt, atSongEnd: false });
    this.options.persist?.(deadlineAt);
  }

  private disarm() {
    if (this.handle !== undefined) this.timers().clear(this.handle);
    this.handle = undefined;
    const hadSongEnd = this.state.atSongEnd;
    if (hadSongEnd) this.options.onSongEndChanged(false);
    if (this.state.deadlineAt !== undefined) this.options.persist?.(undefined);
  }

  private set(next: SleepState) {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
}

export function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${minutes}:${String(seconds).padStart(2, '0')}`;
}
