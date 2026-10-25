import { canLeaveTextInput, moveTvFocus, type FocusCell, type FocusDirection } from '../focusNavigation';

export type MediaKeyAction = 'toggle' | 'play' | 'pause' | 'next' | 'previous' | 'seekForward' | 'seekBack';

export interface RemoteContext {
  /** Id of the overlay that currently owns focus, if any. Focus never leaves it. */
  overlayId?: number;
  /** Back at a tab root with nowhere to go is left to the system (it exits the app). */
  canGoBack(): boolean;
  /** Closes the top overlay, or pops navigation. */
  back(): void;
  /** Id of the active top-bar item that Up returns to. */
  activeNavId: string;
  media?(action: MediaKeyAction): void;
}

const DIRECTIONS: Record<string, FocusDirection | undefined> = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
};

/** webOS remote key codes that browsers do not name. */
const MEDIA_BY_CODE: Record<number, MediaKeyAction | undefined> = {
  415: 'play', 19: 'pause', 417: 'seekForward', 412: 'seekBack',
};
const MEDIA_BY_KEY: Record<string, MediaKeyAction | undefined> = {
  MediaPlayPause: 'toggle', MediaPlay: 'play', MediaPause: 'pause', MediaTrackNext: 'next', MediaTrackPrevious: 'previous',
  MediaFastForward: 'seekForward', MediaRewind: 'seekBack',
};

export function isBackKey(event: Pick<KeyboardEvent, 'key' | 'keyCode'>, editable: boolean): boolean {
  return event.key === 'Escape' || event.key === 'BrowserBack' || event.keyCode === 461 || (event.key === 'Backspace' && !editable);
}

const isEditable = (element: Element | null) =>
  !!element && ((element as HTMLElement).isContentEditable || element.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((element as HTMLInputElement).type) || element.tagName === 'TEXTAREA');

