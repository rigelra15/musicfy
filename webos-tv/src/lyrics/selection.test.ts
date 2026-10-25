import { describe, expect, it } from 'vitest';
import { bestLyrics, LyricsController, timingDetail } from './selection';
import type { SourceLyricsDocument } from './types';
const track = { id: 'abcdefghijk', title: 'Fixture', artist: 'Artist', durationMs: 180000 };
const doc = (source: string, text: string, word = false): SourceLyricsDocument => ({ type: 'synced', source, lines: [{ timeMs: 1000, text, ...(word ? { words: [{ text, startMs: 1000, endMs: 2000 }] } : {}) }] });

describe('mobile lyrics source selection', () => {
  it('prefers the language most sources agree on before word timing', () => {
    const english = 'the you and i with my your what this be just all for we never know';
    const indonesian = 'aku dan kamu yang ini itu tak dengan untuk hati saja bisa jangan sudah lagi';
    expect(bestLyrics([doc('BetterLyrics', indonesian, true), doc('YouLyPlus', english), doc('LrcLib', english)], track)?.source).toBe('YouLyPlus');
  });
  it('does not auto-select a Chinese translation for a Latin song', () => {
    expect(bestLyrics([doc('NetEase', '测试歌词', true), doc('LrcLib', 'Fixture text')], track)?.source).toBe('LrcLib');
    expect(bestLyrics([doc('NetEase', '测试歌词', true)], track)).toBeNull();
  });
  it('uses word quality, then duet metadata, then the source order', () => {
    expect(bestLyrics([doc('BetterLyrics', 'Fixture'), doc('LrcLib', 'Fixture', true)], track)?.source).toBe('LrcLib');
    const duet = doc('Paxsenix', 'Fixture', true);
    if (duet.type === 'synced') duet.lines.push({ timeMs: 3000, text: 'Echo', agent: 'v2', words: [{ text: 'Echo', startMs: 3000, endMs: 4000 }] });
    expect(bestLyrics([doc('BetterLyrics', 'Fixture', true), duet], track)?.source).toBe('Paxsenix');
  });
  it('falls back to the closest real timing detail', () => {
    expect(timingDetail(doc('LrcLib', 'Fixture'), 'syllable')).toBe('line');
    expect(timingDetail(doc('LrcLib', 'Fixture', true), 'syllable')).toBe('word');
  });
  it('keeps manual selection when a better late result arrives and drops a previous song response', async () => {
    const pending: Array<{ id: string; trackId: string; resolve: (d: SourceLyricsDocument) => void }> = [];
    const controller = new LyricsController((id, t) => new Promise((resolve) => pending.push({ id, trackId: t.id, resolve })), () => {});
    controller.start(track);
    controller.select('YouLyPlus');
    pending.find((p) => p.id === 'YouLyPlus')!.resolve(doc('YouLyPlus', 'Manual'));
    await Promise.resolve();
    pending.find((p) => p.id === 'BetterLyrics')!.resolve(doc('BetterLyrics', 'Automatic', true));
    await Promise.resolve();
    expect(controller.snapshot().document?.source).toBe('YouLyPlus');
    controller.start({ ...track, id: 'lmnopqrstuv' });
    pending.find((p) => p.id === 'Paxsenix' && p.trackId === track.id)!.resolve(doc('Paxsenix', 'Stale', true));
    await Promise.resolve();
    expect(controller.snapshot().document).toBeNull();
    controller.cancel();
  });

  it('the user\'s own version beats every automatic pick, can be picked by name, and is dropped back to auto when removed', () => {
    const controller = new LyricsController(() => new Promise(() => {}), () => {});
    controller.start(track);
    expect(controller.snapshot().document).toBeNull();
    const mine: SourceLyricsDocument = { type: 'synced', source: 'UserEdited', lines: [{ timeMs: 0, text: 'milikku' }] };
    controller.setEdited(mine);
    expect(controller.snapshot().document).toBe(mine);
    controller.select('LrcLib');
    expect(controller.snapshot().document).toBeNull();      // a provider chosen by hand shows only that provider
    controller.select('UserEdited');
    expect(controller.snapshot().document).toBe(mine);
    controller.setEdited(null);
    expect(controller.snapshot().source).toBe('auto');
    expect(controller.snapshot().document).toBeNull();
    controller.cancel();
  });
  it('starts on the source given for the song, and ignores a source it does not know', () => {
    const controller = new LyricsController(() => new Promise(() => {}), () => {}, 'Kugou');
    controller.start(track, 'Deezer');
    expect(controller.snapshot().source).toBe('Deezer');
    controller.start(track, 'Nonsense');
    expect(controller.snapshot().source).toBe('Deezer');
    controller.cancel();
  });
});
