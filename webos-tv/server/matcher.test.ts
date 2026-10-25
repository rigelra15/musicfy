import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { core, score, ranked } = require('../service/matcher.cjs');

const song = (id: string, title: string, artist: string, durationMs?: number, isrc?: string) => ({ id, title, artist, durationMs, isrc });
const q = { title: 'Espresso', artists: ['Sabrina Carpenter'], durationMs: 175_000 };

describe('track matcher', () => {
  it('strips what sources hang on a title', () => {
    expect(core('Espresso (feat. Someone) [Remastered 2024]')).toBe('espresso');
    expect(core('Espresso - Official Video')).toBe('espresso');
    expect(core('The Night and the Day')).toBe('night day');
  });
  it('accepts the same recording and puts the closest length first', () => {
    const list = ranked(q, [song('b', 'Espresso', 'Sabrina Carpenter', 190_000), song('a', 'Espresso', 'Sabrina Carpenter', 175_500), song('c', 'Other', 'Nobody', 175_000)]);
    expect(list.map((i: { song: { id: string } }) => i.song.id)).toEqual(['a', 'b']);
  });
  it('a remix, live version or sped up version is a different recording', () => {
    expect(score(q, song('x', 'Espresso (Remix)', 'Sabrina Carpenter', 175_000))).toBeLessThan(0.7);
    expect(score(q, song('x', 'Espresso (Live)', 'Sabrina Carpenter', 175_000))).toBeLessThan(0.7);
    expect(score({ ...q, title: 'Espresso (Live)' }, song('x', 'Espresso', 'Sabrina Carpenter', 175_000))).toBeLessThan(0.7);
    expect(score({ title: 'Alive', artists: ['A'] }, song('x', 'Alive', 'A'))).toBeGreaterThan(0.7);      // "Alive" is not "live"
  });
  it('needs the artist, and a title that is mostly the same', () => {
    expect(score(q, song('x', 'Espresso', 'Someone Else', 175_000))).toBe(0);
    expect(score(q, song('x', 'Totally different title', 'Sabrina Carpenter', 175_000))).toBe(0);
  });
  it('credits any of several artists, and matches by ISRC outright', () => {
    expect(score({ title: 'Eastside', artists: ['benny blanco'] }, song('x', 'Eastside', 'benny blanco, Halsey & Khalid'))).toBeGreaterThan(0.7);
    const list = ranked({ ...q, isrc: 'USUM72400001' }, [song('x', 'Something else entirely', 'Nobody', 1, 'usum72400001')]);
    expect(list[0].score).toBe(1);
  });
  it('a missing length is neutral, a far one counts against', () => {
    expect(score({ ...q, durationMs: undefined }, song('x', 'Espresso', 'Sabrina Carpenter'))).toBeGreaterThan(0.7);
    expect(score(q, song('x', 'Espresso', 'Sabrina Carpenter', 175_000))).toBeGreaterThan(score(q, song('x', 'Espresso', 'Sabrina Carpenter', 200_000)));
  });
});
