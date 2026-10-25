import type { LyricsLine } from '../model';

const TIMESTAMP_PATTERN = /\[(\d{1,2}):(\d{2})(?::(\d{2}))?(?:[.,](\d{1,3}))?\]/g;

function timestampMs(match: RegExpExecArray): number | undefined {
  const first = Number(match[1]);
  const second = Number(match[2]);
  const hasHours = match[3] !== undefined;
  const hours = hasHours ? first : 0;
  const minutes = hasHours ? second : first;
  const seconds = Number(hasHours ? match[3] : match[2]);
  const fraction = (match[4] ?? '').padEnd(3, '0').slice(0, 3);

  if (seconds > 59 || (hasHours && minutes > 59)) return undefined;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + Number(fraction || 0);
}

export function parseLrc(text: string): LyricsLine[] {
  if (!text.trim()) return [];

  const parsed: Array<LyricsLine & { order: number }> = [];
  let order = 0;

  for (const row of text.split(/\r?\n/)) {
    const timestamps: number[] = [];
    const matcher = new RegExp(TIMESTAMP_PATTERN.source, 'g');
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(row)) !== null) {
      const timeMs = timestampMs(match);
      if (timeMs !== undefined) timestamps.push(timeMs);
    }

    if (timestamps.length === 0) continue;
    const lyricText = row.replace(new RegExp(TIMESTAMP_PATTERN.source, 'g'), '').trim();
    if (!lyricText) continue;

    for (const timeMs of timestamps) {
      parsed.push({ timeMs, text: lyricText, order: order++ });
    }
  }

  return parsed
    .sort((left, right) => left.timeMs - right.timeMs || left.order - right.order)
    .map(({ timeMs, text: lyricText }) => ({ timeMs, text: lyricText }));
}

export function activeLyricsLineIndex(lines: LyricsLine[], positionMs: number): number {
  if (!Number.isFinite(positionMs) || positionMs < 0) return -1;

  let activeIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].timeMs > positionMs) break;
    activeIndex = index;
  }
  return activeIndex;
}