/** Focusable cells on screen, limited to one overlay when it is open. */
export function readFocusCells(root: ParentNode = document, overlayId?: number): FocusCell[] {
  const scope = overlayId === undefined ? root : root.querySelector(`[data-overlay-id="${overlayId}"]`);
  if (!scope) return [];
  return Array.from(scope.querySelectorAll<HTMLElement>('[data-focus-id]'))
    .filter((element) => element.getClientRects().length > 0)
    .map((element) => ({
      id: element.dataset.focusId ?? element.id,
      row: Number(element.dataset.focusRow ?? 0),
      column: Number(element.dataset.focusColumn ?? 0),
      disabled: (element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true',
    }));
}

export function focusById(id: string, root: ParentNode = document): boolean {
  const element = Array.from(root.querySelectorAll<HTMLElement>('[data-focus-id]')).find((candidate) => candidate.dataset.focusId === id);
  if (!element || (element as HTMLButtonElement).disabled) return false;
  element.focus();
  return true;
}

/**
 * One keydown handler for the whole app. Returns true when it consumed the event. Everything the
 * 0.3.0 handler did is kept (select left/right, scrollable panes, text-input edges, range sliders);
 * Back is now overlay-first and stack-aware, and overlays trap focus.
 */
export function handleRemoteKey(event: KeyboardEvent, context: RemoteContext, root: ParentNode = document): boolean {
  const target = (event.target as Element | null)?.closest<HTMLElement>('[data-focus-id]') ?? null;
  const editable = isEditable(target);

  const media = MEDIA_BY_KEY[event.key] ?? MEDIA_BY_CODE[event.keyCode];
  if (media && context.media && !editable) {
    event.preventDefault();
    context.media(media);
    return true;
  }

  if (isBackKey(event, editable)) {
    const menu = root.querySelector<HTMLDetailsElement>('.player-menu[open]');
    if (menu && context.overlayId === undefined) {
      event.preventDefault();
      menu.open = false;
      menu.querySelector<HTMLElement>('summary')?.focus();
      return true;
    }
    if (context.overlayId !== undefined || context.canGoBack()) {
      event.preventDefault();
      context.back();
      return true;
    }
    return false;
  }

  const direction = DIRECTIONS[event.key];
  if (!direction) return false;

  if (target instanceof HTMLSelectElement && (direction === 'left' || direction === 'right')) {
    // Horizontal arrows change the value; Enter still opens the platform's option picker.
    const options = Array.from(target.options);
    const step = direction === 'right' ? 1 : -1;
    let index = target.selectedIndex + step;
    while (index >= 0 && index < options.length && options[index].disabled) index += step;
    if (index >= 0 && index < options.length) {
      target.selectedIndex = index;
      target.dispatchEvent(new Event('change', { bubbles: true }));
    }
    event.preventDefault();
    return true;
  }

  if (target?.hasAttribute('data-scrollable') && (direction === 'up' || direction === 'down')) {
    const canScrollUp = target.scrollTop > 0;
    const canScrollDown = target.scrollTop + target.clientHeight < target.scrollHeight - 1;
    if ((direction === 'up' && canScrollUp) || (direction === 'down' && canScrollDown)) {
      target.scrollTop += direction === 'down' ? 140 : -140;
      event.preventDefault();
      return true;
    }
  }

  if (target instanceof HTMLInputElement && target.type === 'range' && (direction === 'left' || direction === 'right')) return false;

  if (target instanceof HTMLInputElement && (target.type === 'search' || target.type === 'text')) {
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? start;
    if (!canLeaveTextInput(direction, start, end, target.value.length)) return false;
  }

  const cells = readFocusCells(root, context.overlayId);
  const currentId = target?.dataset.focusId ?? '';
  const nextId = currentId
    ? moveTvFocus(currentId, direction, cells, context.activeNavId)
    : cells.find((cell) => !cell.disabled)?.id ?? '';

  if (nextId && nextId !== currentId) {
    focusById(nextId, root);
    event.preventDefault();
    return true;
  }
  if (!editable) event.preventDefault();
  return true;
}

// ---- focus and scroll memory ------------------------------------------------------------------

export interface FocusMemory { focusId?: string; scrollTop: number }

export function pageScroller(): { scrollTop: number } {
  return (typeof document !== 'undefined' && (document.querySelector<HTMLElement>('.is-tv-resolution .app-stage') ?? document.scrollingElement)) || { scrollTop: 0 };
}

export function captureFocus(root: ParentNode = document): FocusMemory {
  const active = document.activeElement as HTMLElement | null;
  const focusId = active?.dataset?.focusId;
  return { focusId: focusId && root.contains(active) ? focusId : undefined, scrollTop: pageScroller().scrollTop };
}

/** Returns true if the remembered element was focused again. */
export function restoreFocus(memory: { focusId?: string; scrollTop?: number }, root: ParentNode = document): boolean {
  if (memory.scrollTop !== undefined) pageScroller().scrollTop = memory.scrollTop;
  return memory.focusId ? focusById(memory.focusId, root) : false;
}

/** First focusable content element (row > 0), used when a new page opens. */
export function focusFirstContent(root: ParentNode = document, overlayId?: number): boolean {
  const first = readFocusCells(root, overlayId)
    // A control marked data-focus-skip (a Back arrow) is reachable with the remote but is not where a new page starts.
    .filter((cell) => cell.row > 0 && !cell.disabled && !root.querySelector(`[data-focus-id="${cell.id}"][data-focus-skip]`))
    .sort((a, b) => a.row - b.row || a.column - b.column)[0];
  return first ? focusById(first.id, root) : false;
}

/** Keeps the focused element visible without jumping the page. */
export function revealOnFocus(event: Pick<FocusEvent, 'target'>): void {
  const element = event.target as HTMLElement | null;
  if (element && typeof element.scrollIntoView === 'function' && element.dataset?.focusId) {
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
