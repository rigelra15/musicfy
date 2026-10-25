import { describe, expect, it } from 'vitest';
import type { Track } from '../model';
import { loadLyrics, LyricsLookupError } from './lrclib';

const track: Track = {
  id: 'video-1',
  title: 'Malam di Kota',
  artist: 'Senja',
  album: 'Ruang Sore',
  durationMs: 222_000,
};

function searchRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 123,
    trackName: 'Malam di Kota',
    artistName: 'Senja',
    albumName: 'Ruang Sore',
    duration: 222,
    instrumental: false,
    plainLyrics: 'Lirik biasa',
    syncedLyrics: '[00:01.00]Baris satu\n[00:03.50]Baris dua',
    ...overrides,
  };
}

describe('loadLyrics', () => {
  it('searches by title, artist, and optional album without credentials or forbidden headers', async () => {
    let requestedUrl = '';
    let requestedInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return new Response(JSON.stringify([searchRecord()]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    await loadLyrics(track, fetcher);

    const url = new URL(requestedUrl);
    expect(url.origin + url.pathname).toBe('https://lrclib.net/api/search');
    expect(url.searchParams.get('track_name')).toBe('Malam di Kota');
    expect(url.searchParams.get('artist_name')).toBe('Senja');
    expect(url.searchParams.get('album_name')).toBe('Ruang Sore');
    expect(url.searchParams.has('duration')).toBe(false);
    expect(requestedInit?.method).toBe('GET');
    expect(requestedInit?.credentials).toBe('omit');
    const headers = new Headers(requestedInit?.headers);
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('cookie')).toBe(false);
    expect(headers.has('user-agent')).toBe(false);
  });

  it('prefers synced lyrics whose duration matches the selected track', async () => {
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify([
        searchRecord({ duration: 185, syncedLyrics: '[00:01.00]Versi salah' }),
        searchRecord({ duration: 221, syncedLyrics: '[00:02.00]Versi cocok' }),
      ]), { status: 200 });

    await expect(loadLyrics(track, fetcher)).resolves.toEqual({
      type: 'synced',
      lines: [{ timeMs: 2000, text: 'Versi cocok' }],
    });
  });

  it('returns plain lyrics when no suitable timed result is available', async () => {
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify([searchRecord({ syncedLyrics: null })]), { status: 200 });

    await expect(loadLyrics(track, fetcher)).resolves.toEqual({
      type: 'plain',
      text: 'Lirik biasa',
    });
  });

  it('does not label timed lyrics synchronized when the recording duration differs too much', async () => {
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify([
        searchRecord({ duration: 620, plainLyrics: null }),
      ]), { status: 200 });

    await expect(loadLyrics(track, fetcher)).resolves.toEqual({ type: 'missing' });
  });

  it('keeps Unicode titles and artists distinct when matching lyrics', async () => {
    const nonLatinTrack = { ...track, title: '東京', artist: '歌手' };
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify([
        searchRecord({ trackName: '大阪', artistName: '別人' }),
      ]), { status: 200 });

    await expect(loadLyrics(nonLatinTrack, fetcher)).resolves.toEqual({ type: 'missing' });
  });

  it('accepts an exact non-Latin title and artist match', async () => {
    const nonLatinTrack = { ...track, title: '東京', artist: '歌手' };
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify([
        searchRecord({ trackName: '東京', artistName: '歌手' }),
      ]), { status: 200 });

    await expect(loadLyrics(nonLatinTrack, fetcher)).resolves.toMatchObject({
      type: 'synced',
      lines: [
        { timeMs: 1000, text: 'Baris satu' },
        { timeMs: 3500, text: 'Baris dua' },
      ],
    });
  });

  it('returns missing when the search has no exact track and artist match', async () => {
    const fetcher: typeof fetch = async () => new Response('[]', { status: 200 });

    await expect(loadLyrics(track, fetcher)).resolves.toEqual({ type: 'missing' });
  });

  it('returns missing for an instrumental record with no lyrics', async () => {
    const fetcher: typeof fetch = async () =>
      new Response(JSON.stringify([searchRecord({ instrumental: true, plainLyrics: null, syncedLyrics: null })]), {
        status: 200,
      });

    await expect(loadLyrics(track, fetcher)).resolves.toEqual({ type: 'missing' });
  });

  it('throws a typed error for rate limiting', async () => {
    const fetcher: typeof fetch = async () => new Response('limited', { status: 429 });

    await expect(loadLyrics(track, fetcher)).rejects.toMatchObject({
      name: 'LyricsLookupError',
      kind: 'http',
      status: 429,
    });
  });

  it('throws a typed error for malformed JSON', async () => {
    const fetcher: typeof fetch = async () => new Response('{bad', { status: 200 });

    await expect(loadLyrics(track, fetcher)).rejects.toBeInstanceOf(LyricsLookupError);
  });
});
