import { describe, expect, it } from 'vitest';
import type { Track } from '../model';
import { initialRootState, rootReducer, type RootAction, type RootState } from '../app/rootState';
import {
  currentIndex,
  currentTrack,
  emptyQueue,
  hasNext,
  hasPrevious,
  parseSession,
  queueReducer,
  serializeSession,
  type QueueAction,
  type QueueState,
} from './queueModel';

const t = (id: string, durationMs = 1000): Track => ({ id, title: id, artist: 'A', durationMs });
const ids = (q: QueueState) => q.entries.map((entry) => q.tracks[entry.trackKey].id);
const run = (state: QueueState, ...actions: QueueAction[]) => actions.reduce(queueReducer, state);
const seeded = (...list: string[]) => run(emptyQueue, { type: 'queue/replace', tracks: list.map((id) => t(id)), origin: 'manual' });

describe('queue model', () => {
  it('keeps duplicate tracks as separate slots', () => {
    const q = run(seeded('a', 'b'), { type: 'queue/enqueue', tracks: [t('a')], position: 'end' });
    expect(ids(q)).toEqual(['a', 'b', 'a']);
    expect(new Set(q.entries.map((e) => e.entryId)).size).toBe(3);
  });

  it('inserts play-next right after the current slot', () => {
    const q = run(seeded('a', 'b', 'c'), { type: 'queue/enqueue', tracks: [t('x'), t('y')], position: 'next' });
    expect(ids(q)).toEqual(['a', 'x', 'y', 'b', 'c']);
  });

  it('walks forward, stops at the end when repeat is off, wraps with repeat all', () => {
    let q = seeded('a', 'b');
    q = run(q, { type: 'queue/next', reason: 'user' });
    expect(currentTrack(q)?.id).toBe('b');
    expect(hasNext(q)).toBe(false);
    expect(run(q, { type: 'queue/next', reason: 'ended' })).toBe(q);
    q = run(q, { type: 'queue/setRepeat', mode: 'all' });
    expect(hasNext(q)).toBe(true);
    expect(currentTrack(run(q, { type: 'queue/next', reason: 'ended' }))?.id).toBe('a');
    expect(hasPrevious(run(q, { type: 'queue/previous' }))).toBe(true);
  });

  it('repeat one keeps the slot when a track ends but user next still advances', () => {
    let q = run(seeded('a', 'b'), { type: 'queue/setRepeat', mode: 'one' });
    expect(currentTrack(run(q, { type: 'queue/next', reason: 'ended' }))?.id).toBe('a');
    expect(currentTrack(run(q, { type: 'queue/next', reason: 'user' }))?.id).toBe('b');
  });

  it('cycles repeat off, all, one', () => {
    let q = emptyQueue;
    const seen = [];
    for (let i = 0; i < 4; i++) { q = run(q, { type: 'queue/cycleRepeat' }); seen.push(q.repeat); }
    expect(seen).toEqual(['all', 'one', 'off', 'all']);
  });

  it('reordering the current slot does not change what plays', () => {
    let q = seeded('a', 'b', 'c');
    q = run(q, { type: 'queue/next', reason: 'user' });
    const before = q.currentEntryId;
    q = run(q, { type: 'queue/move', entryId: before!, toIndex: 2 });
    expect(q.currentEntryId).toBe(before);
    expect(ids(q)).toEqual(['a', 'c', 'b']);
    expect(currentIndex(q)).toBe(2);
  });

  it('removing the current slot hands over to the next one, or the previous at the end', () => {
    let q = seeded('a', 'b', 'c');
    q = run(q, { type: 'queue/playEntry', entryId: q.entries[1].entryId }, { type: 'queue/remove', entryId: q.entries[1].entryId });
    expect(currentTrack(q)?.id).toBe('c');
    q = run(q, { type: 'queue/remove', entryId: q.currentEntryId! });
    expect(currentTrack(q)?.id).toBe('a');
    q = run(q, { type: 'queue/remove', entryId: q.currentEntryId! });
    expect(q.currentEntryId).toBeNull();
    expect(q.entries).toEqual([]);
  });

  it('clear keeps only the playing slot', () => {
    const q = run(seeded('a', 'b', 'c'), { type: 'queue/next', reason: 'user' }, { type: 'queue/clear' });
    expect(ids(q)).toEqual(['b']);
    expect(Object.keys(q.tracks)).toHaveLength(1);
  });

  it('shuffles only what is still to come and restores the original order', () => {
    let q = seeded('a', 'b', 'c', 'd', 'e', 'f');
    q = run(q, { type: 'queue/next', reason: 'user' }, { type: 'queue/setShuffle', on: true, seed: 7 });
    expect(ids(q).slice(0, 2)).toEqual(['a', 'b']);
    expect([...ids(q)].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(currentTrack(q)?.id).toBe('b');
    q = run(q, { type: 'queue/enqueue', tracks: [t('z')], position: 'end' }, { type: 'queue/setShuffle', on: false, seed: 0 });
    expect(ids(q)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'z']);
    expect(q.baseOrder).toBeNull();
  });

  it('autoplay adds only tracks that are not already queued', () => {
    const q = run(seeded('a', 'b'), { type: 'queue/autoplay', tracks: [t('b'), t('c'), t('c'), t('d')] });
    expect(ids(q)).toEqual(['a', 'b', 'c', 'd']);
    expect(q.entries.filter((e) => e.origin === 'autoplay')).toHaveLength(2);
  });

  it('serializes and validates sessions', () => {
    const q = run(seeded('a', 'b'), { type: 'queue/setRepeat', mode: 'all' });
    const restored = parseSession(JSON.parse(JSON.stringify(serializeSession(q, 12345.6, 99))));
    expect(restored?.queue).toEqual(q);
    expect(restored?.positionMs).toBe(12346);
    expect(parseSession({ version: 2 })).toBeNull();
    expect(parseSession(null)).toBeNull();
    const broken = JSON.parse(JSON.stringify(serializeSession(q, 0, 0)));
    broken.queue.entries[0].trackKey = 'missing';
    expect(parseSession(broken)?.queue.entries).toHaveLength(1);
  });
});

