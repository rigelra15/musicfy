import { createServer, request as httpRequest, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { fetchLink, detect, extractUrl, allowedLinkUrl, allowedShortHop, LinkError } = require('../service/links.cjs');

const SPOTIFY_ID = '37i9dQZF1DXcBWIGoYBM5M';
const spotifyPage = (tracks: unknown[], extra: Record<string, unknown> = {}) =>
  `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity: { name: 'Mix Harian', trackList: tracks, ...extra } } } } } })}</script></html>`;
const applePage = (header: Record<string, unknown>, tracks: unknown[]) =>
  `<script type="application/json" id="serialized-server-data">${JSON.stringify({ data: [{ data: { sections: [{ itemKind: 'containerDetailHeaderLockup', items: [header] }, { itemKind: 'trackLockup', items: tracks }] } }] })}</script>`;

const serve = (routes: Record<string, { status?: number; body: string; location?: string }>, seen: string[] = []) =>
  async (url: string, opts?: { manual?: boolean }) => {
    seen.push(url);
    const hit = routes[url];
    if (!hit) return { status: 404, body: '' };
    return { status: hit.status ?? 200, body: hit.body, location: hit.location };
  };

describe('detect / extractUrl', () => {
  it('knows the four sources and ignores share-sheet text around the address', () => {
    expect(detect('https://open.spotify.com/playlist/x')).toBe('spotify');
    expect(detect('https://music.apple.com/us/playlist/x/pl.abc')).toBe('applemusic');
    expect(detect('https://www.deezer.com/en/playlist/1')).toBe('deezer');
    expect(detect('https://music.youtube.com/playlist?list=PLx')).toBe('youtube');
    expect(detect('https://example.com')).toBeUndefined();
    expect(extractUrl('Lihat playlist ini! https://open.spotify.com/playlist/abc?si=1.')).toBe('https://open.spotify.com/playlist/abc?si=1');
    expect(extractUrl('tidak ada tautan')).toBeUndefined();
  });
  it('only lets the fixed pages be read', () => {
    expect(allowedLinkUrl(`https://open.spotify.com/embed/playlist/${SPOTIFY_ID}`)).toBe(true);
    expect(allowedLinkUrl('https://open.spotify.com/embed/playlist/short')).toBe(false);
    expect(allowedLinkUrl('http://api.deezer.com/playlist/1')).toBe(false);
    expect(allowedLinkUrl('https://api.deezer.com.evil.test/playlist/1')).toBe(false);
    expect(allowedLinkUrl('https://user:pw@api.deezer.com/playlist/1')).toBe(false);
    expect(allowedLinkUrl('https://music.apple.com/us/playlist/x/pl.u-abc')).toBe(true);
    expect(allowedShortHop('https://spotify.link/abc')).toBe(true);
    expect(allowedShortHop('https://evil.test/abc')).toBe(false);
  });
});

describe('Spotify', () => {
  const embed = `https://open.spotify.com/embed/playlist/${SPOTIFY_ID}`;
  it('reads titles, artists and durations from the embed page', async () => {
    const http = serve({ [embed]: { body: spotifyPage([{ title: 'Lagu A', subtitle: 'Penyanyi A, Penyanyi B', duration: 201000 }, { title: 'Lagu B', subtitle: 'C' }, { subtitle: 'tanpa judul' }]) } });
    const result = await fetchLink(`Dengar ini https://open.spotify.com/intl-id/playlist/${SPOTIFY_ID}?si=zzz`, http);
    expect(result).toMatchObject({ source: 'spotify', kind: 'playlist', remoteId: SPOTIFY_ID, name: 'Mix Harian', warnings: [] });
    expect(result.tracks).toEqual([{ title: 'Lagu A', artist: 'Penyanyi A, Penyanyi B', durationMs: 201000 }, { title: 'Lagu B', artist: 'C' }]);
  });
  it('warns when a playlist hits the 100-song limit of the embed', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ title: `L${i}`, subtitle: 'A', duration: 1000 }));
    const result = await fetchLink(`https://open.spotify.com/playlist/${SPOTIFY_ID}`, serve({ [embed]: { body: spotifyPage(many) } }));
    expect(result.tracks).toHaveLength(100);
    expect(result.warnings[0]).toMatch(/100 lagu pertama/);
  });
  it('says private, changed and rate-limited plainly', async () => {
    const link = `https://open.spotify.com/playlist/${SPOTIFY_ID}`;
    await expect(fetchLink(link, serve({ [embed]: { status: 404, body: '' } }))).rejects.toMatchObject({ kind: 'private', status: 404 });
    await expect(fetchLink(link, serve({ [embed]: { status: 429, body: '' } }))).rejects.toMatchObject({ kind: 'rateLimited', status: 429 });
    await expect(fetchLink(link, serve({ [embed]: { body: '<html>baru</html>' } }))).rejects.toMatchObject({ kind: 'changed', status: 502 });
    await expect(fetchLink(link, serve({ [embed]: { body: spotifyPage([]) } }))).rejects.toMatchObject({ kind: 'empty' });
  });
  it('follows a short link to the playlist, but not elsewhere', async () => {
    const seen: string[] = [];
    const http = serve({
      'https://spotify.link/abc': { status: 302, body: '', location: `https://open.spotify.com/playlist/${SPOTIFY_ID}?si=1` },
      [embed]: { body: spotifyPage([{ title: 'X', subtitle: 'Y' }]) },
    }, seen);
    expect((await fetchLink('https://spotify.link/abc', http)).remoteId).toBe(SPOTIFY_ID);
    const evil = serve({ 'https://spotify.link/bad': { status: 302, body: '', location: 'https://evil.test/x' } });
    await expect(fetchLink('https://spotify.link/bad', evil)).rejects.toBeInstanceOf(LinkError);
  });
});

