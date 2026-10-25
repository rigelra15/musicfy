import { describe, expect, it } from 'vitest';
import { PREF_SKIPS, ListeningSignals } from './signals';
import { memoryServices, NOW, track } from './testkit';

describe('ListeningSignals', () => {
  it('ignores blips and very short tracks, counts early drops as skips and the rest as plays', async () => {
    const { prefs } = await memoryServices();
    const signals = new ListeningSignals(prefs, () => NOW);
    expect(signals.onTrackLeft(track('a'), 200)).toBe('ignored');
    expect(signals.onTrackLeft(track('s', { durationMs: 30_000 }), 20_000)).toBe('ignored');
    expect(signals.onTrackLeft(track('a'), 10_000)).toBe('skip');
    expect(signals.onTrackLeft(track('b', { durationMs: 40_000 }), 25_000)).toBe('play');
    expect(signals.onTrackLeft(track('c'), 31_000)).toBe('play');
    expect(signals.skipsSinceRefresh).toBe(1);
    expect(signals.playsSinceRefresh).toBe(2);
    expect(signals.recentSkips().map((s) => s.songId)).toEqual(['a']);
  });
  it('forgets skips after two weeks and keeps at most 200', async () => {
    const { prefs } = await memoryServices();
    await prefs.set(PREF_SKIPS, [{ songId: 'old', artists: [], at: NOW - 20 * 86_400_000 }, { songId: 'new', artists: [], at: NOW - 1000 }]);
    const signals = new ListeningSignals(prefs, () => NOW);
    expect(signals.recentSkips().map((s) => s.songId)).toEqual(['new']);
    const fresh = new ListeningSignals(prefs, () => NOW);
    await prefs.set(PREF_SKIPS, Array.from({ length: 250 }, (_, i) => ({ songId: String(i), artists: [], at: NOW })));
    fresh.onTrackLeft(track('z'), 5_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fresh.all().length).toBe(200);
  });
});
