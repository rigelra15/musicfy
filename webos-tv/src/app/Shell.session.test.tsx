// @vitest-environment jsdom
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogGateway } from '../catalog/gateway';
import { fakeGateway, song as catalogSong } from '../features/home/testkit';
import { createMemoryDb } from '../library/db';
import type { PlaybackSnapshot, Track } from '../model';
import { PREF_AUTOPLAY } from '../playback/radio';
import { emptyQueue, queueReducer, serializeSession } from '../playback/queueModel';
import type { AppContextValue } from './AppContext';
import type { PlayerPort } from './engine';
import { openServices, type Services } from './services';
import App from './Shell';

class FakePlayer implements PlayerPort {
  loads: Array<{ track: Track; startAtMs?: number }> = [];
  plays = 0;
  listener: (snapshot: PlaybackSnapshot) => void = () => undefined;
  sequence = 0;
  subscribe(listener: (snapshot: PlaybackSnapshot) => void) { this.listener = listener; return () => undefined; }
  async load(track: Track, options?: { startAtMs?: number }) { this.loads.push({ track, startAtMs: options?.startAtMs }); this.sequence += 1; this.emit({ status: 'loading', positionMs: 0, durationMs: track.durationMs }); return this.sequence; }
  async play() { this.plays += 1; this.emit({ status: 'playing', positionMs: 0, durationMs: 180000 }); }
  pause() { this.emit({ status: 'paused', positionMs: 5000, durationMs: 180000 }); }
  seekTo() { /* not needed */ }
  dispose() { /* nothing */ }
  emit(snapshot: Omit<PlaybackSnapshot, 'loadId'>) { this.listener({ ...snapshot, loadId: this.sequence }); }
}

const song = (id: string): Track => ({ id, title: `Lagu ${id}`, artist: 'Senja', durationMs: 180000 });
let host: HTMLElement;
let player: FakePlayer;
let services: Services;
let api: () => AppContextValue;

let clock = 2_000_000_000_000;
async function mount(catalog: CatalogGateway = fakeGateway()) {
  player = new FakePlayer();
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(() => { render(h(App, { services, catalog, now: () => clock, playerFactory: () => player, onReady: (getter) => { api = getter; } }), host); });
  await flush();
}
const unmount = () => { render(null, host); host.remove(); };
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });

beforeEach(async () => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.closest('[hidden]') ? [] : [{}]) as unknown as DOMRectList;
  });
  const opened = await openServices({ db: createMemoryDb(), storage: { getItem: () => null } });
  if (!opened.ok) throw opened.error;
  services = opened.services;
  await services.prefs.set('ui.language', 'id');
  await services.prefs.set('onboarding.done', true);
});
afterEach(() => { unmount(); vi.restoreAllMocks(); });

describe('session restore and save', () => {
  it('restores the queue paused at the saved position, and never autoplays', async () => {
    let queue = queueReducer(emptyQueue, { type: 'queue/replace', tracks: [song('a'), song('b')], startIndex: 1, origin: 'manual' });
    queue = queueReducer(queue, { type: 'queue/setRepeat', mode: 'all' });
    await services.repo.saveSession(serializeSession(queue, 31_000, 1));
    await mount();
    expect(player.loads).toHaveLength(1);
    expect(player.loads[0].track.id).toBe('b');
    expect(player.loads[0].startAtMs).toBe(31_000);
    expect(player.plays).toBe(0);
    expect(document.querySelector('.mini-player')).toBeTruthy();
    expect(api().store.root.queue.repeat).toBe('all');
  });

  it('starts empty and does not wipe the stored session while it is still being read', async () => {
    const queue = queueReducer(emptyQueue, { type: 'queue/replace', tracks: [song('a')], origin: 'manual' });
    await services.repo.saveSession(serializeSession(queue, 1_000, 1));
    await mount();
    unmount();
    expect(await services.repo.loadSession()).toBeTruthy();
  });

  it('saves the queue and position when playback is paused', async () => {
    await mount();
    await act(() => { api().playTracks([song('a'), song('b')], 1, 'manual'); });
    await flush();
    await act(() => { api().controls.pause(); });
    await vi.waitFor(async () => {
      const saved = (await services.repo.loadSession())?.data as { queue: { currentEntryId: string; entries: unknown[] }; positionMs: number } | undefined;
      expect(saved?.queue.entries).toHaveLength(2);
      expect(saved?.positionMs).toBe(5_000);
    });
    unmount();
    await mount();
    expect(player.loads[0].track.id).toBe('b');
    expect(player.loads[0].startAtMs).toBe(5_000);
    expect(player.plays).toBe(0);
  });
});

