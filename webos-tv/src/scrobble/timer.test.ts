import { describe, expect, it } from 'vitest';
import type { Track } from '../model';
import { ScrobbleClient, scrobbleTrackOf } from './client';
import { ScrobbleTimer } from './timer';

const song = (seconds: number, extra: Partial<Track> = {}): Track => ({ id: 'a', title: 'Lagu', artist: 'Senja, Fajar', durationMs: seconds * 1000, artists: [{ name: 'Senja' }, { name: 'Fajar' }], ...extra });
function rig(wantsNowPlaying = true) {
  let clock = 1_700_000_000_000;
  const nowPlaying: string[] = []; const scrobbled: Array<[string, number]> = [];
  const timer = new ScrobbleTimer({ now: () => clock, wantsNowPlaying: () => wantsNowPlaying, sink: { nowPlaying: (t) => nowPlaying.push(t.title), scrobble: (t, at) => scrobbled.push([t.title, at]) } });
  const play = (track: Track | null, token: number, status: 'playing' | 'paused' | 'ended' | 'loading', advanceMs = 0) => { clock += advanceMs; timer.observe({ track, playToken: token, status }); };
  const run = (track: Track, token: number, seconds: number) => { for (let i = 0; i < seconds; i += 1) play(track, token, 'playing', 1000); };
  return { play, run, nowPlaying, scrobbled, tick: (ms: number) => { clock += ms; }, clock: () => clock };
}

describe('ScrobbleTimer (Last.fm rule)', () => {
  it('counts a song after half its length, with the time it started', () => {
    const r = rig();
    const track = song(200);
    r.play(track, 1, 'playing');
    const startedAt = Math.floor(r.clock() / 1000);
    expect(r.nowPlaying).toEqual(['Lagu']);
    r.run(track, 1, 99);
    expect(r.scrobbled).toEqual([]);
    r.run(track, 1, 2);
    expect(r.scrobbled).toEqual([['Lagu', startedAt]]);
    r.run(track, 1, 50);
    expect(r.scrobbled).toHaveLength(1);                         // once per play
  });
  it('waits at most four minutes, and never counts a song of 30 seconds or less', () => {
    const r = rig();
    const long = song(900);
    r.play(long, 1, 'playing'); r.run(long, 1, 239);
    expect(r.scrobbled).toHaveLength(0);
    r.run(long, 1, 2);
    expect(r.scrobbled).toHaveLength(1);
    const short = song(30);
    r.play(short, 2, 'playing'); r.run(short, 2, 60);
    expect(r.scrobbled).toHaveLength(1);
    expect(r.nowPlaying).toEqual(['Lagu', 'Lagu']);              // Now Playing still goes out
  });
  it('a pause, a long gap with the app suspended and a seek add nothing', () => {
    const r = rig();
    const track = song(100);
    r.play(track, 1, 'playing'); r.run(track, 1, 20);
    r.play(track, 1, 'paused', 1000);
    r.play(track, 1, 'paused', 600_000);                         // paused for ten minutes
    r.play(track, 1, 'playing', 1000);                           // resumes: the first tick adds no gap
    r.play(track, 1, 'playing', 3_600_000);                      // the app was not running for an hour
    expect(r.scrobbled).toHaveLength(0);
    r.run(track, 1, 24);
    expect(r.scrobbled).toHaveLength(0);                         // 20 + about 30 so far is still short of 50
    r.run(track, 1, 10);
    expect(r.scrobbled).toHaveLength(1);
  });
  it('repeating the same song is a new play; Now Playing can be turned off', () => {
    const r = rig(false);
    const track = song(40);
    r.play(track, 1, 'playing'); r.run(track, 1, 25);
    r.play(track, 2, 'playing'); r.run(track, 2, 25);
    expect(r.scrobbled).toHaveLength(2);
    expect(r.nowPlaying).toEqual([]);
  });
});

describe('scrobbleTrackOf / client', () => {
  it('sends the first artist only, and nothing for a song without title or artist', () => {
    expect(scrobbleTrackOf(song(200, { album: 'Album' }))).toEqual({ artist: 'Senja', track: 'Lagu', album: 'Album', durationSeconds: 200 });
    expect(scrobbleTrackOf(song(0, { artists: undefined, artist: 'A & B' }))).toEqual({ artist: 'A', track: 'Lagu' });
    expect(scrobbleTrackOf(song(10, { artist: '', artists: undefined }))).toBeUndefined();
  });
  it('turns service errors into readable ones', async () => {
    const client = new ScrobbleClient(async () => new Response(JSON.stringify({ error: 'Last.fm belum diatur', kind: 'notConfigured' }), { status: 503 }));
    await expect(client.begin('lastfm')).rejects.toMatchObject({ kind: 'notConfigured', message: expect.stringContaining('belum diatur') });
    const down = new ScrobbleClient(async () => { throw new Error('x'); });
    await expect(down.status()).rejects.toMatchObject({ kind: 'network' });
  });
});
