import type {
  AppState,
  AppView,
  LyricsStatus,
  LyricsDocument,
  PlaybackSnapshot,
  Track,
} from './model';

export function getBackView(view: AppView, hasCurrentTrack: boolean): AppView {
  if (view === 'queue' || view === 'lyrics') return hasCurrentTrack ? 'player' : 'search';
  if (view === 'player') return 'search';
  return 'search';
}

export type AppAction =
  | { type: 'query/changed'; query: string; requestId?: number }
  | { type: 'search/started'; requestId: number }
  | { type: 'search/succeeded'; tracks: Track[]; requestId: number }
  | { type: 'search/failed'; error: string; requestId: number }
  | { type: 'queue/added'; track: Track }
  | { type: 'queue/selected'; index: number }
  | { type: 'playback/updated'; snapshot: PlaybackSnapshot }
  | { type: 'lyrics/updated'; status: LyricsStatus; document?: LyricsDocument; error?: string }
  | { type: 'view/changed'; view: AppView };

export const initialAppState: AppState = {
  view: 'search',
  searchQuery: '',
  searchRequestId: 0,
  searchStatus: 'idle',
  results: [],
  queue: [],
  currentTrackIndex: -1,
  playback: {
    status: 'idle',
    positionMs: 0,
    durationMs: 0,
  },
  lyricsStatus: 'idle',
  lyricsDocument: null,
};

export function appStateReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'query/changed':
      return {
        ...state,
        searchQuery: action.query,
        searchRequestId: action.requestId ?? state.searchRequestId + 1,
        searchStatus: 'idle',
        searchError: undefined,
        results: [],
      };
    case 'search/started':
      return {
        ...state,
        searchRequestId: action.requestId,
        searchStatus: 'loading',
        searchError: undefined,
      };
    case 'search/succeeded':
      if (action.requestId !== undefined && action.requestId !== state.searchRequestId) return state;
      return {
        ...state,
        searchStatus: 'success',
        searchError: undefined,
        results: action.tracks,
      };
    case 'search/failed':
      if (action.requestId !== undefined && action.requestId !== state.searchRequestId) return state;
      return { ...state, searchStatus: 'error', searchError: action.error };
    case 'queue/added':
      return { ...state, queue: [...state.queue, action.track] };
    case 'queue/selected':
      if (action.index < 0 || action.index >= state.queue.length) return state;
      if (action.index === state.currentTrackIndex) return { ...state, view: 'player' };
      return {
        ...state,
        currentTrackIndex: action.index,
        view: 'player',
        playback: {
          status: 'loading',
          positionMs: 0,
          durationMs: state.queue[action.index].durationMs,
        },
      };
    case 'playback/updated': {
      if (action.snapshot.status === 'ended') {
        if (
          action.snapshot.loadId === undefined ||
          action.snapshot.loadId !== state.playback.loadId ||
          state.playback.status === 'ended'
        ) {
          return state;
        }

        const nextTrackIndex = state.currentTrackIndex + 1;
        if (nextTrackIndex < state.queue.length) {
          return {
            ...state,
            currentTrackIndex: nextTrackIndex,
            playback: {
              status: 'loading',
              positionMs: 0,
              durationMs: state.queue[nextTrackIndex].durationMs,
            },
          };
        }
      }

      if (
        action.snapshot.loadId !== undefined &&
        state.playback.loadId !== undefined &&
        action.snapshot.loadId < state.playback.loadId
      ) {
        return state;
      }
      return { ...state, playback: action.snapshot };
    }
    case 'lyrics/updated':
      return {
        ...state,
        lyricsStatus: action.status,
        lyricsDocument: action.document ?? null,
        lyricsError: action.error,
      };
    case 'view/changed':
      return { ...state, view: action.view };
  }
}
