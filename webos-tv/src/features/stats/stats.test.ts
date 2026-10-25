import { describe, expect, it } from 'vitest';
import type { Track } from '../../model';
import { aggregate, groupHistory, monthOf, recapAvailability, shiftRange, yearOf, type PlayEvent } from './stats';

const T = (id: string, artist: string, extra: Partial<Track> = {}): Track => ({ id, title: `Song ${id}`, artist, durationMs: 200_000, artists: [{ name: artist }], ...extra });
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0).getTime();
const ev = (track: Track | undefined, when: number, listenedMs = 60_000, key = `youtube:track:${track?.id ?? 'x'}`): PlayEvent => ({ id: `${when}:${key}`, trackKey: key, startedAt: when, listenedMs, track });

describe('ranges', () => {
  it('steps months across a year boundary and years', () => {
    expect(shiftRange(monthOf(new Date(2026, 0, 15)), -1)).toEqual({ kind: 'month', year: 2025, month: 12 });
    expect(shiftRange(monthOf(new Date(2026, 11, 15)), 1)).toEqual({ kind: 'month', year: 2027, month: 1 });
    expect(shiftRange(yearOf(new Date(2026, 5, 1)), -1)).toEqual({ kind: 'year', year: 2025, month: 1 });
  });
});

describe('aggregate', () => {
  const a = T('a', 'Senja', { albumId: 'AL1' });
  const b = T('b', 'senja ', { albumId: 'AL1' });
  const c = T('c', 'Fajar', { albumId: 'AL2' });
  const events = [
    ev(a, at(2026, 10, 5, 9), 100_000), ev(a, at(2026, 10, 5, 21), 50_000), ev(b, at(2026, 10, 6, 21), 80_000), ev(c, at(2026, 10, 31, 23), 30_000),
    ev(c, at(2026, 9, 30, 23), 999_000),     // September: outside
    ev(c, at(2026, 11, 1, 0), 999_000),      // November: outside
  ];

  it('keeps only the range, sums real listening time and counts distinct songs, artists and albums', () => {
    const stats = aggregate(monthOf(new Date(2026, 9, 1)), events);
    expect(stats).toMatchObject({ totalMs: 260_000, plays: 4, songCount: 3, artistCount: 2, albumCount: 2 });
    expect(stats.isEmpty).toBe(false);
  });

  it('ranks songs by plays then time, artists by time (names merged ignoring case and spaces)', () => {
    const stats = aggregate(monthOf(new Date(2026, 9, 1)), events);
    expect(stats.topSongs.map((s) => [s.track.id, s.plays, s.playTimeMs])).toEqual([['a', 2, 150_000], ['b', 1, 80_000], ['c', 1, 30_000]]);
    expect(stats.topArtists.map((s) => [s.name, s.playTimeMs, s.topSong?.track.id])).toEqual([['Senja', 230_000, 'a'], ['Fajar', 30_000, 'c']]);
  });

  it('buckets by day of month, weekday (Monday first) and hour', () => {
    const stats = aggregate(monthOf(new Date(2026, 9, 1)), events);
    expect(stats.bucketMs).toHaveLength(31);
    expect(stats.bucketMs[4]).toBe(150_000);          // 5 Oct
    expect(stats.bucketMs[30]).toBe(30_000);          // 31 Oct
    expect(stats.weekdayMs).toHaveLength(7);
    expect(stats.weekdayMs[0] + stats.weekdayMs[1] + stats.weekdayMs[2] + stats.weekdayMs[3] + stats.weekdayMs[4] + stats.weekdayMs[5] + stats.weekdayMs[6]).toBe(260_000);
    expect(stats.weekdayMs[new Date(2026, 9, 5).getDay() === 0 ? 6 : new Date(2026, 9, 5).getDay() - 1]).toBeGreaterThanOrEqual(150_000);
    expect(stats.hourMs[21]).toBe(130_000);
    expect(stats.hourMs[9]).toBe(100_000);
    expect(stats.busiestHour).toBe(21);
  });

  it('a year has twelve buckets, one per month', () => {
    const stats = aggregate(yearOf(new Date(2026, 0, 1)), events);
    expect(stats.bucketMs).toHaveLength(12);
    expect(stats.bucketMs[9]).toBe(260_000);
    expect(stats.bucketMs[10]).toBe(999_000);
  });

  it('still counts the time of a play whose song data is gone, without listing it', () => {
    const stats = aggregate(monthOf(new Date(2026, 9, 1)), [ev(undefined, at(2026, 10, 2), 70_000)]);
    expect(stats.totalMs).toBe(70_000);
    expect(stats.topSongs).toEqual([]);
    expect(stats.songCount).toBe(1);
  });

  it('is empty when nothing was played', () => {
    expect(aggregate(monthOf(new Date(2026, 9, 1)), []).isEmpty).toBe(true);
  });
});

describe('history groups', () => {
  const now = at(2026, 10, 22);                       // Thursday
  const a = T('a', 'X'); const b = T('b', 'X'); const old = T('o', 'X');
  const events = [
    ev(a, at(2026, 10, 22, 10)), ev(b, at(2026, 10, 21, 10)), ev(a, at(2026, 10, 20, 10)),   // today, yesterday, this week (Mon)
    ev(b, at(2026, 10, 14, 10)),                                                              // last week
    ev(old, at(2026, 8, 3, 10)), ev(old, at(2026, 8, 20, 10)),                                // August, twice
  ];

  it('groups as Today, Yesterday, This week, Last week, then by month, newest first', () => {
    const groups = groupHistory(events, now);
    expect(groups.map((g) => g.key)).toEqual(['today', 'yesterday', 'thisWeek', 'lastWeek', '2026-08']);
  });

  it('lists a song once per group, with its latest play', () => {
    const august = groupHistory(events, now).find((g) => g.key === '2026-08')!;
    expect(august.events).toHaveLength(1);
    expect(august.events[0].startedAt).toBe(at(2026, 8, 20, 10));
  });

  it('can hide video uploads', () => {
    const video = T('v', 'X', { isVideo: true });
    expect(groupHistory([ev(video, at(2026, 10, 22, 8))], now, { hideVideos: true })).toEqual([]);
    expect(groupHistory([ev(video, at(2026, 10, 22, 8))], now)).toHaveLength(1);
  });
});

describe('recap availability', () => {
  const songs = Array.from({ length: 10 }, (_, i) => T(`s${i}`, `A${i}`));
  const inMonth = (m: number, count: number) => songs.slice(0, count).map((s, i) => ev(s, at(2026, m, 3 + i)));

  it('shows the running month once ten different songs were played in it', () => {
    const result = recapAvailability(inMonth(10, 10), new Date(2026, 9, 20));
    expect(result.status).toBe('ready');
    if (result.status === 'ready') { expect(result.range).toEqual({ kind: 'month', year: 2026, month: 10 }); expect(result.progressPercent).toBe(65); }
  });

  it('asks for the missing songs before that', () => {
    expect(recapAvailability(inMonth(10, 7), new Date(2026, 9, 20))).toEqual({ status: 'notYet', missingSongs: 3, unlockDay: undefined });
  });

  it('on the 1st and 2nd it shows last month (complete) or says when it unlocks', () => {
    const ready = recapAvailability(inMonth(9, 10), new Date(2026, 9, 2));
    expect(ready).toMatchObject({ status: 'ready', range: { kind: 'month', year: 2026, month: 9 }, progressPercent: 100 });
    expect(recapAvailability(inMonth(9, 4), new Date(2026, 9, 2))).toMatchObject({ status: 'notYet', unlockDay: 3, missingSongs: 6 });
  });
});
