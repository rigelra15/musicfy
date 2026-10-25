import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSearchResponse, searchSongs, YouTubeSearchError } from './youtubeMusic';

type SearchPayload = Record<string, any>;

const fixtureUrl = new URL('./fixtures/youtube-search.json', import.meta.url);
const fixture = JSON.parse(readFileSync(fileURLToPath(fixtureUrl), 'utf8')) as SearchPayload;

function cloneFixture(): SearchPayload {
  return structuredClone(fixture);
}

function songsShelf(payload: SearchPayload): any[] {
  return payload.contents.tabbedSearchResultsRenderer.tabs[0].tabRenderer.content
    .sectionListRenderer.contents[0].musicShelfRenderer.contents;
}

describe('YouTube Music search response parser', () => {
  it('maps a WEB_REMIX song row to the TV track model', () => {
    expect(parseSearchResponse(fixture)[0]).toEqual({
      id: 'song-1',
      title: 'Malam di Kota',
      artist: 'Senja',
      album: 'Ruang Sore',
      artworkUrl: 'https://img.youtube.com/large.jpg',
      durationMs: 222_000,
    });
  });

  it('keeps a valid song when album and artwork are absent', () => {
    const payload = cloneFixture();
    const song = songsShelf(payload)[1].musicResponsiveListItemRenderer;

    expect(parseSearchResponse(payload)).toContainEqual({
      id: 'song-2',
      title: 'Lagu Tanpa Album',
      artist: 'Rani',
      durationMs: 130_000,
    });
    expect(song).not.toHaveProperty('thumbnail');
  });

  it('ignores non-song rows in a mixed result shelf', () => {
    expect(parseSearchResponse(fixture).map(({ id }) => id)).toEqual(['song-1', 'song-2']);
  });

  it('returns an empty result for an empty music shelf', () => {
    const payload = cloneFixture();
    songsShelf(payload).splice(0);

    expect(parseSearchResponse(payload)).toEqual([]);
  });

  it('rejects a response with no music search structure', () => {
    expect(() => parseSearchResponse({ contents: [] })).toThrow(YouTubeSearchError);
    expect(() => parseSearchResponse({ contents: [] })).toThrow('format hasil pencarian tidak dikenali');
  });
});

describe('searchSongs', () => {
  it('sends the guest WEB_REMIX song search request without account or cookie data', async () => {
    let requestedUrl = '';
    let requestedInit: RequestInit | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    await expect(searchSongs(' Malam di Kota ', fetcher)).resolves.toHaveLength(2);

    expect(requestedUrl).toBe('https://music.youtube.com/youtubei/v1/search?prettyPrint=false');
    expect(requestedInit?.method).toBe('POST');
    expect(requestedInit?.credentials).toBe('omit');
    const headers = new Headers(requestedInit?.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.has('cookie')).toBe(false);

    const body = JSON.parse(String(requestedInit?.body));
    expect(body).toMatchObject({
      context: {
        client: {
          clientName: 'WEB_REMIX',
          clientVersion: expect.any(String),
          gl: 'ID',
          hl: 'id',
          visitorData: null,
        },
        user: { onBehalfOfUser: null },
      },
      query: 'Malam di Kota',
      params: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D',
    });
  });

  it('throws a typed error for an HTTP failure', async () => {
    const fetcher: typeof fetch = async () => new Response('rate limited', { status: 429 });

    await expect(searchSongs('artist', fetcher)).rejects.toMatchObject({
      name: 'YouTubeSearchError',
      kind: 'http',
      status: 429,
    });
  });

  it('throws a typed error for malformed JSON', async () => {
    const fetcher: typeof fetch = async () => new Response('{not json', { status: 200 });

    await expect(searchSongs('artist', fetcher)).rejects.toMatchObject({
      name: 'YouTubeSearchError',
      kind: 'invalid-response',
    });
  });
});
