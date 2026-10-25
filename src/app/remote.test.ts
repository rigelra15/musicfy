// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureFocus, pageScroller, focusFirstContent, handleRemoteKey, readFocusCells, restoreFocus, type RemoteContext } from './remote';

beforeEach(() => {
  // jsdom has no layout; treat every element as laid out unless it is hidden.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.closest('[hidden]') ? [] : [{}]) as unknown as DOMRectList;
  });
});
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

function page(html: string) { document.body.innerHTML = html; }
const key = (target: Element | null, init: KeyboardEventInit & { keyCode?: number }) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (init.keyCode !== undefined) Object.defineProperty(event, 'keyCode', { value: init.keyCode });
  Object.defineProperty(event, 'target', { value: target });
  return event;
};
const focusable = (id: string, row: number, column: number, tag = 'button', extra = '') =>
  `<${tag} data-focus-id="${id}" data-focus-row="${row}" data-focus-column="${column}" ${extra}>${id}</${tag}>`;
const ctx = (over: Partial<RemoteContext> = {}): RemoteContext & { backs: number } => {
  const context = { backs: 0, activeNavId: 'nav-home', canGoBack: () => true, back() { context.backs += 1; }, ...over } as RemoteContext & { backs: number };
  return context;
};
const active = () => (document.activeElement as HTMLElement | null)?.dataset.focusId;

describe('D-pad navigation', () => {
  it('moves between nav items and into content, and Up from the first row returns to the active nav item', () => {
    page(focusable('nav-home', 0, 0) + focusable('nav-search', 0, 1) + focusable('a', 1, 0) + focusable('b', 2, 0));
    const c = ctx();
    document.getElementById('x');
    (document.querySelector('[data-focus-id="nav-home"]') as HTMLElement).focus();
    handleRemoteKey(key(document.activeElement, { key: 'ArrowRight' }), c);
    expect(active()).toBe('nav-search');
    handleRemoteKey(key(document.activeElement, { key: 'ArrowDown' }), c);
    expect(active()).toBe('a');
    handleRemoteKey(key(document.activeElement, { key: 'ArrowDown' }), c);
    expect(active()).toBe('b');
    handleRemoteKey(key(document.activeElement, { key: 'ArrowUp' }), c);
    handleRemoteKey(key(document.activeElement, { key: 'ArrowUp' }), c);
    expect(active()).toBe('nav-home');
  });

  it('skips disabled controls', () => {
    page(focusable('a', 1, 0) + focusable('b', 2, 0, 'button', 'disabled') + focusable('c', 3, 0));
    (document.querySelector('[data-focus-id="a"]') as HTMLElement).focus();
    handleRemoteKey(key(document.activeElement, { key: 'ArrowDown' }), ctx());
    expect(active()).toBe('c');
  });

  it('lets a range slider keep Left/Right and a text field keep them until its edge', () => {
    page(focusable('seek', 1, 0, 'input', 'type="range"') + focusable('q', 2, 0, 'input', 'type="search" value="abc"') + focusable('z', 2, 1));
    const seek = document.querySelector('[data-focus-id="seek"]') as HTMLInputElement;
    seek.focus();
    expect(handleRemoteKey(key(seek, { key: 'ArrowRight' }), ctx())).toBe(false);
    const field = document.querySelector('[data-focus-id="q"]') as HTMLInputElement;
    field.focus();
    field.setSelectionRange(1, 1);
    expect(handleRemoteKey(key(field, { key: 'ArrowRight' }), ctx())).toBe(false);
    field.setSelectionRange(3, 3);
    handleRemoteKey(key(field, { key: 'ArrowRight' }), ctx());
    expect(active()).toBe('z');
  });

  it('changes a select with Left/Right and still moves rows with Up/Down', () => {
    page(`<select data-focus-id="s" data-focus-row="1" data-focus-column="0"><option>1</option><option>2</option><option disabled>3</option></select>` + focusable('b', 2, 0));
    const select = document.querySelector('select') as HTMLSelectElement;
    select.focus();
    handleRemoteKey(key(select, { key: 'ArrowRight' }), ctx());
    expect(select.selectedIndex).toBe(1);
    handleRemoteKey(key(select, { key: 'ArrowRight' }), ctx());
    expect(select.selectedIndex).toBe(1);
    handleRemoteKey(key(select, { key: 'ArrowDown' }), ctx());
    expect(active()).toBe('b');
  });

  it('scrolls a scrollable pane before leaving it', () => {
    page(focusable('pane', 1, 0, 'div', 'data-scrollable tabindex="0"') + focusable('next', 2, 0));
    const pane = document.querySelector('[data-focus-id="pane"]') as HTMLElement;
    Object.defineProperty(pane, 'clientHeight', { value: 100, configurable: true });
    Object.defineProperty(pane, 'scrollHeight', { value: 400, configurable: true });
    pane.focus();
    handleRemoteKey(key(pane, { key: 'ArrowDown' }), ctx());
    expect(pane.scrollTop).toBeGreaterThan(0);
    expect(active()).toBe('pane');
  });
});