describe('Apple Music', () => {
  const page = 'https://music.apple.com/us/playlist/favorit/pl.u-abc123';
  it('reads the list and warns when the page shows fewer songs than declared', async () => {
    const html = applePage({ title: 'Favorit', trackCount: 80, artwork: { dictionary: { url: 'https://is1.mzstatic.com/{w}x{h}{c}.{f}' } } }, [
      { title: 'Satu', artistName: 'Penyanyi', duration: 180000, tertiaryLinks: [{ title: 'Album Satu' }] },
      { title: 'Dua', subtitleLinks: [{ title: 'P1' }, { title: 'P2' }] },
    ]);
    const result = await fetchLink(`${page}?l=id`, serve({ [page]: { body: html } }));
    expect(result).toMatchObject({ source: 'applemusic', kind: 'playlist', remoteId: 'pl.u-abc123', name: 'Favorit' });
    expect(result.tracks).toEqual([{ title: 'Satu', artist: 'Penyanyi', album: 'Album Satu', durationMs: 180000 }, { title: 'Dua', artist: 'P1, P2' }]);
    expect(result.warnings[0]).toMatch(/2 dari 80/);
    expect(result.cover).toBe('https://is1.mzstatic.com/600x600bb.jpg');
  });
  it('reports a changed page', async () => {
    await expect(fetchLink(page, serve({ [page]: { body: '<html></html>' } }))).rejects.toMatchObject({ kind: 'changed' });
  });
});

describe('Deezer', () => {
  it('pages through the tracks and converts seconds to milliseconds', async () => {
    const http = serve({
      'https://api.deezer.com/playlist/123': { body: JSON.stringify({ title: 'Deezer Mix', nb_tracks: 3, picture_xl: 'https://cdn.example/p.jpg' }) },
      'https://api.deezer.com/playlist/123/tracks?limit=100': { body: JSON.stringify({ data: [{ title: 'A', duration: 200, artist: { name: 'P' }, album: { title: 'Al' } }], next: 'https://api.deezer.com/playlist/123/tracks?index=100' }) },
      'https://api.deezer.com/playlist/123/tracks?index=100': { body: JSON.stringify({ data: [{ title: 'B', duration: 100, artist: { name: 'Q' } }], next: 'https://evil.test/next' }) },
    });
    const result = await fetchLink('https://www.deezer.com/en/playlist/123', http);
    expect(result.tracks).toEqual([{ title: 'A', artist: 'P', album: 'Al', durationMs: 200000 }, { title: 'B', artist: 'Q', durationMs: 100000 }]);
    expect(result.warnings[0]).toMatch(/2 dari 3/);
  });
  it('reports a private playlist', async () => {
    const http = serve({ 'https://api.deezer.com/playlist/9': { body: JSON.stringify({ error: { message: 'no data' } }) } });
    await expect(fetchLink('https://deezer.com/playlist/9', http)).rejects.toMatchObject({ kind: 'private' });
  });
});

describe('bad input', () => {
  it('rejects things that are not links or belong elsewhere', async () => {
    const http = serve({});
    await expect(fetchLink('halo', http)).rejects.toMatchObject({ kind: 'badLink', status: 400 });
    await expect(fetchLink('https://example.com/x', http)).rejects.toMatchObject({ kind: 'badLink' });
    await expect(fetchLink('https://open.spotify.com/track/' + SPOTIFY_ID, http)).rejects.toMatchObject({ kind: 'badLink' });
    await expect(fetchLink('https://music.youtube.com/playlist?list=PLx', http)).rejects.toMatchObject({ kind: 'badLink' });
  });
});

describe('POST /api/import/link', () => {
  let servers: Server[] = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => { s.closeAllConnections(); s.close(() => resolve()); }))); });
  it('answers through the service, with plain errors', async () => {
    const { startRuntime } = require('../service/runtime.cjs');
    const upstream = createServer((req, res) => {
      if (req.url!.startsWith('/embed/')) { res.setHeader('Content-Type', 'text/html'); res.end(spotifyPage([{ title: 'Lagu', subtitle: 'Artis', duration: 1000 }])); } else { res.statusCode = 404; res.end(); }
    });
    servers.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const seen: string[] = [];
    const requester = (url: string) => new Promise((resolve, reject) => {
      const target = new URL(url);
      seen.push(`${target.hostname}${target.pathname}`);
      httpRequest({ hostname: '127.0.0.1', port: (upstream.address() as { port: number }).port, path: target.pathname + target.search }, resolve).on('error', reject).end();
    });
    const runtime = await startRuntime({ request: requester });
    servers.push(runtime.server);
    const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${runtime.baseUrl}/api/import/link`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
    const ok = await post({ link: `https://open.spotify.com/playlist/${SPOTIFY_ID}` });
    expect(ok.status).toBe(200);
    expect((await ok.json()).tracks).toEqual([{ title: 'Lagu', artist: 'Artis', durationMs: 1000 }]);
    expect(seen).toEqual([`open.spotify.com/embed/playlist/${SPOTIFY_ID}`]);
    expect((await fetch(`${runtime.baseUrl}/api/import/link`)).status).toBe(405);
    expect((await post('{')).status).toBe(400);
    expect((await post({ link: 5 })).status).toBe(400);
    const bad = await post({ link: 'https://example.com' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).kind).toBe('badLink');
    expect((await post({ link: 'x' }, { Origin: 'https://evil.test' })).status).toBe(403);
    const missing = await post({ link: 'https://www.deezer.com/playlist/5' });
    expect(missing.status).toBe(404);
  });
});
