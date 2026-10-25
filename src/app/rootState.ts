import type { PlaybackSnapshot } from '../model';
import { currentIndex, currentTrack, emptyQueue, queueReducer, type QueueAction, type QueueState } from '../playback/queueModel';

export interface RootState {
  queue: QueueState;
  playback: PlaybackSnapshot;
  /**
   * Increments whenever the engine must (re)load the current slot, including when the same track
   * is chosen again. Loading is keyed on this, never on the track id, so choosing the same song
   * twice cannot leave the player stuck.
   */
  playToken: number;
  /** Position to seek to once the restored track has loaded (paused). */
  resumeAtMs: number;
  /** A restored session never autoplays. */
  autoplay: boolean;
  /** Sleep timer "end of song": when the current song ends, the next one is loaded but not played. */
  stopAfterTrack: boolean;
  /** Snapshots from engine loads at or below this id belong to a superseded track and are dropped. */
  minLoadId: number;
}

export type RootAction =
  | QueueAction
  | { type: 'playback/updated'; snapshot: PlaybackSnapshot }
  | { type: 'session/restored'; queue: QueueState; positionMs: number }
  | { type: 'sleep/songEnd'; armed: boolean };

export const initialRootState: RootState = {
  queue: emptyQueue,
  playback: { status: 'idle', positionMs: 0, durationMs: 0 },
  playToken: 0,
  resumeAtMs: 0,
  autoplay: true,
  stopAfterTrack: false,
  minLoadId: -1,
};

const FORCE_RELOAD: ReadonlySet<RootAction['type']> = new Set(['queue/replace', 'queue/playEntry']);

function loading(state: RootState, queue: QueueState, autoplay = true): RootState {
  const track = currentTrack(queue);
  return {
    ...state,
    queue,
    playToken: state.playToken + 1,
    resumeAtMs: 0,
    autoplay,
    minLoadId: Math.max(state.minLoadId, state.playback.loadId ?? -1),
    playback: track
      ? { status: 'loading', positionMs: 0, durationMs: track.durationMs }
      : { status: 'idle', positionMs: 0, durationMs: 0 },
  };
}

export function rootReducer(state: RootState, action: RootAction): RootState {
  switch (action.type) {
    case 'session/restored': {
      const track = currentTrack(action.queue);
      return {
        ...state,
        queue: action.queue,
        playToken: state.playToken + 1,
        resumeAtMs: action.positionMs,
        autoplay: false,
        minLoadId: Math.max(state.minLoadId, state.playback.loadId ?? -1),
        playback: track
          ? { status: 'loading', positionMs: action.positionMs, durationMs: track.durationMs }
          : { status: 'idle', positionMs: 0, durationMs: 0 },
      };
    }
    case 'sleep/songEnd':
      return state.stopAfterTrack === action.armed ? state : { ...state, stopAfterTrack: action.armed };
    case 'playback/updated': {
      const snapshot = action.snapshot;
      if (snapshot.loadId !== undefined && snapshot.loadId <= state.minLoadId) return state;
      if (snapshot.loadId !== undefined && state.playback.loadId !== undefined && snapshot.loadId < state.playback.loadId) return state;
      if (snapshot.status === 'ended') {
        if (snapshot.loadId === undefined || snapshot.loadId !== state.playback.loadId || state.playback.status === 'ended') return state;
        const index = currentIndex(state.queue);
        if (index < 0) return { ...state, playback: snapshot };
        const hold = state.stopAfterTrack;
        const done = hold ? { ...state, stopAfterTrack: false } : state;
        if (state.queue.repeat === 'one') return loading(done, state.queue, !hold);
        const atEnd = index >= state.queue.entries.length - 1;
        if (atEnd && state.queue.repeat === 'off') return { ...done, playback: snapshot };
        return loading(done, queueReducer(state.queue, { type: 'queue/next', reason: 'ended' }), !hold);
      }
      return { ...state, playback: snapshot };
    }
    default: {
      const before = state.queue.currentEntryId;
      const queue = queueReducer(state.queue, action);
      if (queue === state.queue) return state;
      const changed = queue.currentEntryId !== before || FORCE_RELOAD.has(action.type);
      if (changed && queue.currentEntryId !== null) return loading(state, queue);
      if (queue.currentEntryId === null && before !== null) return { ...state, queue, playToken: state.playToken + 1, minLoadId: Math.max(state.minLoadId, state.playback.loadId ?? -1), playback: { status: 'idle', positionMs: 0, durationMs: 0 } };
      return { ...state, queue };
    }
  }
}
