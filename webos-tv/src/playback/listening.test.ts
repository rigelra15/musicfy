import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackStatus, Track } from '../model';
import { ListeningTracker, type HistorySink } from './listening';

const t = (id: string, durationMs = 200_000): Track => ({ id, title: id, artist: 'A', durationMs });

let clock: number;
let sink: { record: ReturnType<typeof vi.fn>; extend: ReturnType<typeof vi.fn> };
let left: Array<{ id: string; listenedMs: number }>;
let threshold: number;
let paused: boolean;
let tracker: ListeningTracker;

beforeEach(() => {
  clock = 1_000_000;
  threshold = 30_000;
  paused = false;
  left = [];
  sink = { record: vi.fn(async () => true), extend: vi.fn(async () => undefined) };
  tracker = new ListeningTracker({
    sink: sink as unknown as HistorySink,
    sessionId: 's1',
    now: () => clock,
    thresholdMs: () => threshold,
    historyPaused: () => paused,
    onLeft: (track, listenedMs) => left.push({ id: track.id, listenedMs }),
  });
});

/** Feeds the tracker a snapshot after `afterMs` of wall-clock time. */
const at = (afterMs: number, status: PlaybackStatus, token = 1, track: Track | null = t('a')) => {
  clock += afterMs;
  tracker.observe({ track, playToken: token, status });
};
const drain = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const playFor = (ms: number, token = 1, track: Track | null = t('a')) => {
  at(0, 'playing', token, track);
  for (let spent = 0; spent < ms; spent += 1000) at(Math.min(1000, ms - spent), 'playing', token, track);
};

describe('listening clock', () => {
  it('counts only the time spent playing, not loading, buffering or paused', () => {
    at(0, 'loading');
    at(4_000, 'playing');
    at(5_000, 'playing');
    at(5_000, 'playing');           // +10 s
    at(3_000, 'buffering');         // not counted
    at(2_000, 'buffering');
    at(1_000, 'playing');           // resumes: the gap since the last playing tick is not counted
    at(5_000, 'playing');           // +5 s
    at(20_000, 'paused');           // not counted
    at(1_000, 'paused', 2);         // leaving the song
    expect(left).toEqual([{ id: 'a', listenedMs: 15_000 }]);
  });

  it('does not count a stretch where the app was not running', () => {
    at(0, 'playing');
    at(2_000, 'playing');           // +2 s
    at(10 * 60_000, 'playing');     // suspended for ten minutes: capped, not added in full
    at(0, 'playing', 2);
    expect(left[0].listenedMs).toBeLessThanOrEqual(2_000 + 5_000);
  });

  it('records one history event when the threshold is crossed, then only extends it', async () => {
    playFor(29_000);
    expect(sink.record).not.toHaveBeenCalled();
    at(2_000, 'playing');
    expect(sink.record).toHaveBeenCalledTimes(1);
    await drain();
    expect(sink.record.mock.calls[0][0]).toMatchObject({ id: 's1:1', sessionId: 's1', track: { id: 'a' }, listenedMs: 31_000 });
    expect(sink.record.mock.calls[0][0].startedAt).toBeLessThanOrEqual(clock - 31_000 + 1000);
    for (let i = 0; i < 9; i += 1) at(1_000, 'playing');
    expect(sink.record).toHaveBeenCalledTimes(1);
    expect(sink.extend).not.toHaveBeenCalled();     // less than ten seconds more since the write
    at(2_000, 'playing');
    expect(sink.extend).toHaveBeenCalledWith('s1:1', 42_000);
  });

  it('writes the final total when the song is paused, ends or is left', async () => {
    playFor(35_000);
    await drain();
    at(1_000, 'paused');
    expect(sink.extend).toHaveBeenLastCalledWith('s1:1', 35_000);
    await drain();
    at(0, 'playing');
    at(3_000, 'playing');
    at(0, 'ended');
    expect(sink.extend).toHaveBeenLastCalledWith('s1:1', 38_000);
    expect(left).toEqual([{ id: 'a', listenedMs: 38_000 }]);
    at(1_000, 'ended');
    expect(left).toHaveLength(1);                   // an ended song is reported once
  });

  it('does not record songs below the threshold, but still reports them as left (skips)', () => {
    playFor(12_000);
    at(0, 'loading', 2, t('b'));
    expect(sink.record).not.toHaveBeenCalled();
    expect(left).toEqual([{ id: 'a', listenedMs: 12_000 }]);
  });

  it('seeking forward changes nothing: only elapsed playing time counts', () => {
    playFor(5_000);
    at(1_000, 'playing');            // a seek to the last second happens here; the clock sees 1 s
    at(0, 'ended');
    expect(left[0].listenedMs).toBe(6_000);
    expect(sink.record).not.toHaveBeenCalled();
  });

  it('records nothing while listening history is paused, and picks the setting up live', async () => {
    paused = true;
    playFor(40_000);
    expect(sink.record).not.toHaveBeenCalled();
    paused = false;
    at(1_000, 'playing');
    expect(sink.record).toHaveBeenCalledTimes(1);
  });

  it('uses the configured threshold', () => {
    threshold = 10_000;
    playFor(11_000);
    expect(sink.record).toHaveBeenCalledTimes(1);
  });

  it('gives every play of a song its own event, repeats included', async () => {
    playFor(31_000, 1);
    await drain();
    playFor(31_000, 2);               // same song again (repeat one): a new load
    await drain();
    playFor(31_000, 3, t('b'));
    expect(sink.record.mock.calls.map(([play]) => [play.id, play.track.id])).toEqual([['s1:1', 'a'], ['s1:2', 'a'], ['s1:3', 'b']]);
  });

  it('a restored song that was never played counts for nothing', () => {
    at(0, 'loading');
    at(5_000, 'paused');
    at(0, 'loading', 2, t('b'));
    expect(sink.record).not.toHaveBeenCalled();
    expect(left).toEqual([]);
  });

  it('stops counting on an error and retries a write the store rejected', async () => {
    sink.record.mockRejectedValueOnce(new Error('quota'));
    playFor(31_000);
    await drain();
    expect(tracker.lastError?.message).toBe('quota');
    at(5_000, 'error');              // resting: the rejected write is tried again
    expect(sink.record).toHaveBeenCalledTimes(2);
    expect(sink.record.mock.calls[1][0].listenedMs).toBe(31_000);
    await drain();
    expect(tracker.lastError).toBeUndefined();
    at(5_000, 'playing');            // the error stretch is not counted
    at(1_000, 'playing');
    tracker.flush();
    expect(sink.extend).toHaveBeenLastCalledWith('s1:1', 32_000);
  });

  it('flush writes the running total at once (page hidden)', async () => {
    playFor(33_000);
    await drain();
    at(1_000, 'playing');
    tracker.flush();
    expect(sink.extend).toHaveBeenLastCalledWith('s1:1', 34_000);
  });
});
