import { newEntryId, trackKeyOf, type QueueEntry, type QueueOrigin } from '../domain/entity';
import type { Track } from '../model';

export type RepeatMode = 'off' | 'all' | 'one';

export interface QueueState {
  /** Play order (already shuffled when `shuffle` is on). The same track may appear many times. */
  entries: QueueEntry[];
  /** Metadata for rendering, by trackKey. */
  tracks: Record<string, Track>;
  /** Identity of the playing slot; survives reordering and removal of other slots. */
  currentEntryId: string | null;
  repeat: RepeatMode;
  shuffle: boolean;
  /** Entry order before shuffling, so turning shuffle off restores it. */
  baseOrder: string[] | null;
}

export const emptyQueue: QueueState = {
  entries: [],
  tracks: {},
  currentEntryId: null,
  repeat: 'off',
  shuffle: false,
  baseOrder: null,
};

export type QueueAction =
  | { type: 'queue/replace'; tracks: Track[]; startIndex?: number; origin: QueueOrigin; shuffleSeed?: number }
  | { type: 'queue/playEntry'; entryId: string }
  | { type: 'queue/enqueue'; tracks: Track[]; position: 'end' | 'next'; origin?: QueueOrigin }
  | { type: 'queue/remove'; entryId: string }
  | { type: 'queue/move'; entryId: string; toIndex: number }
  | { type: 'queue/clear' }
  | { type: 'queue/next'; reason: 'user' | 'ended' }
  | { type: 'queue/previous' }
  | { type: 'queue/setRepeat'; mode: RepeatMode }
  | { type: 'queue/cycleRepeat' }
  | { type: 'queue/setShuffle'; on: boolean; seed: number }
  | { type: 'queue/autoplay'; tracks: Track[] }
  /** The player found out how long a song is, which the list it came from did not say. */
  | { type: 'queue/learnDuration'; trackKey: string; durationMs: number }
  | { type: 'queue/restore'; state: QueueState };

export function indexOfEntry(state: QueueState, entryId: string | null): number {
  return entryId === null ? -1 : state.entries.findIndex((entry) => entry.entryId === entryId);
}

export function currentIndex(state: QueueState): number {
  return indexOfEntry(state, state.currentEntryId);
}

export function trackOfEntry(state: QueueState, entry: QueueEntry | undefined): Track | null {
  return entry ? state.tracks[entry.trackKey] ?? null : null;
}

export function currentTrack(state: QueueState): Track | null {
  return trackOfEntry(state, state.entries[currentIndex(state)]);
}

export function hasNext(state: QueueState): boolean {
  const index = currentIndex(state);
  if (index < 0) return false;
  return index < state.entries.length - 1 || (state.repeat === 'all' && state.entries.length > 0);
}

export function hasPrevious(state: QueueState): boolean {
  return currentIndex(state) > 0 || (state.repeat === 'all' && state.entries.length > 1);
}