describe('Back and overlays', () => {
  it('closes the top overlay first, then pops navigation, and leaves root Back to the system', () => {
    page(focusable('a', 1, 0));
    const withOverlay = ctx({ overlayId: 4 });
    const e1 = key(null, { key: 'Escape' });
    expect(handleRemoteKey(e1, withOverlay)).toBe(true);
    expect(e1.defaultPrevented).toBe(true);
    expect(withOverlay.backs).toBe(1);
    const nav = ctx();
    handleRemoteKey(key(null, { key: 'BrowserBack' }), nav);
    handleRemoteKey(key(null, { key: 'x', keyCode: 461 }), nav);
    expect(nav.backs).toBe(2);
    const root = ctx({ canGoBack: () => false });
    const e2 = key(null, { key: 'Escape' });
    expect(handleRemoteKey(e2, root)).toBe(false);
    expect(e2.defaultPrevented).toBe(false);
    expect(root.backs).toBe(0);
  });

  it('does not treat Backspace in a text field as Back', () => {
    page(focusable('q', 1, 0, 'input', 'type="search"'));
    const field = document.querySelector('input') as HTMLInputElement;
    field.focus();
    const c = ctx();
    expect(handleRemoteKey(key(field, { key: 'Backspace' }), c)).toBe(false);
    expect(c.backs).toBe(0);
  });

  it('traps focus inside the open overlay: nav and page content are unreachable', () => {
    page(focusable('nav-home', 0, 0) + focusable('page', 1, 0) + `<div data-overlay-id="7">${focusable('o1', 1, 0)}${focusable('o2', 2, 0)}</div>`);
    const c = ctx({ overlayId: 7 });
    expect(readFocusCells(document, 7).map((cell) => cell.id)).toEqual(['o1', 'o2']);
    (document.querySelector('[data-focus-id="o1"]') as HTMLElement).focus();
    handleRemoteKey(key(document.activeElement, { key: 'ArrowDown' }), c);
    expect(active()).toBe('o2');
    handleRemoteKey(key(document.activeElement, { key: 'ArrowDown' }), c);
    expect(active()).toBe('o2');
    handleRemoteKey(key(document.activeElement, { key: 'ArrowUp' }), c);
    handleRemoteKey(key(document.activeElement, { key: 'ArrowUp' }), c);
    expect(active()).toBe('o1');
  });
});

describe('media keys and memory', () => {
  it('maps remote media keys to actions', () => {
    const seen: string[] = [];
    const c = ctx({ media: (a) => seen.push(a) });
    for (const init of [{ key: 'MediaPlayPause' }, { key: 'x', keyCode: 415 }, { key: 'x', keyCode: 19 }, { key: 'MediaTrackNext' }, { key: 'x', keyCode: 417 }, { key: 'x', keyCode: 412 }]) {
      handleRemoteKey(key(null, init), c);
    }
    expect(seen).toEqual(['toggle', 'play', 'pause', 'next', 'seekForward', 'seekBack']);
  });

  it('remembers and restores the focused element, and focuses the first content cell', () => {
    page(focusable('nav-home', 0, 0) + focusable('a', 1, 0) + focusable('b', 2, 0));
    (document.querySelector('[data-focus-id="b"]') as HTMLElement).focus();
    const memory = captureFocus();
    expect(memory.focusId).toBe('b');
    (document.querySelector('[data-focus-id="a"]') as HTMLElement).focus();
    expect(restoreFocus(memory)).toBe(true);
    expect(active()).toBe('b');
    expect(restoreFocus({ focusId: 'gone' })).toBe(false);
    expect(focusFirstContent()).toBe(true);
    expect(active()).toBe('a');
  });
});

it('remembers logical page scrolling independently of the clipped screen frame', () => {
  page(`<div class="is-tv-resolution"><main class="app-stage">${focusable('a', 1, 0)}${focusable('b', 2, 0)}</main></div>`);
  const stage = document.querySelector<HTMLElement>('.app-stage')!;
  expect(pageScroller()).toBe(stage);
  stage.scrollTop = 540;
  (document.querySelector('[data-focus-id="b"]') as HTMLElement).focus();
  const memory = captureFocus();
  expect(memory).toEqual({ focusId:'b', scrollTop:540 });
  stage.scrollTop = 0;
  expect(restoreFocus(memory)).toBe(true);
  expect(stage.scrollTop).toBe(540);
  expect(active()).toBe('b');
});
