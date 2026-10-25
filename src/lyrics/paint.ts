import type { TimedLyricsLine } from './types';

/**
 * Which lines' word pieces need repainting on this animation frame. Normally only the line being
 * sung (and, as the song moves on, the one it just left); a seek repaints every line it crossed,
 * so the sung/unsung state of the rest of the song is never touched on a frame.
 */
export function linesToPaint(previous: number | undefined, next: number, count: number): number[] {
  if (count <= 0) return [];
  const clamp = (value: number) => Math.min(count - 1, Math.max(0, value));
  if (previous === undefined) return Array.from({ length: count }, (_, i) => i);
  const from = clamp(Math.min(previous, next));
  const to = clamp(Math.max(previous, next));
  if (from === to) return [from];
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** The index of the line being sung at `timeMs`: the last line that has started, or -1 before the first. */
export function activeIndex(times: readonly number[], timeMs: number, hint = 0): number {
  if (times.length === 0 || timeMs < times[0]) return -1;
  // Playback mostly moves forward one line at a time, so look near the last answer first.
  let i = Math.min(Math.max(hint, 0), times.length - 1);
  if (times[i] > timeMs) i = 0;
  while (i + 1 < times.length && times[i + 1] <= timeMs) i += 1;
  return i;
}

/** When a line stops being sung: its last word or syllable ends, or the next line begins. */
export function lineEndMs(lines: readonly TimedLyricsLine[], index: number): number {
  const line = lines[index];
  const pieces = line.syllables?.length ? line.syllables : line.words;
  if (pieces?.length) return Math.max(...pieces.map((piece) => piece.endMs));
  return lines[index + 1]?.timeMs ?? line.timeMs + 4000;
}

/**
 * The line to show as "the current one" where only one fits. Sources add a backing or echo line ("(They'll see in time)")
 * that starts while the main line is still being sung; the main line stays the current one until it ends, then the echo.
 */
export function currentLineIndex(lines: readonly TimedLyricsLine[], timeMs: number, hint = 0): number {
  const index = activeIndex(lines.map((line) => line.timeMs), timeMs, hint);
  if (index < 0 || !lines[index].isBackground) return index;
  for (let before = index - 1; before >= 0; before -= 1) {
    if (lines[before].isBackground) continue;
    return lineEndMs(lines, before) > timeMs ? before : index;
  }
  return index;
}

/**
 * Which lines belong together, from the source's own timing: a backing or echo line (isBackground) that starts while the
 * line before it is still being sung is sung at the same time, so it joins that line's group. Everything else stands alone.
 * Each group lists its line indices in the source's order; the first is the main line.
 */
export function lineGroups(lines: readonly TimedLyricsLine[]): number[][] {
  const groups: number[][] = [];
  lines.forEach((line, index) => {
    const group = groups[groups.length - 1];
    const main = group ? group[0] : -1;
    if (line.isBackground && group && !lines[main].isBackground && line.timeMs < lineEndMs(lines, main)) group.push(index);
    else groups.push([index]);
  });
  return groups;
}

/** A line is still shown as sung this long after its last word, so a short gap between two lines never makes the highlight blink off and on. */
export const SUNG_TAIL_MS = 250;

/**
 * Whether the group at `groupIndex` has finished at `timeMs`: playback is past its last word (the latest end among its lines, from the
 * source's own timing) plus a short tail, or past the start of the next group, whichever comes first. A group that has finished is no
 * longer the sung one, even though it is still the last line that began; the next one takes over when it starts.
 */
export function groupFinished(lines: readonly TimedLyricsLine[], groups: readonly number[][], groupIndex: number, timeMs: number): boolean {
  const members = groups[groupIndex];
  if (!members) return false;
  const end = Math.max(...members.map((index) => lineEndMs(lines, index)));
  const nextStart = groups[groupIndex + 1] ? lines[groups[groupIndex + 1][0]].timeMs : Infinity;
  return timeMs >= Math.min(end + SUNG_TAIL_MS, nextStart);
}

/** How far through a piece the song is, in tenths of a percent (so repaints skip identical values). */
export function pieceProgress(timeMs: number, startMs: number, endMs: number): number {
  const value = endMs > startMs ? Math.max(0, Math.min(1, (timeMs - startMs) / (endMs - startMs))) : timeMs >= startMs ? 1 : 0;
  return Math.round(value * 1000) / 10;
}
