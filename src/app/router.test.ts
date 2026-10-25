import { describe, expect, it } from 'vitest';
import { canGoBack, currentRoute, initialNavState, navReducer, rootBackTarget, type NavAction, type NavState } from './router';
import { initialOverlayState, overlayReducer, topOverlay } from './overlay';

const run = (state: NavState, ...actions: NavAction[]) => actions.reduce(navReducer, state);

describe('router', () => {
  it('starts on Beranda', () => {
    expect(initialNavState.tab).toBe('home');
    expect(currentRoute(initialNavState)).toEqual({ name: 'home' });
  });

  it('keeps one stack per tab and pushes details on the tab they were opened from', () => {
    let s = run(initialNavState, { type: 'nav/tab', tab: 'search' }, { type: 'nav/go', route: { name: 'artist', id: 'UC1' } });
    expect(s.tab).toBe('search');
    expect(s.stacks.search).toHaveLength(2);
    s = run(s, { type: 'nav/go', route: { name: 'album', id: 'MPRE1' } });
    expect(s.stacks.search).toHaveLength(3);
    s = run(s, { type: 'nav/tab', tab: 'library' }, { type: 'nav/tab', tab: 'search' });
    expect(currentRoute(s)).toEqual({ name: 'album', id: 'MPRE1' });
    expect(s.stacks.home).toHaveLength(1);
  });

  it('does not push the same detail twice', () => {
    const go: NavAction = { type: 'nav/go', route: { name: 'album', id: 'A' } };
    expect(run(initialNavState, go, go).stacks.home).toHaveLength(2);
  });

  it('pops details with Back and restores the remembered focus of the page below', () => {
    let s = run(initialNavState, { type: 'nav/remember', focusId: 'card-3', scrollTop: 240 }, { type: 'nav/go', route: { name: 'album', id: 'A' } });
    s = run(s, { type: 'nav/back' });
    expect(currentRoute(s)).toEqual({ name: 'home' });
    expect(s.stacks.home[0]).toMatchObject({ focusId: 'card-3', scrollTop: 240 });
  });

  it('selecting the active tab again returns to its root', () => {
    const s = run(initialNavState, { type: 'nav/go', route: { name: 'album', id: 'A' } }, { type: 'nav/tab', tab: 'home' });
    expect(s.stacks.home).toHaveLength(1);
  });

  it('routes the player as a tab and returns to where the user came from', () => {
    const s = run(initialNavState, { type: 'nav/tab', tab: 'library' }, { type: 'nav/go', route: { name: 'player' } });
    expect(s.tab).toBe('player');
    expect(s.cameFrom).toBe('library');
    expect(run(s, { type: 'nav/back' }).tab).toBe('library');
  });

  it('leaves Back at the root of Beranda to the system', () => {
    expect(rootBackTarget(initialNavState)).toBeNull();
    expect(canGoBack(initialNavState)).toBe(false);
    expect(run(initialNavState, { type: 'nav/back' })).toBe(initialNavState);
  });

  it('sends the other tab roots home', () => {
    expect(rootBackTarget(run(initialNavState, { type: 'nav/tab', tab: 'settings' }))).toBe('home');
  });

  it('opens library, settings and search routes on their tabs', () => {
    expect(run(initialNavState, { type: 'nav/go', route: { name: 'library', section: 'liked' } }).tab).toBe('library');
    expect(run(initialNavState, { type: 'nav/go', route: { name: 'modules' } }).tab).toBe('settings');
    expect(run(initialNavState, { type: 'nav/go', route: { name: 'search', query: 'abc' } }).tab).toBe('search');
  });
});

describe('overlays', () => {
  it('closes the topmost overlay first and remembers the opener', () => {
    let s = overlayReducer(initialOverlayState, { type: 'overlay/open', kind: 'playerMenu', openerFocusId: 'player-more' });
    s = overlayReducer(s, { type: 'overlay/open', kind: 'speed', openerFocusId: 'menu-speed' });
    expect(topOverlay(s)?.kind).toBe('speed');
    expect(topOverlay(s)?.openerFocusId).toBe('menu-speed');
    s = overlayReducer(s, { type: 'overlay/close' });
    expect(topOverlay(s)?.kind).toBe('playerMenu');
    s = overlayReducer(s, { type: 'overlay/close' });
    expect(topOverlay(s)).toBeUndefined();
    expect(overlayReducer(s, { type: 'overlay/close' })).toBe(s);
  });

  it('can close by id and close all', () => {
    let s = overlayReducer(initialOverlayState, { type: 'overlay/open', kind: 'speed' });
    s = overlayReducer(s, { type: 'overlay/open', kind: 'sleepTimer' });
    s = overlayReducer(s, { type: 'overlay/close', id: 1 });
    expect(s.stack.map((o) => o.kind)).toEqual(['sleepTimer']);
    expect(overlayReducer(s, { type: 'overlay/closeAll' }).stack).toEqual([]);
  });
});