/** Small deterministic PRNG so shuffles are reproducible in tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], seed: number): T[] {
  const random = mulberry32(seed);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function makeEntries(tracks: Track[], origin: QueueOrigin): { entries: QueueEntry[]; byKey: Record<string, Track> } {
  const byKey: Record<string, Track> = {};
  const entries = tracks.map((track) => {
    const key = trackKeyOf(track);
    byKey[key] = track;
    return { entryId: newEntryId('q'), trackKey: key, origin } satisfies QueueEntry;
  });
  return { entries, byKey };
}

function prune(tracks: Record<string, Track>, entries: QueueEntry[]): Record<string, Track> {
  const used = new Set(entries.map((entry) => entry.trackKey));
  return Object.fromEntries(Object.entries(tracks).filter(([key]) => used.has(key)));
}

function applyShuffle(entries: QueueEntry[], currentId: string | null, seed: number): QueueEntry[] {
  const index = entries.findIndex((entry) => entry.entryId === currentId);
  const head = entries.slice(0, index + 1);
  return [...head, ...shuffled(entries.slice(index + 1), seed)];
}

function restoreOrder(entries: QueueEntry[], baseOrder: string[]): QueueEntry[] {
  const position = new Map(baseOrder.map((id, index) => [id, index]));
  const known = entries.filter((entry) => position.has(entry.entryId)).sort((a, b) => position.get(a.entryId)! - position.get(b.entryId)!);
  const added = entries.filter((entry) => !position.has(entry.entryId));
  return [...known, ...added];
}

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case 'queue/replace': {
      if (action.tracks.length === 0) return { ...emptyQueue, repeat: state.repeat, shuffle: state.shuffle };
      const { entries, byKey } = makeEntries(action.tracks, action.origin);
      const start = Math.max(0, Math.min(entries.length - 1, action.startIndex ?? 0));
      const currentEntryId = entries[start].entryId;
      const base = entries.map((entry) => entry.entryId);
      const wantsShuffle = action.shuffleSeed !== undefined || state.shuffle;
      const ordered = wantsShuffle ? applyShuffle(entries, currentEntryId, action.shuffleSeed ?? 1) : entries;
      return {
        ...state,
        entries: ordered,
        tracks: byKey,
        currentEntryId,
        shuffle: wantsShuffle,
        baseOrder: wantsShuffle ? base : null,
      };
    }
    case 'queue/playEntry':
      return indexOfEntry(state, action.entryId) < 0 ? state : { ...state, currentEntryId: action.entryId };
    case 'queue/enqueue': {
      if (action.tracks.length === 0) return state;
      const { entries, byKey } = makeEntries(action.tracks, action.origin ?? 'manual');
      const index = currentIndex(state);
      const at = action.position === 'next' && index >= 0 ? index + 1 : state.entries.length;
      const next = [...state.entries.slice(0, at), ...entries, ...state.entries.slice(at)];
      return {
        ...state,
        entries: next,
        tracks: { ...state.tracks, ...byKey },
        currentEntryId: state.currentEntryId ?? entries[0].entryId,
        baseOrder: state.baseOrder ? [...state.baseOrder, ...entries.map((entry) => entry.entryId)] : null,
      };
    }
    case 'queue/remove': {
      const index = indexOfEntry(state, action.entryId);
      if (index < 0) return state;
      const entries = state.entries.filter((entry) => entry.entryId !== action.entryId);
      let currentEntryId = state.currentEntryId;
      if (currentEntryId === action.entryId) {
        // The slot that follows takes over; at the end, the previous one (or nothing).
        currentEntryId = (entries[index] ?? entries[index - 1])?.entryId ?? null;
      }
      return {
        ...state,
        entries,
        tracks: prune(state.tracks, entries),
        currentEntryId,
        baseOrder: state.baseOrder?.filter((id) => id !== action.entryId) ?? null,
      };
    }
    case 'queue/move': {
      const from = indexOfEntry(state, action.entryId);
      if (from < 0) return state;
      const to = Math.max(0, Math.min(state.entries.length - 1, Math.trunc(action.toIndex)));
      if (to === from) return state;
      const entries = [...state.entries];
      const [moved] = entries.splice(from, 1);
      entries.splice(to, 0, moved);
      return { ...state, entries };
    }
    case 'queue/clear': {
      const keep = state.entries.filter((entry) => entry.entryId === state.currentEntryId);
      return { ...state, entries: keep, tracks: prune(state.tracks, keep), baseOrder: state.baseOrder ? keep.map((e) => e.entryId) : null };
    }
    case 'queue/next': {
      const index = currentIndex(state);
      if (index < 0) return state;
      if (action.reason === 'ended' && state.repeat === 'one') return state;
      if (index < state.entries.length - 1) return { ...state, currentEntryId: state.entries[index + 1].entryId };
      if (state.repeat === 'all') return { ...state, currentEntryId: state.entries[0].entryId };
      return state;
    }
    case 'queue/previous': {
      const index = currentIndex(state);
      if (index > 0) return { ...state, currentEntryId: state.entries[index - 1].entryId };
      if (index === 0 && state.repeat === 'all' && state.entries.length > 1) {
        return { ...state, currentEntryId: state.entries[state.entries.length - 1].entryId };
      }
      return state;
    }
    case 'queue/setRepeat':
      return { ...state, repeat: action.mode };
    case 'queue/cycleRepeat':
      return { ...state, repeat: state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off' };
    case 'queue/setShuffle': {
      if (action.on === state.shuffle) return state;
      if (action.on) {
        return {
          ...state,
          shuffle: true,
          baseOrder: state.entries.map((entry) => entry.entryId),
          entries: applyShuffle(state.entries, state.currentEntryId, action.seed),
        };
      }
      return { ...state, shuffle: false, entries: state.baseOrder ? restoreOrder(state.entries, state.baseOrder) : state.entries, baseOrder: null };
    }
    case 'queue/autoplay': {
      const present = new Set(state.entries.map((entry) => entry.trackKey));
      const fresh: Track[] = [];
      for (const track of action.tracks) {
        const key = trackKeyOf(track);
        if (present.has(key)) continue;
        present.add(key);
        fresh.push(track);
      }
      if (fresh.length === 0) return state;
      return queueReducer(state, { type: 'queue/enqueue', tracks: fresh, position: 'end', origin: 'autoplay' });
    }
    case 'queue/learnDuration': {
      const known = state.tracks[action.trackKey];
      if (!known || known.durationMs > 0 || !(action.durationMs > 0)) return state;
      return { ...state, tracks: { ...state.tracks, [action.trackKey]: { ...known, durationMs: action.durationMs } } };
    }
    case 'queue/restore':
      return action.state;
  }
}

// ---- persistence -------------------------------------------------------------------------------

export interface PersistedSession {
  version: 1;
  queue: QueueState;
  positionMs: number;
  savedAt: number;
}

export function serializeSession(queue: QueueState, positionMs: number, savedAt: number): PersistedSession {
  return { version: 1, queue, positionMs: Math.max(0, Math.round(positionMs)), savedAt };
}

/** Validates what comes back from storage; anything malformed yields null rather than a crash. */
export function parseSession(value: unknown): PersistedSession | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Partial<PersistedSession>;
  const queue = data.queue;
  if (data.version !== 1 || !queue || !Array.isArray(queue.entries) || typeof queue.tracks !== 'object' || queue.tracks === null) return null;
  const entries = queue.entries.filter(
    (entry): entry is QueueEntry => !!entry && typeof entry.entryId === 'string' && typeof entry.trackKey === 'string' && !!queue.tracks[entry.trackKey],
  );
  const currentEntryId = entries.some((entry) => entry.entryId === queue.currentEntryId) ? queue.currentEntryId : entries[0]?.entryId ?? null;
  return {
    version: 1,
    queue: {
      entries,
      tracks: prune(queue.tracks, entries),
      currentEntryId,
      repeat: queue.repeat === 'all' || queue.repeat === 'one' ? queue.repeat : 'off',
      shuffle: queue.shuffle === true,
      baseOrder: Array.isArray(queue.baseOrder) ? queue.baseOrder.filter((id): id is string => typeof id === 'string') : null,
    },
    positionMs: typeof data.positionMs === 'number' && data.positionMs >= 0 ? data.positionMs : 0,
    savedAt: typeof data.savedAt === 'number' ? data.savedAt : 0,
  };
}
