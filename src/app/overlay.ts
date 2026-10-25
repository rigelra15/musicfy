export type OverlayKind =
  | 'playerMenu'
  | 'addToPlaylist'
  | 'createPlaylist'
  | 'duplicates'
  | 'sleepTimer'
  | 'speed'
  | 'output'
  | 'songDetails'
  | 'aboutSong'
  | 'studio'
  | 'lyricsProvider'
  | 'lyricsEditor'
  | 'lyricsTranslate'
  | 'confirm'
  | 'profile'
  | 'menuSlots'
  | 'pairing'
  | 'importPreview'
  | 'linkImport'
  | 'scrobbleAccount'
  | 'diagnostics'
  | 'actions';

export interface Overlay {
  id: number;
  kind: OverlayKind;
  /** Element to refocus once this overlay closes. */
  openerFocusId?: string;
  props?: Record<string, unknown>;
}

export interface OverlayState {
  stack: Overlay[];
  nextId: number;
}

export type OverlayAction =
  | { type: 'overlay/open'; kind: OverlayKind; openerFocusId?: string; props?: Record<string, unknown> }
  | { type: 'overlay/close'; id?: number }
  | { type: 'overlay/closeAll' };

export const initialOverlayState: OverlayState = { stack: [], nextId: 1 };

export function overlayReducer(state: OverlayState, action: OverlayAction): OverlayState {
  switch (action.type) {
    case 'overlay/open':
      return {
        stack: [...state.stack, { id: state.nextId, kind: action.kind, openerFocusId: action.openerFocusId, props: action.props }],
        nextId: state.nextId + 1,
      };
    case 'overlay/close': {
      if (state.stack.length === 0) return state;
      if (action.id === undefined) return { ...state, stack: state.stack.slice(0, -1) };
      return { ...state, stack: state.stack.filter((overlay) => overlay.id !== action.id) };
    }
    case 'overlay/closeAll':
      return state.stack.length === 0 ? state : { ...state, stack: [] };
  }
}

export function topOverlay(state: OverlayState): Overlay | undefined {
  return state.stack[state.stack.length - 1];
}
