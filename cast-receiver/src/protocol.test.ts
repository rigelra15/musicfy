import { describe, expect, it } from 'vitest';
import { activeLineIndex, ChunkAssembler, MAX_CHUNK_BYTES, MAX_LYRICS_BYTES, PresentationGuard, splitUtf8, statusLabel, timedWordSegments } from './protocol';

describe('Cast receiver protocol helpers', () => {
  it('selects a line by the receiver playback position, including before the first line', () => {
    const lines = [{ timeMs: 0, text: 'one' }, { timeMs: 1200, text: 'two' }, { timeMs: 2400, text: 'three' }];
    expect(activeLineIndex(lines, -1)).toBe(-1);
    expect(activeLineIndex(lines, 1200)).toBe(1);
    expect(activeLineIndex(lines, 2399)).toBe(1);
  });

  it('splits UTF-8 without breaking multibyte characters or exceeding the cap', () => {
    const chunks = splitUtf8('🎵'.repeat(5000));
    expect(chunks.every((chunk) => new TextEncoder().encode(chunk).length <= MAX_CHUNK_BYTES)).toBe(true);
    expect(chunks.join('')).toBe('🎵'.repeat(5000));
    expect(() => splitUtf8('x'.repeat(MAX_LYRICS_BYTES + 1))).toThrow(/document limit/);
  });

  it('accepts a restarted sender epoch while rejecting stale tracks and revisions', () => {
    const guard = new PresentationGuard();
    guard.setSenderSession('sender-1');
    guard.setActiveIdentity('song-b', '2:song-b');
    expect(guard.acceptSnapshot('sender-1', 'song-b', '2:song-b', 8)).toBe(true);

    guard.setSenderSession('sender-2');
    expect(guard.acceptSnapshot('sender-2', 'song-b', '2:song-b', 1)).toBe(true);
    expect(guard.acceptSnapshot('sender-1', 'song-b', '2:song-b', 9)).toBe(false);

    guard.setActiveIdentity('song-c', '3:song-c');
    expect(guard.acceptSnapshot('sender-2', 'song-c', '3:song-c', 2)).toBe(true);
    expect(guard.acceptSnapshot('sender-2', 'song-b', '2:song-b', 10)).toBe(false);
    expect(guard.acceptSnapshot('sender-2', 'song-c', '3:song-c', 1)).toBe(false);
  });

  it('binds lyrics to the current snapshot revision and accepts them only once', () => {
    const guard = new PresentationGuard();
    guard.setSenderSession('sender');
    guard.setActiveIdentity('song', 'entry');
    expect(guard.acceptSnapshot('sender', 'song', 'entry', 2)).toBe(true);
    expect(guard.matchesSnapshot('sender', 'song', 'entry', 2)).toBe(true);
    expect(guard.acceptLyrics('sender', 'song', 'entry', 1)).toBe(false);
    expect(guard.acceptLyrics('sender', 'song', 'entry', 2)).toBe(true);
    expect(guard.acceptLyrics('sender', 'song', 'entry', 2)).toBe(false);
  });

  it('reassembles out-of-order lyric chunks and bounds incomplete transfers', () => {
    const assembler = new ChunkAssembler();
    expect(assembler.add('t1', 1, 2, '🎵')).toBeNull();
    expect(assembler.add('t1', 0, 2, 'hello')).toBe('hello🎵');
    expect(assembler.add('t2', 0, 129, 'bad')).toBeNull();
    expect(assembler.add('t3', 0, 1, 'x'.repeat(MAX_CHUNK_BYTES + 1))).toBeNull();
  });

  it('treats a duplicate chunk as an idempotent retry at the document-size limit', () => {
    const assembler = new ChunkAssembler();
    const fullChunk = 'x'.repeat(MAX_CHUNK_BYTES);
    for (let index = 0; index < 63; index++) {
      expect(assembler.add('large', index, 64, fullChunk)).toBeNull();
    }
    expect(assembler.add('large', 17, 64, fullChunk)).toBeNull();
    expect(assembler.add('large', 63, 64, fullChunk)).toBe(fullChunk.repeat(64));
  });

  it('preserves source spacing between timed words and maps visible player states', () => {
    const segments = timedWordSegments({
      timeMs: 0,
      text: 'I  love you!',
      words: [
        { text: 'I', startMs: 0, endMs: 100 },
        { text: 'love', startMs: 120, endMs: 220 },
        { text: 'you!', startMs: 240, endMs: 340 },
      ],
    });
    expect(segments.map((part) => part.text).join('')).toBe('I  love you!');
    expect(statusLabel('paused')).toBe('Paused');
    expect(statusLabel('buffering')).toBe('Loading on TV…');
    expect(statusLabel('idle')).toBe('Ready on TV');
  });
});
