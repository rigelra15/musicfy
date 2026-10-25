export type Tab = 'home' | 'search' | 'library' | 'player' | 'settings';
export const TABS: readonly Tab[] = ['home', 'search', 'library', 'player', 'settings'];

export type LibrarySection = 'root' | 'songs' | 'playlists' | 'albums' | 'artists' | 'added' | 'liked';
export type LibraryShelf = 'all' | 'local' | 'cached' | 'imported';
export type SearchFilter = 'all' | 'songs' | 'artists' | 'videos' | 'albums' | 'playlists' | 'community';
export type ArtistTab = 'overview' | 'songs' | 'albums' | 'similar' | 'items';

/** Detail routes carry entity ids, never titles. */
export type Route =
  | { name: 'home' }
  | { name: 'section'; sectionId: string; title: string }
  | { name: 'search'; query?: string; filter?: SearchFilter }
  | { name: 'genre'; browseId: string; params?: string; title: string }
  | { name: 'album'; id: string }
  | { name: 'artist'; id: string; tab?: ArtistTab; browseId?: string; params?: string; title?: string }
  | { name: 'playlist'; id: string; origin: 'online' | 'local' | 'auto' }
  | { name: 'library'; section?: LibrarySection; shelf?: LibraryShelf; source?: string }
  | { name: 'history' }
  | { name: 'stats' }
  | { name: 'profile' }
  | { name: 'player' }
  | { name: 'settings'; page?: string }
  | { name: 'import'; page?: string; source?: string }
  | { name: 'modules'; moduleId?: string }
  | { name: 'diagnostics' };

type DetailRoute = Extract<Route, { name: 'album' | 'artist' | 'playlist' }>;

export function tabOf(route: Exclude<Route, DetailRoute>): Tab {
  switch (route.name) {
    case 'home':
    case 'section':
      return 'home';
    case 'search':
    case 'genre':
      return 'search';
    case 'library':
    case 'history':
    case 'stats':
      return 'library';
    case 'player':
      return 'player';
    case 'settings':
    case 'profile':
    case 'import':
    case 'modules':
    case 'diagnostics':
      return 'settings';
  }
}

function isDetail(route: Route): route is DetailRoute {
  return route.name === 'album' || route.name === 'artist' || route.name === 'playlist';
}

export function routeKey(route: Route): string {
  return JSON.stringify(route);
}

export interface StackEntry {
  route: Route;
  /** Focus/scroll to restore when this entry becomes visible again. */
  focusId?: string;
  scrollTop?: number;
}

export interface NavState {
  tab: Tab;
  stacks: Record<Tab, StackEntry[]>;
  /** The tab the user was on before the player, for Back from the player. */
  cameFrom: Tab;
  hasTrack: boolean;
}

export type NavAction =
  | { type: 'nav/go'; route: Route }
  | { type: 'nav/tab'; tab: Tab }
  | { type: 'nav/back' }
  | { type: 'nav/remember'; focusId?: string; scrollTop?: number }
  | { type: 'nav/hasTrack'; value: boolean };

const rootRoute: Record<Tab, Route> = {
  home: { name: 'home' },
  search: { name: 'search' },
  library: { name: 'library' },
  player: { name: 'player' },
  settings: { name: 'settings' },
};

export const initialNavState: NavState = {
  tab: 'home',
  stacks: {
    home: [{ route: rootRoute.home }],
    search: [{ route: rootRoute.search }],
    library: [{ route: rootRoute.library }],
    player: [{ route: rootRoute.player }],
    settings: [{ route: rootRoute.settings }],
  },
  cameFrom: 'home',
  hasTrack: false,
};

export function currentEntry(state: NavState): StackEntry {
  const stack = state.stacks[state.tab];
  return stack[stack.length - 1];
}

export function currentRoute(state: NavState): Route {
  return currentEntry(state).route;
}

function withStack(state: NavState, tab: Tab, stack: StackEntry[]): NavState {
  return { ...state, stacks: { ...state.stacks, [tab]: stack } };
}

/** What Back does at the root of a tab, or null when the system should handle it (exit the app). */
export function rootBackTarget(state: NavState): Tab | null {
  switch (state.tab) {
    case 'home':
      return null;
    case 'player':
      return state.cameFrom === 'player' ? 'home' : state.cameFrom;
    default:
      return 'home';
  }
}

export function canGoBack(state: NavState): boolean {
  return state.stacks[state.tab].length > 1 || rootBackTarget(state) !== null;
}

export function navReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case 'nav/hasTrack':
      return state.hasTrack === action.value ? state : { ...state, hasTrack: action.value };
    case 'nav/remember': {
      const stack = state.stacks[state.tab];
      const top = { ...stack[stack.length - 1], focusId: action.focusId, scrollTop: action.scrollTop };
      return withStack(state, state.tab, [...stack.slice(0, -1), top]);
    }
    case 'nav/tab': {
      const entering = action.tab;
      const comesFromContent = state.tab !== 'player';
      const cameFrom = entering === 'player' && comesFromContent ? state.tab : state.cameFrom;
      if (entering === state.tab) {
        // Selecting the active tab again returns to its root.
        return state.stacks[entering].length > 1 ? withStack({ ...state, cameFrom }, entering, [{ route: rootRoute[entering] }]) : state;
      }
      return { ...state, tab: entering, cameFrom };
    }
    case 'nav/go': {
      const route = action.route;
      if (isDetail(route)) {
        const stack = state.stacks[state.tab];
        const last = stack[stack.length - 1];
        if (routeKey(last.route) === routeKey(route)) return state;
        return withStack(state, state.tab, [...stack, { route }]);
      }
      const target = tabOf(route);
      const comesFromContent = state.tab !== 'player';
      const cameFrom = target === 'player' && comesFromContent ? state.tab : state.cameFrom;
      const isRoot = routeKey(route) === routeKey(rootRoute[target]);
      const stack = state.stacks[target];
      if (isRoot) return withStack({ ...state, tab: target, cameFrom }, target, [{ route }]);
      if (target === state.tab && routeKey(stack[stack.length - 1].route) === routeKey(route)) return state;
      return withStack({ ...state, tab: target, cameFrom }, target, [...stack, { route }]);
    }
    case 'nav/back': {
      const stack = state.stacks[state.tab];
      if (stack.length > 1) return withStack(state, state.tab, stack.slice(0, -1));
      const target = rootBackTarget(state);
      return target === null ? state : { ...state, tab: target };
    }
  }
}
