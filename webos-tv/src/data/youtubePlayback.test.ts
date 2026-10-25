import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveAudioStream, YouTubePlaybackError } from './youtubePlayback';

type PlayerPayload = Record<string, any>;

const playerFixtureUrl = new URL('./fixtures/youtube-player.json', import.meta.url);
const visitorFixtureUrl = new URL('./fixtures/youtube-sw-js-data.txt', import.meta.url);
const playerFixture = JSON.parse(readFileSync(fileURLToPath(playerFixtureUrl), 'utf8')) as PlayerPayload;
const visitorFixture = readFileSync(fileURLToPath(visitorFixtureUrl), 'utf8');
const nowMs = 1_700_000_000_000;

function clonePlayerFixture(): PlayerPayload {
  return structuredClone(playerFixture);
}

function fetchFor(payload: PlayerPayload = playerFixture): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url === 'https://music.youtube.com/sw.js_data') {
      return new Response(visitorFixture, { status: 200 });
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

describe('resolveAudioStream', () => {
  it('passes on the description of the song when the player response has one', async () => {
    const payload = clonePlayerFixture();
    payload.videoDetails = { ...(payload.videoDetails ?? {}), shortDescription: '  Provided to YouTube by Senja Records  ' };
    expect((await resolveAudioStream('video-1', fetchFor(payload), nowMs)).description).toBe('Provided to YouTube by Senja Records');
    delete payload.videoDetails;
    expect('description' in (await resolveAudioStream('video-1', fetchFor(payload), nowMs))).toBe(false);
  });
  it('uses the relay media token while preserving upstream expiry validation', async () => {
    const payload = clonePlayerFixture();
    const token = '12345678-1234-1234-1234-123456789abc';
    for (const format of payload.streamingData.adaptiveFormats) format.relayToken = token;
    const stream = await resolveAudioStream('video-1', fetchFor(payload), nowMs);
    expect(stream.url).toBe(`https://music.youtube.com/media/${token}`);
    expect(stream.expiresAtMs).toBe(1_700_003_600_000);
  });
  it('requests a guest VISIONOS player response and selects a direct audio URL', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      return url.endsWith('/sw.js_data')
        ? new Response(visitorFixture, { status: 200 })
        : new Response(JSON.stringify(playerFixture), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
    };

    const resolved = await resolveAudioStream('video-1', fetcher, nowMs);
    expect(resolved).toMatchObject({
      url: 'https://rr1---sn.googlevideo.com/videoplayback?expire=1700003600&itag=140',
      mimeType: 'audio/mp4; codecs="mp4a.40.2"',
      expiresAtMs: 1_700_003_600_000,
      source: { provider: 'youtube', label: 'YouTube Music', codec: 'AAC' },
    });
    expect(resolved.source?.quality).toMatch(/^AAC/);                           // what the stream is, from its own format

    expect(requests.map(({ url }) => url)).toEqual([
      'https://music.youtube.com/sw.js_data',
      'https://music.youtube.com/youtubei/v1/player?prettyPrint=false',
    ]);
    expect(requests[0].init?.method ?? 'GET').toBe('GET');
    expect(requests.every(({ init }) => init?.credentials === 'omit')).toBe(true);
    const headers = new Headers(requests[1].init?.headers);
    expect(headers.get('X-Goog-Visitor-Id')).toBe('CgtGuestVisitorData');
    expect(headers.has('cookie')).toBe(false);

    const body = JSON.parse(String(requests[1].init?.body));
    expect(body).toMatchObject({
      context: {
        client: {
          clientName: 'VISIONOS',
          clientVersion: '0.1',
          visitorData: 'CgtGuestVisitorData',
        },
        user: { onBehalfOfUser: null },
      },
      videoId: 'video-1',
      playlistId: null,
      contentCheckOk: true,
      racyCheckOk: true,
    });
    expect(body.serviceIntegrityDimensions).toBeUndefined();
  });

  it('reports a ciphered format when it has no direct URL', async () => {
    const payload = clonePlayerFixture();
    payload.streamingData.adaptiveFormats = [
      {
        ...payload.streamingData.adaptiveFormats[0],
        url: null,
        signatureCipher: 's=obfuscated&url=https%3A%2F%2Fvideo.example%2Faudio',
      },
    ];

    await expect(resolveAudioStream('video-1', fetchFor(payload), nowMs)).rejects.toMatchObject({
      name: 'YouTubePlaybackError',
      kind: 'unsupported-format',
    });
  });

  it('rejects a stream URL whose expire parameter is already in the past', async () => {
    const payload = clonePlayerFixture();
    payload.streamingData.adaptiveFormats[0].url =
      'https://rr1---sn.googlevideo.com/videoplayback?expire=1699999999&itag=140';

    await expect(resolveAudioStream('video-1', fetchFor(payload), nowMs)).rejects.toMatchObject({
      name: 'YouTubePlaybackError',
      kind: 'expired',
    });
  });

  it('rejects an unexpected player response format', async () => {
    const fetcher: typeof fetch = async (input) =>
      String(input).endsWith('/sw.js_data')
        ? new Response(visitorFixture, { status: 200 })
        : new Response('{broken json', { status: 200 });

    await expect(resolveAudioStream('video-1', fetcher, nowMs)).rejects.toBeInstanceOf(
      YouTubePlaybackError,
    );
  });
});