describe('root state', () => {
  const apply = (state: RootState, ...actions: RootAction[]) => actions.reduce(rootReducer, state);
  const started = () => apply(initialRootState, { type: 'queue/replace', tracks: [t('a', 100), t('b', 200)], origin: 'manual' });

  it('loads the chosen slot and bumps the token even when the same slot is chosen again', () => {
    let s = started();
    expect(s.playback).toMatchObject({ status: 'loading', durationMs: 100 });
    const token = s.playToken;
    s = apply(s, { type: 'queue/playEntry', entryId: s.queue.currentEntryId! });
    expect(s.playToken).toBe(token + 1);
    expect(s.playback.status).toBe('loading');
  });

  it('advances on ended only for the current load, once', () => {
    let s = started();
    s = apply(s, { type: 'playback/updated', snapshot: { status: 'playing', positionMs: 0, durationMs: 100, loadId: 5 } });
    const stale = apply(s, { type: 'playback/updated', snapshot: { status: 'ended', positionMs: 100, durationMs: 100, loadId: 4 } });
    expect(stale).toBe(s);
    const advanced = apply(s, { type: 'playback/updated', snapshot: { status: 'ended', positionMs: 100, durationMs: 100, loadId: 5 } });
    expect(currentTrack(advanced.queue)?.id).toBe('b');
    expect(advanced.playback.status).toBe('loading');
    expect(advanced.playToken).toBe(s.playToken + 1);
  });

  it('stops at the end of the queue with repeat off and reloads the same slot with repeat one', () => {
    let s = started();
    s = apply(s, { type: 'queue/next', reason: 'user' }, { type: 'playback/updated', snapshot: { status: 'playing', positionMs: 0, durationMs: 200, loadId: 1 } });
    const done = apply(s, { type: 'playback/updated', snapshot: { status: 'ended', positionMs: 200, durationMs: 200, loadId: 1 } });
    expect(done.playback.status).toBe('ended');
    expect(currentTrack(done.queue)?.id).toBe('b');
    const looped = apply(s, { type: 'queue/setRepeat', mode: 'one' }, { type: 'playback/updated', snapshot: { status: 'ended', positionMs: 200, durationMs: 200, loadId: 1 } });
    expect(looped.playback.status).toBe('loading');
    expect(looped.playToken).toBeGreaterThan(s.playToken);
  });

  it('ignores a second ended for the same load', () => {
    let s = apply(started(), { type: 'playback/updated', snapshot: { status: 'playing', positionMs: 0, durationMs: 100, loadId: 1 } });
    const ended = { type: 'playback/updated', snapshot: { status: 'ended', positionMs: 100, durationMs: 100, loadId: 1 } } as const;
    s = apply(s, ended);
    expect(apply(s, ended)).toBe(s);
    expect(currentTrack(s.queue)?.id).toBe('b');
  });

  it('drops snapshots that still belong to the previous track after a switch', () => {
    let s = apply(started(), { type: 'playback/updated', snapshot: { status: 'playing', positionMs: 5, durationMs: 100, loadId: 3 } });
    s = apply(s, { type: 'queue/next', reason: 'user' });
    const late = apply(s, { type: 'playback/updated', snapshot: { status: 'playing', positionMs: 90, durationMs: 100, loadId: 3 } });
    expect(late).toBe(s);
    const fresh = apply(s, { type: 'playback/updated', snapshot: { status: 'buffering', positionMs: 0, durationMs: 200, loadId: 4 } });
    expect(fresh.playback.status).toBe('buffering');
  });

  it('removing the current slot loads its replacement; removing the last stops', () => {
    let s = started();
    s = apply(s, { type: 'queue/remove', entryId: s.queue.currentEntryId! });
    expect(currentTrack(s.queue)?.id).toBe('b');
    expect(s.playback.status).toBe('loading');
    s = apply(s, { type: 'queue/remove', entryId: s.queue.currentEntryId! });
    expect(s.playback.status).toBe('idle');
  });

  it('reordering other slots does not reload', () => {
    let s = started();
    const token = s.playToken;
    s = apply(s, { type: 'queue/move', entryId: s.queue.entries[1].entryId, toIndex: 0 });
    expect(s.playToken).toBe(token);
  });

  it('a restored session is paused: no autoplay, resume position kept', () => {
    const q = run(seeded('a', 'b'), { type: 'queue/next', reason: 'user' });
    const s = apply(initialRootState, { type: 'session/restored', queue: q, positionMs: 42000 });
    expect(s.autoplay).toBe(false);
    expect(s.resumeAtMs).toBe(42000);
    expect(currentTrack(s.queue)?.id).toBe('b');
  });

  describe('stop after this song (sleep timer: end of song)', () => {
    const playingEnded = (s: RootState) => {
      s = apply(s, { type: 'playback/updated', snapshot: { status: 'playing', positionMs: 0, durationMs: 100, loadId: 5 } });
      return apply(s, { type: 'playback/updated', snapshot: { status: 'ended', positionMs: 100, durationMs: 100, loadId: 5 } });
    };

    it('moves to the next song but leaves it paused, and clears the flag', () => {
      let s = apply(started(), { type: 'sleep/songEnd', armed: true });
      expect(s.stopAfterTrack).toBe(true);
      s = playingEnded(s);
      expect(currentTrack(s.queue)?.id).toBe('b');
      expect(s.autoplay).toBe(false);
      expect(s.resumeAtMs).toBe(0);
      expect(s.stopAfterTrack).toBe(false);
      expect(s.playback.status).toBe('loading');
    });

    it('works with repeat one (the same song is ready again, paused) and at the end of the queue', () => {
      let s = apply(started(), { type: 'queue/setRepeat', mode: 'one' }, { type: 'sleep/songEnd', armed: true });
      s = playingEnded(s);
      expect(currentTrack(s.queue)?.id).toBe('a');
      expect(s.autoplay).toBe(false);
      const begin = started();
      let last = apply(begin, { type: 'queue/playEntry', entryId: begin.queue.entries[1].entryId }, { type: 'sleep/songEnd', armed: true });
      last = playingEnded(last);
      expect(currentTrack(last.queue)?.id).toBe('b');
      expect(last.stopAfterTrack).toBe(false);
      expect(last.playback.status).toBe('ended');
    });

    it('skipping with Next does not use it up, and disarming clears it', () => {
      let s = apply(started(), { type: 'sleep/songEnd', armed: true }, { type: 'queue/next', reason: 'user' });
      expect(s.stopAfterTrack).toBe(true);
      s = apply(s, { type: 'sleep/songEnd', armed: false });
      expect(s.stopAfterTrack).toBe(false);
    });

    it('the next song after the paused one plays normally again', () => {
      let s = apply(started(), { type: 'sleep/songEnd', armed: true });
      s = playingEnded(s);
      s = apply(s, { type: 'queue/playEntry', entryId: s.queue.currentEntryId! });
      expect(s.autoplay).toBe(true);
    });
  });
});
