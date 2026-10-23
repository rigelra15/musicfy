export const NAMESPACE = 'urn:x-cast:com.musicfy.tv.v1';
export const MAX_CHUNK_BYTES = 16 * 1024;
export const MAX_LYRICS_BYTES = 1024 * 1024;

export type LyricLine = { timeMs: number; text: string; words?: { text: string; startMs: number; endMs: number }[] };
export type LyricsPayload = { lines: LyricLine[] };
export type ViewMode = 'player' | 'lyrics' | 'artwork';
export type TrackSnapshot = { title: string; artist: string; album?: string | null; artwork?: string | null };

export type CastEnvelope<T = unknown> = {
  version: 1;
  type: string;
  requestId: string;
  senderSessionId: string;
  mediaId: string;
  queueEntryId: string;
  revision: number;
  data: T;
};

export type CastMessage =
  | (CastEnvelope<{ capabilities: string[] }> & { type: 'READY' })
  | (CastEnvelope<Record<string, never>> & { type: 'HELLO' })
  | (CastEnvelope<{ track: TrackSnapshot; lines: LyricLine[]; mode: ViewMode }> & { type: 'SNAPSHOT' })
  | (CastEnvelope<{ transferId: string; index: number; count: number; chunk: string }> & { type: 'LYRICS_CHUNK' })
  | (CastEnvelope<{ transferId: string; index: number }> & { type: 'ACK' })
  | (CastEnvelope<{ mode: ViewMode }> & { type: 'SET_VIEW_MODE' });

export class PresentationGuard {
  private senderSessionId = '';
  private activeIdentity = '';
  private snapshotRevision = -1;
  private lyricsAccepted = false;

  setSenderSession(senderSessionId: string): boolean {
    if (!senderSessionId || senderSessionId === this.senderSessionId) return false;
    this.senderSessionId = senderSessionId;
    this.snapshotRevision = -1;
    this.lyricsAccepted = false;
    return true;
  }

  setActiveIdentity(mediaId: string, queueEntryId: string): boolean {
    const identity = mediaId && queueEntryId ? `${mediaId}\u0000${queueEntryId}` : '';
    if (identity === this.activeIdentity) return false;
    this.activeIdentity = identity;
    this.snapshotRevision = -1;
    this.lyricsAccepted = false;
    return true;
  }

  matchesSnapshot(senderSessionId: string, mediaId: string, queueEntryId: string, revision: number): boolean {
    return this.isValidEnvelope(senderSessionId, mediaId, queueEntryId, revision) &&
      this.snapshotRevision === revision;
  }

  acceptSnapshot(senderSessionId: string, mediaId: string, queueEntryId: string, revision: number): boolean {
    if (!this.isValidEnvelope(senderSessionId, mediaId, queueEntryId, revision) || revision <= this.snapshotRevision) return false;
    this.snapshotRevision = revision;
    this.lyricsAccepted = false;
    return true;
  }

  acceptLyrics(senderSessionId: string, mediaId: string, queueEntryId: string, revision: number): boolean {
    if (!this.matchesSnapshot(senderSessionId, mediaId, queueEntryId, revision) || this.lyricsAccepted) return false;
    this.lyricsAccepted = true;
    return true;
  }

  private isValidEnvelope(senderSessionId: string, mediaId: string, queueEntryId: string, revision: number): boolean {
    return senderSessionId === this.senderSessionId &&
      `${mediaId}\u0000${queueEntryId}` === this.activeIdentity &&
      Number.isSafeInteger(revision) && revision >= 0;
  }
}

export function activeLineIndex(lines: LyricLine[], positionMs: number): number {
  let low = 0;
  let high = lines.length - 1;
  let result = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (lines[mid].timeMs <= positionMs) {
      result = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return result;
}

export function timedWordSegments(line: LyricLine): { text: string; wordIndex?: number }[] {
  if (!line.words?.length) return [{ text: line.text }];
  const segments: { text: string; wordIndex?: number }[] = [];
  let cursor = 0;
  for (let wordIndex = 0; wordIndex < line.words.length; wordIndex++) {
    const word = line.words[wordIndex];
    if (!word.text) return [{ text: line.text }];
    const start = line.text.indexOf(word.text, cursor);
    if (start < 0) return [{ text: line.text }];
    if (start > cursor) segments.push({ text: line.text.slice(cursor, start) });
    segments.push({ text: word.text, wordIndex });
    cursor = start + word.text.length;
  }
  if (cursor < line.text.length) segments.push({ text: line.text.slice(cursor) });
  return segments;
}

export function statusLabel(state: string): string {
  switch (state) {
    case 'connecting': return 'Connecting to TV…';
    case 'playing': return 'Now playing on TV';
    case 'paused': return 'Paused';
    case 'loading':
    case 'buffering': return 'Loading on TV…';
    case 'idle':
    case 'ready': return 'Ready on TV';
    case 'ended': return 'Playback ended';
    case 'error': return 'Playback error';
    default: return 'Waiting for playback';
  }
}

export function splitUtf8(text: string, maxBytes = MAX_CHUNK_BYTES): string[] {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let current = '';
  let bytes = 0;
  for (const point of text) {
    const size = encoder.encode(point).length;
    if (size > maxBytes) throw new Error('A character exceeds the Cast chunk limit');
    if (bytes + size > maxBytes && current) {
      chunks.push(current);
      current = '';
      bytes = 0;
    }
    current += point;
    bytes += size;
  }
  if (current || chunks.length === 0) chunks.push(current);
  if (encoder.encode(text).length > MAX_LYRICS_BYTES) throw new Error('Lyrics exceed the Cast document limit');
  return chunks;
}

export class ChunkAssembler {
  private transfers = new Map<string, { count: number; chunks: Map<number, string>; bytes: number }>();

  add(transferId: string, index: number, count: number, chunk: string): string | null {
    if (!transferId || !Number.isInteger(index) || !Number.isInteger(count) || count < 1 || count > 128 || index < 0 || index >= count) return null;
    let transfer = this.transfers.get(transferId);
    if (!transfer) {
      if (this.transfers.size >= 4) this.transfers.delete(this.transfers.keys().next().value!);
      transfer = { count, chunks: new Map(), bytes: 0 };
      this.transfers.set(transferId, transfer);
    }
    if (transfer.count !== count) { this.transfers.delete(transferId); return null; }
    const previousChunk = transfer.chunks.get(index);
    if (previousChunk !== undefined) {
      if (previousChunk !== chunk) { this.transfers.delete(transferId); return null; }
    } else {
      const size = new TextEncoder().encode(chunk).length;
      if (size > MAX_CHUNK_BYTES || transfer.bytes + size > MAX_LYRICS_BYTES) { this.transfers.delete(transferId); return null; }
      transfer.chunks.set(index, chunk);
      transfer.bytes += size;
    }
    if (transfer.chunks.size !== count) return null;
    this.transfers.delete(transferId);
    return Array.from({ length: count }, (_, part) => transfer!.chunks.get(part)!).join('');
  }
}
