// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb } from '../library/db';
import { LibraryRepository } from '../library/repository';
import type { Track } from '../model';
import { emptyQueue, queueReducer, type QueueState } from './queueModel';
import { SessionPersister } from './session';

const t = (id: string): Track => ({ id, title: id, artist: 'A', durationMs: 200_000 });
const queueOf = (...ids: string[]): QueueState => queueReducer(emptyQueue, { type: 'queue/replace', tracks: ids.map(t), origin: 'manual' });

let repo: LibraryRepository;
let live: { queue: QueueState; positionMs: number; playing: boolean };
let persister: SessionPersister;

beforeEach(() => {
  vi.useFakeTimers();
  repo = new LibraryRepository(createMemoryDb());
  live = { queue: emptyQueue, positionMs: 0, playing: false };
  persister = new SessionPersister(repo, () => live, () => 1_000);
});
afterEach(() => { persister.dispose(); vi.useRealTimers(); });

describe('session persistence', () => {
  it('restores nothing when no session was saved, and nothing malformed', async () => {
    expect(await persister.restore()).toBeNull();
    await repo.saveSession({ version: 9, queue: 'nope' });
    expect(await persister.restore()).toBeNull();
  });

  it('round-trips the queue (duplicates included), repeat/shuffle and the position', async () => {
    live.queue = queueReducer(queueOf('a', 'b', 'a'), { type: 'queue/setRepeat', mode: 'all' });
    live.queue = queueReducer(live.queue, { type: 'queue/next', reason: 'user' });
    live.positionMs = 42_400;
    await persister.restore();
    await persister.flush();
    const restored = await new SessionPersister(repo, () => live).restore();
    expect(restored?.positionMs).toBe(42_400);
    expect(restored?.queue.entries.map((e) => e.trackKey)).toEqual(live.queue.entries.map((e) => e.trackKey));
    expect(restored?.queue.currentEntryId).toBe(live.queue.currentEntryId);
    expect(restored?.queue.repeat).toBe('all');
  });

  it('never overwrites the saved session before the restore attempt has finished', async () => {
    live.queue = queueOf('a');
    await persister.restore();
    await persister.flush();
    const fresh = new SessionPersister(repo, () => ({ queue: emptyQueue, positionMs: 0, playing: false }));
    await fresh.flush(); // app just started, nothing restored yet: must not wipe the session
    expect((await repo.loadSession())?.data).toBeTruthy();
    fresh.dispose();
  });

  it('clears the saved session once the queue is emptied after restore', async () => {
    live.queue = queueOf('a');
    await persister.restore();
    await persister.flush();
    live.queue = emptyQueue;
    await persister.flush();
    expect(await repo.loadSession()).toBeUndefined();
  });

  it('saves on a timer while playing, and not while paused', async () => {
    await persister.restore();
    persister.start();
    live.queue = queueOf('a');
    live.playing = false;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await repo.loadSession()).toBeUndefined();
    live.playing = true;
    live.positionMs = 15_000;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(((await repo.loadSession())?.data as { positionMs: number }).positionMs).toBe(15_000);
  });

  it('saves when the page is hidden', async () => {
    await persister.restore();
    persister.start();
    live.queue = queueOf('a', 'b');
    live.positionMs = 7_000;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(((await repo.loadSession())?.data as { positionMs: number }).positionMs).toBe(7_000);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  });

  it('keeps going when the store rejects a write', async () => {
    await persister.restore();
    live.queue = queueOf('a');
    vi.spyOn(repo, 'saveSession').mockRejectedValueOnce(new Error('quota'));
    await expect(persister.flush()).resolves.toBeUndefined();
    await expect(persister.flush()).resolves.toBeUndefined();
    expect(await repo.loadSession()).toBeTruthy();
  });
});
