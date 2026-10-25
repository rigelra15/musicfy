import { describe, expect, it } from 'vitest';
import { documentFromLrc, editorLines, formatLrcTime, hasRichTiming, lrcFromLines } from './edit';
import type { SourceLyricsDocument } from './types';

const synced: SourceLyricsDocument = { type: 'synced', source: 'LrcLib', lines: [{ timeMs: 1500, text: 'satu' }, { timeMs: 65_230, text: 'dua', words: [{ text: 'dua', startMs: 65_230, endMs: 65_900 }] }] };

describe('lyrics editor model', () => {
  it('formats timestamps like LRC', () => {
    expect(formatLrcTime(0)).toBe('[00:00.00]');
    expect(formatLrcTime(65_230)).toBe('[01:05.23]');
    expect(formatLrcTime(600_000)).toBe('[10:00.00]');
  });
  it('turns the showing lyrics into rows with fixed times, and plain lyrics into rows without', () => {
    expect(editorLines(synced)).toEqual([{ timeMs: 1500, text: 'satu' }, { timeMs: 65_230, text: 'dua' }]);
    expect(editorLines({ type: 'plain', source: 'x', text: 'a\nb' })).toEqual([{ text: 'a' }, { text: 'b' }]);
    expect(editorLines(null)).toEqual([]);
    expect(editorLines({ type: 'missing', source: 'x' })).toEqual([]);
  });
  it('saves rows back as LRC, dropping blank rows and keeping each time', () => {
    const lrc = lrcFromLines([{ timeMs: 1500, text: ' Satu ' }, { timeMs: 3000, text: '   ' }, { timeMs: 65_230, text: 'dua\nbaru' }]);
    expect(lrc).toBe('[00:01.50]Satu\n[01:05.23]dua baru');
    expect(lrcFromLines([{ text: 'a' }, { text: '' }, { text: 'b' }])).toBe('a\nb');
  });
  it('round-trips through the document the player shows, losing only word timing', () => {
    const doc = documentFromLrc(lrcFromLines(editorLines(synced)))!;
    expect(doc).toEqual({ type: 'synced', source: 'UserEdited', lines: [{ timeMs: 1500, text: 'satu' }, { timeMs: 65_230, text: 'dua' }] });
    expect(hasRichTiming(synced)).toBe(true);
    expect(hasRichTiming(doc)).toBe(false);
    expect(documentFromLrc('baris satu\n\nbaris dua')).toEqual({ type: 'plain', source: 'UserEdited', text: 'baris satu\nbaris dua' });
    expect(documentFromLrc('  \n ')).toBeNull();
  });
});
