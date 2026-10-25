import type { PreferencesStore } from '../../library/preferences';
import type { Track } from '../../model';

export interface Skip { songId: string; artists: string[]; at: number }

export const PREF_SKIPS = 'listening.skips';
const MAX_SKIPS = 200;

/**
 * What the player says about taste between Home loads (ported from Android's ListeningSignals):
 * songs dropped in the first seconds are skips, songs played through count as plays. Skips persist
 * (newest 200) so a skipped song stays out of recommendations for two weeks.
 */
export class ListeningSignals {
  skipsSinceRefresh = 0;
  playsSinceRefresh = 0;

  constructor(private readonly prefs: PreferencesStore, private readonly now: () => number = () => Date.now()) {}

  /** `listenedMs` is time actually spent playing `track` before it stopped being current. */
  onTrackLeft(track: Track, listenedMs: number): 'ignored' | 'skip' | 'play' {
    const durationMs = track.durationMs;
    if (listenedMs < 300) return 'ignored';
    if (durationMs > 0 && durationMs < 40_000) return 'ignored';
    if (listenedMs < 30_000 && (durationMs <= 0 || listenedMs < durationMs / 2)) {
      const skips = [...this.all(), { songId: track.id, artists: (track.artists?.map((a) => a.name) ?? [track.artist]).filter(Boolean), at: this.now() }];
      this.memory = skips.slice(-MAX_SKIPS);
      void this.prefs.set(PREF_SKIPS, this.memory).catch(() => undefined);
      this.skipsSinceRefresh += 1;
      return 'skip';
    }
    this.playsSinceRefresh += 1;
    return 'play';
  }

  /** Skips written but not yet confirmed by the preference store, so back-to-back skips are not lost. */
  private memory: Skip[] | undefined;

  all(): Skip[] {
    if (this.memory) return this.memory;
    const stored = this.prefs.get<unknown>(PREF_SKIPS, []);
    return Array.isArray(stored)
      ? stored.filter((entry): entry is Skip => !!entry && typeof (entry as Skip).songId === 'string' && typeof (entry as Skip).at === 'number' && Array.isArray((entry as Skip).artists))
      : [];
  }

  recentSkips(days = 14): Skip[] {
    const since = this.now() - days * 86_400_000;
    return this.all().filter((skip) => skip.at >= since);
  }

  markRefreshed(): void {
    this.skipsSinceRefresh = 0;
    this.playsSinceRefresh = 0;
  }
}
