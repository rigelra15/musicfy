import { parseLrc } from '../data/lrcParser';
import { USER_EDITED } from './selection';
import type { SourceLyricsDocument } from './types';

/** One row of the lyrics editor: the text can change, the time it is sung at cannot. */
export interface EditorLine { timeMs?: number; text: string }

export function formatLrcTime(timeMs: number): string {
  const total = Math.max(0, Math.round(timeMs / 10));
  const minutes = Math.floor(total / 6000);
  const seconds = Math.floor((total % 6000) / 100);
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(total % 100).padStart(2, '0')}]`;
}

/** The rows to edit for whatever lyrics are showing. Word and syllable timing is not part of a row. */
export function editorLines(document: SourceLyricsDocument | null): EditorLine[] {
  if (!document || document.type === 'missing') return [];
  if (document.type === 'plain') return document.text.split(/\r?\n/).map((text) => ({ text }));
  return document.lines.map((line) => ({ timeMs: line.timeMs, text: line.text }));
}

/** Rows that are blank are dropped; a row keeps its timestamp, a plain row is just its text. */
export function lrcFromLines(lines: readonly EditorLine[]): string {
  return lines
    .map((line) => ({ ...line, text: line.text.replace(/[\r\n]+/g, ' ').trim() }))
    .filter((line) => line.text)
    .map((line) => (line.timeMs === undefined ? line.text : `${formatLrcTime(line.timeMs)}${line.text}`))
    .join('\n');
}

/** What is stored back into lyrics: line-synced when there are timestamps, plain otherwise, nothing when empty. */
export function documentFromLrc(lrc: string): SourceLyricsDocument | null {
  const synced = parseLrc(lrc);
  if (synced.length > 0) return { type: 'synced', source: USER_EDITED, lines: synced.map(({ timeMs, text }) => ({ timeMs, text })) };
  const text = lrc.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join('\n');
  return text ? { type: 'plain', source: USER_EDITED, text } : null;
}

/** True when saving this document as lines would throw away word or syllable timing. */
export const hasRichTiming = (document: SourceLyricsDocument | null): boolean =>
  document?.type === 'synced' && document.lines.some((line) => line.words?.length || line.syllables?.length);

export const textLines = (document: SourceLyricsDocument | null): string[] =>
  !document || document.type === 'missing' ? [] : document.type === 'plain' ? document.text.split(/\r?\n/) : document.lines.map((line) => line.text);
