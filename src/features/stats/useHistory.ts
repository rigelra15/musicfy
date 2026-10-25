import { useEffect, useState } from 'preact/hooks';
import type { LibraryRepository } from '../../library/repository';
import type { PlayEvent } from './stats';

export interface HistoryState { status: 'loading' | 'ready' | 'error'; events: PlayEvent[] }

/** The whole play history, reloaded when the repository changes; an older read never replaces a newer one. */
export function useHistory(repo: LibraryRepository): HistoryState {
  const [state, setState] = useState<HistoryState>({ status: 'loading', events: [] });
  useEffect(() => {
    let generation = 0;
    let disposed = false;
    const load = async () => {
      const mine = ++generation;
      try {
        const rows = await repo.listHistory();
        if (disposed || mine !== generation) return;
        setState({ status: 'ready', events: rows.map((row) => ({ id: row.id, trackKey: row.trackKey, startedAt: row.startedAt, listenedMs: row.listenedMs, track: row.track })) });
      } catch {
        if (!disposed && mine === generation) setState({ status: 'error', events: [] });
      }
    };
    void load();
    const unsubscribe = repo.subscribe(() => { void load(); });
    return () => { disposed = true; unsubscribe(); };
  }, [repo]);
  return state;
}
