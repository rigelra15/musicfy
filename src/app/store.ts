import { currentTrack } from '../playback/queueModel';
import { initialNavState, navReducer, type NavAction, type NavState } from './router';
import { initialOverlayState, overlayReducer, type OverlayAction, type OverlayState } from './overlay';
import { initialRootState, rootReducer, type RootAction, type RootState } from './rootState';

export interface AppStore {
  root: RootState;
  nav: NavState;
  overlays: OverlayState;
}

export type AppAction = RootAction | NavAction | OverlayAction;

export const initialAppStore: AppStore = {
  root: initialRootState,
  nav: initialNavState,
  overlays: initialOverlayState,
};

const isNav = (action: AppAction): action is NavAction => action.type.startsWith('nav/');
const isOverlay = (action: AppAction): action is OverlayAction => action.type.startsWith('overlay/');

/**
 * One reducer for the three independent pieces. Navigation and overlays never touch playback:
 * changing page cannot reload the audio, which is what keeps music running while the user browses.
 */
export function appReducer(store: AppStore, action: AppAction): AppStore {
  if (isNav(action)) {
    const nav = navReducer(store.nav, action);
    return nav === store.nav ? store : { ...store, nav };
  }
  if (isOverlay(action)) {
    const overlays = overlayReducer(store.overlays, action);
    return overlays === store.overlays ? store : { ...store, overlays };
  }
  const root = rootReducer(store.root, action);
  if (root === store.root) return store;
  const hasTrack = currentTrack(root.queue) !== null;
  const nav = navReducer(store.nav, { type: 'nav/hasTrack', value: hasTrack });
  return { ...store, root, nav };
}
