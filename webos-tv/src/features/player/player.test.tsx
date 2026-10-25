// @vitest-environment jsdom
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyQueue, queueReducer } from '../../playback/queueModel';
import { trackKeyOf } from '../../domain/entity';
import { flyFrom, rememberCover, takeCover } from './sharedCover';
import { PlayerBackdrop } from './PlayerBackdrop';

const song = { id: 'a', title: 'Lagu', artist: 'X', durationMs: 0 };

describe('a song learns its length once the player knows it', () => {
  it('fills in an unknown length, and never replaces a known one', () => {
    const queue = queueReducer(emptyQueue, { type: 'queue/replace', tracks: [song, { ...song, id: 'b', durationMs: 180_000 }], origin: 'manual' });
    const a = trackKeyOf(song); const b = trackKeyOf({ ...song, id: 'b' });
    const learned = queueReducer(queue, { type: 'queue/learnDuration', trackKey: a, durationMs: 242_000 });
    expect(learned.tracks[a].durationMs).toBe(242_000);
    expect(queueReducer(learned, { type: 'queue/learnDuration', trackKey: a, durationMs: 1000 })).toBe(learned);
    expect(queueReducer(queue, { type: 'queue/learnDuration', trackKey: b, durationMs: 1000 })).toBe(queue);
    expect(queueReducer(queue, { type: 'queue/learnDuration', trackKey: a, durationMs: 0 })).toBe(queue);
  });
});

describe('the cover that flies between the mini player and the player', () => {
  const box = (left: number, top: number, width: number, height = width) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() { return {}; } }) as DOMRect;
  const stubMotion = (reduced: boolean) => { window.matchMedia = ((query: string) => ({ matches: reduced && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia; };
  afterEach(() => { delete (window as { matchMedia?: unknown }).matchMedia; vi.useRealTimers(); });

  it('remembers where a cover was for one direction, once, and not for long', () => {
    vi.useFakeTimers();
    const mini = document.createElement('div');
    mini.getBoundingClientRect = () => box(40, 900, 64);
    rememberCover(mini, 'toPlayer');
    expect(takeCover('toMini')).toBeUndefined();
    expect(takeCover('toPlayer')).toMatchObject({ left: 40, top: 900, width: 64 });
    expect(takeCover('toPlayer')).toBeUndefined();
    rememberCover(mini, 'toPlayer');
    vi.advanceTimersByTime(1500);
    expect(takeCover('toPlayer')).toBeUndefined();
  });

  it('starts the cover over the old one (same centre, same width) and lets it glide into place', () => {
    stubMotion(false);
    const cover = document.createElement('div');
    document.body.appendChild(cover);
    cover.getBoundingClientRect = () => box(100, 100, 400);
    const animate = vi.fn(() => ({}) as Animation);
    (cover as unknown as { animate: unknown }).animate = animate;
    flyFrom(cover, { left: 20, top: 700, width: 80, height: 80 });
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames, options] = animate.mock.calls[0] as unknown as [Array<{ transform: string }>, { duration: number }];
    // old centre (60, 740) vs new centre (300, 300): move by (-240, 440), shrunk to a fifth of the width
    expect(frames[0].transform).toBe('translate(-240px, 440px) scale(0.2)');
    expect(frames[1].transform).toBe('none');
    expect(options.duration).toBeGreaterThan(300);
    cover.remove();
  });

  it('does not move anything with reduced motion', () => {
    stubMotion(true);
    const cover = document.createElement('div');
    cover.getBoundingClientRect = () => box(100, 100, 400);
    const animate = vi.fn();
    (cover as unknown as { animate: unknown }).animate = animate;
    flyFrom(cover, { left: 20, top: 700, width: 80, height: 80 });
    expect(animate).not.toHaveBeenCalled();
  });
});

describe('PlayerBackdrop', () => {
  let host: HTMLElement;
  beforeEach(() => { vi.useFakeTimers(); host = document.createElement('div'); document.body.appendChild(host); });
  afterEach(() => { render(null, host); host.remove(); vi.useRealTimers(); });
  const layers = () => [...host.querySelectorAll<HTMLElement>('.player-backdrop-image')].map((el) => /url\("(.+)"\)/.exec(el.getAttribute('style') ?? '')?.[1]);

  it('shows the cover, fades the next one in over it, then drops the old layer', () => {
    act(() => { render(h(PlayerBackdrop, { url: 'https://img/1.jpg' }), host); });
    expect(layers()).toEqual(['https://img/1.jpg']);
    act(() => { render(h(PlayerBackdrop, { url: 'https://img/2.jpg' }), host); });
    expect(layers()).toEqual(['https://img/1.jpg', 'https://img/2.jpg']);           // the old one stays underneath during the fade
    act(() => { vi.advanceTimersByTime(1000); });
    expect(layers()).toEqual(['https://img/2.jpg']);
    act(() => { render(h(PlayerBackdrop, { url: undefined }), host); });
    expect(layers()).toEqual([]);
  });
});
