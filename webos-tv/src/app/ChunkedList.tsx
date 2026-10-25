import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

interface Props<T> {
  items: readonly T[];
  /** Rows rendered first and added each time focus nears the end. */
  chunk?: number;
  render(item: T, index: number): ComponentChildren;
  class?: string;
  ariaLabel?: string;
  /** Make sure the item at this index (and the chunk after it) is mounted, e.g. after jumping to a letter. */
  reveal?: number;
}

/**
 * Renders big lists in slices so a 5,000-song collection never mounts 5,000 buttons at once on a
 * TV. More rows are added when focus gets within a few rows of the end, so D-pad scrolling feels
 * continuous. `items` replaced by a different list resets to the first slice.
 */
export function ChunkedList<T>({ items, chunk = 60, render, class: className, ariaLabel, reveal }: Props<T>) {
  const [shown, setShown] = useState(chunk);
  const source = useRef(items);
  if (source.current !== items) {
    source.current = items;
    if (shown !== chunk) setShown(chunk);
  }
  const limit = Math.min(Math.max(shown, reveal === undefined ? 0 : reveal + chunk), items.length);
  useEffect(() => { if (shown < chunk) setShown(chunk); }, [chunk]);
  return (
    <div
      class={className}
      aria-label={ariaLabel}
      onFocusCapture={(event) => {
        const row = (event.target as HTMLElement).closest<HTMLElement>('[data-chunk-index]');
        if (!row) return;
        const index = Number(row.dataset.chunkIndex);
        if (index >= limit - 8 && limit < items.length) setShown((value) => Math.min(items.length, value + chunk));
      }}
    >
      {items.slice(0, limit).map((item, index) => (
        <div class="chunk-row" data-chunk-index={index} key={index}>{render(item, index)}</div>
      ))}
    </div>
  );
}
