import { describe, expect, it } from 'vitest';
import { activeLyricsLineIndex, parseLrc } from './lrcParser';

describe('parseLrc', () => {
  it('expands multiple timestamps and returns lines in playback order', () => {
    expect(parseLrc('[00:02.00]Kedua\n[00:01.50][00:03.25]Pertama')).toEqual([
      { timeMs: 1500, text: 'Pertama' },
      { timeMs: 2000, text: 'Kedua' },
      { timeMs: 3250, text: 'Pertama' },
    ]);
  });

  it('normalizes one, two, and three fractional timestamp digits', () => {
    expect(parseLrc('[00:01.2]Satu\n[00:02.34]Dua\n[00:03.345]Tiga')).toEqual([
      { timeMs: 1200, text: 'Satu' },
      { timeMs: 2340, text: 'Dua' },
      { timeMs: 3345, text: 'Tiga' },
    ]);
  });

  it('ignores malformed timestamps and metadata rows', () => {
    expect(parseLrc('[ar:Senja]\n[xx:yy]Bukan lirik\n[00:04.00]Lirik benar')).toEqual([
      { timeMs: 4000, text: 'Lirik benar' },
    ]);
  });

  it('preserves lyric order for duplicate timestamps', () => {
    expect(parseLrc('[00:01.00]A\n[00:01.00]B')).toEqual([
      { timeMs: 1000, text: 'A' },
      { timeMs: 1000, text: 'B' },
    ]);
  });

  it('returns no timed rows for plain lyrics or empty text', () => {
    expect(parseLrc('Lirik tanpa timestamp\nbaris kedua')).toEqual([]);
    expect(parseLrc('')).toEqual([]);
  });
});

describe('activeLyricsLineIndex', () => {
  const lines = [
    { timeMs: 1000, text: 'Satu' },
    { timeMs: 3000, text: 'Dua' },
    { timeMs: 5000, text: 'Tiga' },
  ];

  it.each([
    [0, -1],
    [1000, 0],
    [4999, 1],
    [5000, 2],
  ])('selects the active row at %i milliseconds', (positionMs, expectedIndex) => {
    expect(activeLyricsLineIndex(lines, positionMs)).toBe(expectedIndex);
  });
});
