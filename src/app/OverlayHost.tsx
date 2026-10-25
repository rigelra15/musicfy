import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from './AppContext';
import { focusById, focusFirstContent } from './remote';
import type { Overlay, OverlayKind } from './overlay';
import { focusProps } from './format';
import { EXIT_MS, motionAllowed } from './motion';
import { Icon } from '../components/Icon';
import type { Translate } from './i18n';

export interface OverlayHelpers { close(): void; t: Translate }
export type OverlayRenderer = (overlay: Overlay, helpers: OverlayHelpers) => ComponentChildren;

/** Overlay bodies register themselves here as their stages land (player menu, playlists, ...). */
const registry = new Map<OverlayKind, OverlayRenderer>();
export function registerOverlay(kind: OverlayKind, renderer: OverlayRenderer): void {
  registry.set(kind, renderer);
}

let pendingFocus: string | undefined;
/** Where focus goes when the overlay being closed is gone, instead of its opener (an action that moves the user elsewhere). */
export function focusAfterOverlay(focusId: string): void {
  pendingFocus = focusId;
}

export interface ActionItem { id: string; label: string; onSelect(): void; disabled?: boolean; reason?: string; /** Marks the current choice in a list of options (sort order, ...). */ selected?: boolean }

registerOverlay('confirm', (overlay, { close, t }) => {
  const props = overlay.props as { title: string; body?: string; confirmLabel?: string; onConfirm(): void } | undefined;
  return (
    <div class="overlay-panel">
      <h2>{props?.title}</h2>
      {props?.body && <p class="overlay-body">{props.body}</p>}
      <div class="overlay-actions">
        <button {...focusProps(`ov${overlay.id}-cancel`, 1, 0)} class="text-action" onClick={close}>{t('common.cancel')}</button>
        <button {...focusProps(`ov${overlay.id}-ok`, 1, 1)} class="text-action" onClick={() => { close(); props?.onConfirm(); }}>{props?.confirmLabel ?? t('common.confirm')}</button>
      </div>
    </div>
  );
});

registerOverlay('actions', (overlay, { close }) => {
  const props = overlay.props as { title?: string; actions: ActionItem[] } | undefined;
  return (
    <div class="overlay-panel">
      {props?.title && <h2>{props.title}</h2>}
      <div class="overlay-list">
        {(props?.actions ?? []).map((action, index) => (
          <button
            {...focusProps(`ov${overlay.id}-${action.id}`, index + 1, 0, action.disabled)}
            class={`overlay-item ${action.selected ? 'is-selected' : ''}`}
            aria-current={action.selected ? 'true' : undefined}
            onClick={() => { if (!action.disabled) { close(); action.onSelect(); } }}
            key={action.id}
          >
            <span>{action.label}</span>
            {action.selected && <Icon name="check" />}
            {action.disabled && action.reason && <small>{action.reason}</small>}
          </button>
        ))}
      </div>
    </div>
  );
});

export function OverlayHost() {
  const { store, closeOverlay, t } = useApp();
  const stack = store.overlays.stack;
  const previous = useRef<Overlay[]>([]);
  // A closed popup stays on screen for the length of its leave animation, then goes.
  const shown = useRef(new Map<number, Overlay>());
  const leaving = useRef(new Set<number>());
  const [, bump] = useState(0);
  const animate = motionAllowed();
  for (const overlay of stack) { shown.current.set(overlay.id, overlay); leaving.current.delete(overlay.id); }
  for (const [id, overlay] of shown.current) {
    if (stack.some((open) => open.id === id)) continue;
    if (animate) leaving.current.add(id); else { shown.current.delete(id); void overlay; }
  }

  useEffect(() => {
    const timers = [...leaving.current].map((id) => setTimeout(() => { leaving.current.delete(id); shown.current.delete(id); bump((n) => n + 1); }, EXIT_MS));
    return () => { timers.forEach(clearTimeout); };
  }, [stack]);

  useEffect(() => {
    const before = previous.current;
    previous.current = stack;
    const opened = stack.find((overlay) => !before.some((old) => old.id === overlay.id));
    const removed = before.filter((old) => !stack.some((overlay) => overlay.id === old.id));
    if (removed.length > 0 && stack.length === 0 || removed.length > 0 && !opened) {
      const opener = pendingFocus ?? removed[removed.length - 1].openerFocusId;
      pendingFocus = undefined;
      if (!(opener && focusById(opener))) focusFirstContent();
      return;
    }
    if (opened) focusFirstContent(document, opened.id);
  }, [stack]);

  const layers = [...shown.current.values()].sort((a, b) => a.id - b.id);
  if (layers.length === 0) return null;
  return (
    <div class="overlay-root">
      {layers.map((overlay) => {
        const isLeaving = leaving.current.has(overlay.id);
        const index = stack.findIndex((open) => open.id === overlay.id);
        const isTop = !isLeaving && index === stack.length - 1;
        const render = registry.get(overlay.kind);
        return (
          <div
            class={`overlay-layer ${isLeaving ? 'is-leaving' : isTop ? 'is-top' : 'is-below'}`}
            data-overlay-id={overlay.id}
            data-overlay-kind={overlay.kind}
            role="dialog"
            aria-modal="true"
            aria-hidden={isTop ? undefined : 'true'}
            inert={isLeaving ? true : undefined}
            key={overlay.id}
            onPointerDown={(event) => { if (isTop && event.target === event.currentTarget) closeOverlay(overlay.id); }}
          >
            {render ? render(overlay, { close: () => closeOverlay(overlay.id), t }) : null}
          </div>
        );
      })}
    </div>
  );
}
