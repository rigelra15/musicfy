import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SleepTimer, formatRemaining } from './sleepTimer';

let now: number;
let timers: Array<{ at: number; fn: () => void; cancelled: boolean }>;
let calls: string[];
let saved: Array<number | undefined>;
const fakeTimers = {
  set: (fn: () => void, ms: number) => { const timer = { at: now + ms, fn, cancelled: false }; timers.push(timer); return timer; },
  clear: (handle: unknown) => { (handle as { cancelled: boolean }).cancelled = true; },
};
const advance = (ms: number) => {
  now += ms;
  for (const timer of timers) if (!timer.cancelled && timer.at <= now) { timer.cancelled = true; timer.fn(); }
};
const make = () => new SleepTimer({ onElapsed: () => calls.push('pause'), onSongEndChanged: (on) => calls.push(`songEnd:${on}`), persist: (value) => saved.push(value), now: () => now, timers: fakeTimers });

beforeEach(() => { now = 1_000_000; timers = []; calls = []; saved = []; });

describe('sleep timer', () => {
  it('pauses once when the time is up and then is inactive', () => {
    const sleep = make();
    expect(sleep.start(30)).toBe(true);
    expect(sleep.getSnapshot().deadlineAt).toBe(now + 30 * 60_000);
    expect(sleep.remainingMs()).toBe(30 * 60_000);
    advance(29 * 60_000);
    expect(calls).toEqual([]);
    advance(60_000);
    expect(calls).toEqual(['pause']);
    expect(sleep.isActive).toBe(false);
    expect(saved).toEqual([1_000_000 + 30 * 60_000, undefined]);
  });

  it('rejects durations that make no sense', () => {
    const sleep = make();
    for (const minutes of [0, -5, NaN, 24 * 60 + 1]) expect(sleep.start(minutes)).toBe(false);
    expect(sleep.isActive).toBe(false);
  });

  it('starting again replaces the running timer: only the new one fires', () => {
    const sleep = make();
    sleep.start(10);
    advance(5 * 60_000);
    sleep.start(10);
    advance(6 * 60_000);
    expect(calls).toEqual([]);
    advance(4 * 60_000);
    expect(calls).toEqual(['pause']);
  });

  it('cancel stops it for good', () => {
    const sleep = make();
    sleep.start(1);
    sleep.clear();
    advance(10 * 60_000);
    expect(calls).toEqual([]);
    expect(sleep.isActive).toBe(false);
    expect(saved[saved.length - 1]).toBeUndefined();
  });

  it('"end of song" and a timed timer exclude each other', () => {
    const sleep = make();
    sleep.startAtSongEnd();
    expect(sleep.getSnapshot()).toEqual({ deadlineAt: undefined, atSongEnd: true });
    sleep.start(5);
    expect(sleep.getSnapshot().atSongEnd).toBe(false);
    expect(calls).toEqual(['songEnd:true', 'songEnd:false']);
    sleep.startAtSongEnd();
    expect(sleep.getSnapshot().deadlineAt).toBeUndefined();
    advance(60 * 60_000);
    expect(calls).toEqual(['songEnd:true', 'songEnd:false', 'songEnd:true']);
  });

  it('the engine reporting the song-end stop disarms it', () => {
    const sleep = make();
    sleep.startAtSongEnd();
    sleep.songEndHandled();
    expect(sleep.isActive).toBe(false);
  });

  it('a deadline from an earlier run is re-armed if still ahead, and a passed one is dropped without pausing or playing', () => {
    const early = make();
    early.restore(now + 90_000);
    expect(early.remainingMs()).toBe(90_000);
    advance(90_000);
    expect(calls).toEqual(['pause']);
    const late = make();
    saved = [];
    late.restore(now - 1);
    expect(late.isActive).toBe(false);
    expect(saved).toEqual([undefined]);
    advance(10_000);
    expect(calls).toEqual(['pause']);
    make().restore('garbage');
  });

  it('notifies subscribers and formats the countdown', () => {
    const sleep = make();
    const listener = vi.fn();
    sleep.subscribe(listener);
    sleep.start(2);
    sleep.clear();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(formatRemaining(61_000)).toBe('1:01');
    expect(formatRemaining(3_725_000)).toBe('1:02:05');
    expect(formatRemaining(0)).toBe('0:00');
  });
});
