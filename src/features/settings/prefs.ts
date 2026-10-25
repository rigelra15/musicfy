/** Settings kept from the phone app, with the same defaults as there. */
export const PREF_DONT_SKIP_ON_FAILURE = 'playback.dontSkipOnFailure';
export const PREF_FAILURE_TIMEOUT = 'playback.failureTimeout';
export const PREF_SAVE_QUEUE = 'playback.saveQueue';
export const PREF_SHOW_SOURCE = 'playback.showSource';
export const PREF_FORMAT_BADGE = 'appearance.formatBadge';
export const PREF_FORMAT_SAMPLE_RATE = 'appearance.formatSampleRate';
export const PREF_BLUR = 'appearance.blur';

/** How long a failed stream waits before the next song starts (phone: 5–20 s, 6 by default). */
export const FAILURE_TIMEOUTS = [5, 6, 8, 10, 15, 20];
export const DEFAULT_FAILURE_TIMEOUT = 6;
/** How often a failed stream is tried again while "don't skip" is on (as on the phone). */
export const FAILURE_RETRY_MS = 5000;

export function failureTimeoutSeconds(raw: unknown): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(20, Math.max(5, Math.round(value))) : DEFAULT_FAILURE_TIMEOUT;
}

/** Kept equal to public/appinfo.json (a test checks it). */
export const APP_VERSION = '0.4.0';
