import type { PreferencesStore } from '../library/preferences';

export type SourceId = 'monochrome' | 'applemusic' | 'youtube';

/** Android's default order: Monochrome, then Apple Music, then YouTube. */
export const DEFAULT_ORDER: readonly SourceId[] = ['monochrome', 'applemusic', 'youtube'];
/** YouTube is on; the others stay off until the person turns them on (and, for Apple Music, connects an account). */
export const DEFAULT_ENABLED: Readonly<Record<SourceId, boolean>> = { monochrome: false, applemusic: false, youtube: true };

export const PREF_SOURCE_ORDER = 'modules.order';
export const PREF_SOURCE_ENABLED = 'modules.enabled';
export const PREF_SOURCE_PICKS = 'modules.picks';

export const SOURCE_NAMES: Record<SourceId, string> = { monochrome: 'Monochrome', applemusic: 'Apple Music', youtube: 'YouTube Music' };
const isSource = (value: unknown): value is SourceId => value === 'monochrome' || value === 'applemusic' || value === 'youtube';

export function parseOrder(stored: unknown): SourceId[] {
  const seen = new Set<SourceId>();
  for (const id of Array.isArray(stored) ? stored : []) if (isSource(id)) seen.add(id);
  for (const id of DEFAULT_ORDER) seen.add(id);                         // a source added later is never lost from the list
  return [...seen];
}

export function parseEnabled(stored: unknown): Record<SourceId, boolean> {
  const value = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_ENABLED };
  for (const id of DEFAULT_ORDER) if (typeof value[id] === 'boolean') out[id] = value[id] as boolean;
  return out;
}

export interface Picks { quality?: string; region?: string }
export function parsePicks(stored: unknown): Partial<Record<SourceId, Picks>> {
  const value = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<string, unknown>;
  const out: Partial<Record<SourceId, Picks>> = {};
  for (const id of DEFAULT_ORDER) {
    const raw = value[id];
    if (typeof raw !== 'object' || raw === null) continue;
    const picks: Picks = {};
    for (const key of ['quality', 'region'] as const) { const v = (raw as Record<string, unknown>)[key]; if (typeof v === 'string' && /^[a-z0-9]{2,10}$/.test(v)) picks[key] = v; }
    out[id] = picks;
  }
  return out;
}

export interface SourceSettings { order: SourceId[]; enabled: Record<SourceId, boolean>; picks: Partial<Record<SourceId, Picks>> }
export const readSettings = (prefs: Pick<PreferencesStore, 'get'>): SourceSettings => ({
  order: parseOrder(prefs.get<unknown>(PREF_SOURCE_ORDER, undefined)),
  enabled: parseEnabled(prefs.get<unknown>(PREF_SOURCE_ENABLED, undefined)),
  picks: parsePicks(prefs.get<unknown>(PREF_SOURCE_PICKS, undefined)),
});

/** The sources playback may use, in order. Disabled ones are never in this list, so they are never a fallback. */
export const activeSources = (settings: SourceSettings): SourceId[] => settings.order.filter((id) => settings.enabled[id]);

export function move(order: readonly SourceId[], id: SourceId, delta: -1 | 1): SourceId[] {
  const next = [...order];
  const at = next.indexOf(id);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= next.length) return next;
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}
