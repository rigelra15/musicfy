import { describe, expect, it } from 'vitest';
import { activeIndex, currentLineIndex, groupFinished, lineGroups, linesToPaint, pieceProgress } from './paint';

describe('frame painting', () => {
  it('paints everything once, then only the line being sung', () => {
    expect(linesToPaint(undefined, 3, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(linesToPaint(3, 3, 200)).toEqual([3]);
  });
  it('paints the line that was left and the one entered', () => {
    expect(linesToPaint(3, 4, 200)).toEqual([3, 4]);
    expect(linesToPaint(4, 3, 200)).toEqual([3, 4]);
  });
  it('a seek repaints exactly the lines it crossed, either way, and never more than the song has', () => {
    expect(linesToPaint(2, 6, 200)).toEqual([2, 3, 4, 5, 6]);
    expect(linesToPaint(6, 2, 200)).toEqual([2, 3, 4, 5, 6]);
    expect(linesToPaint(-1, 1, 3)).toEqual([0, 1]);
    expect(linesToPaint(1, 99, 3)).toEqual([1, 2]);
    expect(linesToPaint(0, 0, 0)).toEqual([]);
  });
  it('a frame in a long song touches a handful of lines, not all of them', () => {
    let previous: number | undefined;
    let touched = 0;
    for (let t = 0; t < 600; t += 1) { const next = Math.floor(t / 3); touched += linesToPaint(previous, next, 200).length; previous = next; }
    expect(touched).toBeLessThan(200 + 600 * 2);
  });
  it('finds the line being sung, before the first line, and after a seek in both directions', () => {
    const times = [1000, 2000, 3000, 4000];
    expect(activeIndex(times, 500)).toBe(-1);
    expect(activeIndex(times, 1000)).toBe(0);
    expect(activeIndex(times, 2999)).toBe(1);
    expect(activeIndex(times, 9999, 0)).toBe(3);
    expect(activeIndex(times, 1500, 3)).toBe(0);
    expect(activeIndex([], 100)).toBe(-1);
  });
  it('progress is 0 to 100 in tenths and equals the end for pieces with no length', () => {
    expect(pieceProgress(1500, 1000, 2000)).toBe(50);
    expect(pieceProgress(500, 1000, 2000)).toBe(0);
    expect(pieceProgress(2500, 1000, 2000)).toBe(100);
    expect(pieceProgress(900, 1000, 1000)).toBe(0);
    expect(pieceProgress(1000, 1000, 1000)).toBe(100);
  });
});

describe('currentLineIndex', () => {
  const lines = [
    { timeMs: 0, text: 'sebelum', words: [{ text: 'sebelum', startMs: 0, endMs: 2000 }] },
    { timeMs: 3000, text: 'They\'ll see in time, I know', words: [{ text: 'They\'ll', startMs: 3000, endMs: 4000 }, { text: 'know', startMs: 7000, endMs: 8000 }] },
    { timeMs: 5000, text: '(They\'ll see in time)', isBackground: true, words: [{ text: 'time)', startMs: 5000, endMs: 6500 }] },
    { timeMs: 9000, text: 'sesudah' },
  ];
  it('keeps the main line as the current one while an echo line is sung over it, then lets the echo take over', () => {
    expect(currentLineIndex(lines, 1000)).toBe(0);
    expect(currentLineIndex(lines, 4000)).toBe(1);
    expect(currentLineIndex(lines, 5500)).toBe(1);        // the echo has started but the main line goes on until 8000
    expect(currentLineIndex(lines, 8500)).toBe(2);        // the main line is over: now the echo
    expect(currentLineIndex(lines, 9500)).toBe(3);
    expect(currentLineIndex(lines, -5)).toBe(-1);
  });
  it('a background line with no main line before it is just the current line', () => {
    expect(currentLineIndex([{ timeMs: 0, text: '(oh)', isBackground: true }], 500)).toBe(0);
  });
});

describe('lineGroups', () => {
  const line = (timeMs: number, text: string, isBackground = false, endMs?: number) => ({ timeMs, text, isBackground, ...(endMs ? { words: [{ text, startMs: timeMs, endMs }] } : {}) });
  it('puts an echo line that starts while the main line is still sung with that line, in source order', () => {
    const lines = [line(0, 'main', false, 4000), line(2000, '(echo)', true, 3500), line(5000, 'next', false, 8000)];
    expect(lineGroups(lines as never)).toEqual([[0, 1], [2]]);
  });
  it('leaves a background line that starts after the main line ended, and plain lines, on their own', () => {
    const lines = [line(0, 'main', false, 2000), line(3000, '(later)', true, 4000), line(5000, 'next')];
    expect(lineGroups(lines as never)).toEqual([[0], [1], [2]]);
  });
});

describe('groupFinished', () => {
  const word = (timeMs: number, endMs: number, text: string, isBackground = false) => ({ timeMs, text, isBackground, words: [{ text, startMs: timeMs, endMs }] });
  const lines = [word(0, 2000, 'one'), word(1500, 3000, '(echo)', true), word(8000, 9000, 'two')];
  const groups = lineGroups(lines as never);
  it('is sung from its start to its last word (the latest of the group) plus a short tail', () => {
    expect(groups).toEqual([[0, 1], [2]]);
    expect(groupFinished(lines as never, groups, 0, 100)).toBe(false);
    expect(groupFinished(lines as never, groups, 0, 2500)).toBe(false);   // the line ended but the echo is still being sung
    expect(groupFinished(lines as never, groups, 0, 3100)).toBe(false);   // inside the tail
    expect(groupFinished(lines as never, groups, 0, 3300)).toBe(true);    // a pause in the singing: nothing is highlighted
  });
  it('hands over at the next start even inside the tail, and an unknown group is never finished', () => {
    const close = [word(0, 1000, 'a'), word(1100, 2000, 'b')];
    const g = lineGroups(close as never);
    expect(groupFinished(close as never, g, 0, 1050)).toBe(false);
    expect(groupFinished(close as never, g, 0, 1100)).toBe(true);
    expect(groupFinished(close as never, g, 5, 0)).toBe(false);
  });
});
