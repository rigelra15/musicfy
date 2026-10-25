import { describe, expect, it } from 'vitest';
import {
  canLeaveTextInput,
  moveFocus,
  moveTvFocus,
  type FocusCell,
  type FocusDirection,
} from './focusNavigation';

const cells: FocusCell[] = [
  { id: 'top-left', row: 0, column: 0 },
  { id: 'top-middle', row: 0, column: 1 },
  { id: 'top-right', row: 0, column: 2 },
  { id: 'bottom-left', row: 1, column: 0 },
  { id: 'bottom-middle', row: 1, column: 1 },
  { id: 'bottom-right', row: 1, column: 2 },
];

describe('moveFocus', () => {
  it.each([
    ['left', 'top-middle', 'top-left'],
    ['right', 'top-middle', 'top-right'],
    ['up', 'bottom-middle', 'top-middle'],
    ['down', 'top-middle', 'bottom-middle'],
  ] as const)('moves %s to the nearest cell in that direction', (direction, current, expected) => {
    expect(moveFocus(current, direction as FocusDirection, cells)).toBe(expected);
  });

  it('skips disabled cells while moving', () => {
    const cellsWithDisabledMiddle = [
      cells[0],
      { ...cells[1], disabled: true },
      cells[2],
    ];

    expect(moveFocus('top-left', 'right', cellsWithDisabledMiddle)).toBe('top-right');
  });

  it('keeps focus at a grid edge when no cell exists in that direction', () => {
    expect(moveFocus('top-left', 'left', cells)).toBe('top-left');
  });

  it('returns the current id when the focused cell is unknown', () => {
    expect(moveFocus('missing', 'right', cells)).toBe('missing');
  });

  it('keeps horizontal arrows in the text until the caret reaches that edge', () => {
    expect(canLeaveTextInput('left', 2, 2, 5)).toBe(false);
    expect(canLeaveTextInput('right', 2, 2, 5)).toBe(false);
  });

  it('allows focus to leave a text input at the caret edge', () => {
    expect(canLeaveTextInput('left', 0, 0, 5)).toBe(true);
    expect(canLeaveTextInput('right', 5, 5, 5)).toBe(true);
  });

  it('keeps a selected text range inside the input', () => {
    expect(canLeaveTextInput('right', 1, 4, 5)).toBe(false);
  });
});

describe('TV top navigation', () => {
  const tvCells: FocusCell[] = [
    { id: 'nav-search', row: 0, column: 0 },
    { id: 'nav-player', row: 0, column: 1, disabled: true },
    { id: 'nav-queue', row: 0, column: 2 },
    { id: 'query', row: 1, column: 0 },
    { id: 'submit', row: 1, column: 1 },
    { id: 'result', row: 2, column: 0 },
  ];

  it('moves horizontally through enabled tabs without falling into page content', () => {
    expect(moveTvFocus('nav-search', 'right', tvCells, 'nav-search')).toBe('nav-queue');
    expect(moveTvFocus('nav-queue', 'right', tvCells, 'nav-search')).toBe('nav-queue');
  });

  it('enters page content with Down and returns to the selected tab with Up', () => {
    expect(moveTvFocus('nav-queue', 'down', tvCells, 'nav-queue')).toBe('query');
    expect(moveTvFocus('query', 'up', tvCells, 'nav-queue')).toBe('nav-queue');
    expect(moveTvFocus('result', 'up', tvCells, 'nav-search')).toBe('query');
  });

  it('keeps focus in navigation when there are no enabled page controls', () => {
    expect(moveTvFocus('nav-search', 'down', tvCells.slice(0, 3), 'nav-search')).toBe('nav-search');
  });
});