describe('autoplay', () => {
  const radioGateway = (ids: string[]) => {
    const next = vi.fn(async () => ({ items: ids.map((id) => catalogSong(id)) }));
    return { gateway: fakeGateway({ next }), next };
  };

  it('refills the queue from the radio when the last song is playing, without repeating queued songs', async () => {
    const { gateway, next } = radioGateway(['a', 'b', 'c']);
    await mount(gateway);
    await act(() => { api().playTracks([song('x'), song('b')], 0, 'manual'); });
    await flush();
    expect(next).not.toHaveBeenCalled();
    await act(() => { api().dispatch({ type: 'queue/next', reason: 'user' }); });
    await flush();
    expect(next).toHaveBeenCalledTimes(1);
    const queue = api().store.root.queue;
    expect(queue.entries.map((entry) => queue.tracks[entry.trackKey].id)).toEqual(['x', 'b', 'a', 'c']);
    expect(queue.entries.slice(2).every((entry) => entry.origin === 'autoplay')).toBe(true);
  });

  it('does nothing when the user turned autoplay off, or repeat is on', async () => {
    const { gateway, next } = radioGateway(['c']);
    await services.prefs.set(PREF_AUTOPLAY, false);
    await mount(gateway);
    await act(() => { api().playTracks([song('a')], 0, 'manual'); });
    await flush();
    expect(next).not.toHaveBeenCalled();
    await act(() => { api().dispatch({ type: 'queue/setRepeat', mode: 'all' }); });
    await act(async () => { await services.prefs.set(PREF_AUTOPLAY, true); });
    await flush();
    expect(next).not.toHaveBeenCalled();
  });

  it('the queue panel toggle switches autoplay and remembers it', async () => {
    await mount();
    await act(() => { api().playTracks([song('a')], 0, 'manual'); });
    await act(() => { api().goTab('player'); });
    await act(() => { api().playerPanel.set('queue'); });
    const toggle = () => document.querySelector<HTMLElement>('[data-focus-id="queue-autoplay"]')!;
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    await act(() => { toggle().click(); });
    await flush();
    expect(services.prefs.get(PREF_AUTOPLAY, true)).toBe(false);
    expect(toggle().getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the song when the radio fails, and does not retry in a loop', async () => {
    await mount();
    await act(() => { api().playTracks([song('a')], 0, 'manual'); });
    await flush();
    await flush();
    expect(api().store.root.queue.entries).toHaveLength(1);
    expect(player.loads).toHaveLength(1);
  });

  it('continues with the first fetched song when the last one ended before the radio arrived', async () => {
    let release: (value: { items: ReturnType<typeof catalogSong>[] }) => void = () => undefined;
    const next = vi.fn(() => new Promise<{ items: ReturnType<typeof catalogSong>[] }>((resolve) => { release = resolve; }));
    await mount(fakeGateway({ next }));
    await act(() => { api().playTracks([song('a')], 0, 'manual'); });
    await flush();
    await act(() => { player.emit({ status: 'ended', positionMs: 180000, durationMs: 180000 }); });
    expect(player.loads).toHaveLength(1);
    await act(() => { release({ items: [catalogSong('n1'), catalogSong('n2')] }); });
    await flush();
    expect(player.loads.map((entry) => entry.track.id)).toEqual(['a', 'n1']);
    expect(player.plays).toBe(2);
  });

  it('drops a radio that arrives after the user moved to another song', async () => {
    const releases: Array<(value: { items: ReturnType<typeof catalogSong>[] }) => void> = [];
    const next = vi.fn(() => new Promise<{ items: ReturnType<typeof catalogSong>[] }>((resolve) => { releases.push(resolve); }));
    await mount(fakeGateway({ next }));
    await act(() => { api().playTracks([song('a')], 0, 'manual'); });
    await flush();
    await act(() => { api().playTracks([song('z')], 0, 'manual'); });
    await flush();
    expect(releases).toHaveLength(2);
    await act(() => { releases[0]({ items: [catalogSong('late')] }); });
    await flush();
    const queue = api().store.root.queue;
    expect(queue.entries.map((entry) => queue.tracks[entry.trackKey].id)).toEqual(['z']);
    await act(() => { releases[1]({ items: [catalogSong('fresh')] }); });
    await flush();
    expect(api().store.root.queue.entries).toHaveLength(2);
  });
});

describe('recovering from a dead stream', () => {
  it('reloads once at the same position when a playing song fails mid-way (expired address)', async () => {
    await mount();
    await act(() => { api().playTracks([song('a')], 0, 'manual'); });
    await flush();
    await act(() => { player.emit({ status: 'playing', positionMs: 42_000, durationMs: 180000 }); });
    await act(() => { player.emit({ status: 'error', positionMs: 42_000, durationMs: 180000, error: 'x' }); });
    await flush();
    expect(player.loads).toHaveLength(2);
    expect(player.loads[1].startAtMs).toBe(42_000);
    expect(player.plays).toBe(2);
    await act(() => { player.emit({ status: 'error', positionMs: 42_000, durationMs: 180000, error: 'x' }); });
    await flush();
    expect(player.loads).toHaveLength(2);
  });

  it('does not retry a song that never started', async () => {
    await mount();
    await act(() => { api().playTracks([song('a')], 0, 'manual'); });
    await flush();
    await act(() => { player.emit({ status: 'error', positionMs: 0, durationMs: 180000, error: 'x' }); });
    await flush();
    expect(player.loads).toHaveLength(1);
  });

  it('pressing play after an error retries from where it stopped', async () => {
    await mount();
    await act(() => { api().playTracks([song('a')], 0, 'manual'); });
    await flush();
    await act(() => { player.emit({ status: 'error', positionMs: 12_000, durationMs: 180000, error: 'x' }); });
    await act(() => { api().controls.toggle(); });
    await flush();
    expect(player.loads).toHaveLength(2);
    expect(player.loads[1].startAtMs).toBe(12_000);
  });
});

describe('a stream that gave up', () => {
  const startAndFail = async () => {
    await mount();
    await act(() => { api().playTracks([song('a'), song('b')], 0, 'manual'); });
    await flush();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(() => { player.emit({ status: 'error', positionMs: 0, durationMs: 180000, error: 'x' }); });
  };
  afterEach(() => { vi.useRealTimers(); });
  it('moves on to the next song after the timeout (phone default: 6 s)', async () => {
    await startAndFail();
    await act(async () => { await vi.advanceTimersByTimeAsync(5900); });
    expect(player.loads).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(player.loads[player.loads.length - 1].track.id).toBe('b');
  });
  it('stays and tries the same song again when "don\'t skip" is on', async () => {
    await services.prefs.set('playback.dontSkipOnFailure', true);
    await startAndFail();
    await act(async () => { await vi.advanceTimersByTimeAsync(5100); });
    expect(player.loads).toHaveLength(2);
    expect(player.loads.every((load) => load.track.id === 'a')).toBe(true);
  });
});

describe('listening history', () => {
  const tick = async (ms: number, status: 'playing' | 'paused' | 'ended' | 'buffering' = 'playing', positionMs = 0) => {
    clock += ms;
    await act(() => { player.emit({ status, positionMs, durationMs: 180000 }); });
  };
  const start = async (...ids: string[]) => {
    await act(() => { api().playTracks(ids.map(song), 0, 'manual'); });
    await flush();
  };
  const plays = async () => services.repo.listHistory();

  it('records a song once it has played for 30 seconds, and keeps extending the same event', async () => {
    await mount();
    await start('a');
    for (let i = 0; i < 40; i += 1) await tick(1000);
    await flush();
    const history = await plays();
    expect(history).toHaveLength(1);
    expect(history[0].track?.id).toBe('a');
    expect(history[0].listenedMs).toBeGreaterThanOrEqual(30_000);
    await act(() => { api().controls.pause(); });
    await tick(1000, 'paused', 40_000);
    await flush();
    expect((await plays())).toHaveLength(1);
    expect((await plays())[0].listenedMs).toBe(40_000);
  });

  it('does not count a jump to the end of the song', async () => {
    await mount();
    await start('a');
    await tick(1000);
    await tick(1000, 'playing', 178_000);      // seek bar dragged to the end
    await tick(1000, 'ended', 180_000);
    await flush();
    expect(await plays()).toHaveLength(0);
    expect(await services.repo.totalListenedMs()).toBe(0);
  });

  it('records nothing while listening history is paused', async () => {
    await services.prefs.set('history.paused', true);
    await mount();
    await start('a');
    for (let i = 0; i < 40; i += 1) await tick(1000);
    await flush();
    expect(await plays()).toHaveLength(0);
  });

  it('tells Home about a skipped song and a song played through', async () => {
    await mount();
    await start('a', 'b');
    for (let i = 0; i < 5; i += 1) await tick(1000);
    await act(() => { api().dispatch({ type: 'queue/next', reason: 'user' }); });
    await flush();
    expect(api().signals.skipsSinceRefresh).toBe(1);
    for (let i = 0; i < 100; i += 1) await tick(1000);
    await tick(0, 'ended', 180_000);
    await flush();
    expect(api().signals.playsSinceRefresh).toBe(1);
  });

  it('a restored session adds no history until the user plays it', async () => {
    const queue = queueReducer(emptyQueue, { type: 'queue/replace', tracks: [song('a')], origin: 'manual' });
    await services.repo.saveSession(serializeSession(queue, 90_000, 1));
    await mount();
    await tick(40_000, 'paused', 90_000);
    await flush();
    expect(await plays()).toHaveLength(0);
  });
});

describe('suspend and relaunch', () => {
  const hide = async (state: 'hidden' | 'visible') => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    await act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await flush();
  };
  afterEach(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); });

  it('pauses when the app is hidden, saves where it was, and does not resume by itself when shown again', async () => {
    await mount();
    await act(() => { api().playTracks([song('a'), song('b')], 1, 'manual'); });
    await flush();
    expect(api().store.root.playback.status).toBe('playing');
    await hide('hidden');
    expect(api().store.root.playback.status).toBe('paused');
    await vi.waitFor(async () => {
      const saved = (await services.repo.loadSession())?.data as { positionMs: number } | undefined;
      expect(saved?.positionMs).toBe(5_000);
    });
    const playsBefore = player.plays;
    await hide('visible');
    expect(api().store.root.playback.status).toBe('paused');
    expect(player.plays).toBe(playsBefore);
  });

  it('leaves an already paused or idle app alone', async () => {
    await mount();
    await hide('hidden');
    expect(player.plays).toBe(0);
    expect(api().store.root.playback.status).toBe('idle');
  });

  it('a stopped import run keeps what it found and is not continued while hidden', async () => {
    await mount();
    const runner = api().importRunner;
    const spy = vi.spyOn(runner, 'cancel');
    await hide('hidden');
    expect(spy).toHaveBeenCalled();
  });
});
