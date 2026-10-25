import { afterEach, describe, expect, it } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { createRequire } from 'node:module';
import * as fx from './fixtures/innertube';

const require = createRequire(import.meta.url);
const it3 = require('../service/innertube.cjs');
const { runCatalog } = require('../service/catalog.cjs');

type Reply = { status: number; body: string };
const ok = (payload: unknown): Reply => ({ status: 200, body: JSON.stringify(payload) });
const scripted = (...replies: Array<Reply | Error | ((path: string, body: any) => Reply)>) => {
  const calls: Array<{ path: string; body: any }> = [];
  const upstream = async (path: string, body: any) => {
    calls.push({ path, body });
    const next = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(path, body) : next;
  };
  return { upstream, calls };
};

describe('home', () => {
  it('parses chips, mixed sections, play endpoints and continuation', () => {
    const payload = fx.homePayload([
      fx.carousel('Quick picks', [fx.twoRowSong('Yellow', 'v-yellow'), fx.twoRowAlbum('Parachutes', 'MPREb_para'), fx.twoRowArtist('Keane', 'UCkeane'), fx.twoRowPlaylist('Chill', 'PLchill')]),
      fx.carousel('Albums', [fx.twoRowAlbum('X&Y', 'MPREb_xy')], { browseId: 'FEmusic_new_releases_albums' }),
      { musicDescriptionShelfRenderer: { header: fx.runs(fx.run('Hello')), description: fx.runs(fx.run('text')) } },
    ], { ...fx.chips('Energize', 'Relax'), continuations: [{ nextContinuationData: { continuation: 'HOMECONT123' } }] });
    const page = it3.parseHome(payload);
    expect(page.chips).toEqual([{ title: 'Energize', browseId: 'FEmusic_home', params: 'chip_Energize' }, { title: 'Relax', browseId: 'FEmusic_home', params: 'chip_Relax' }]);
    expect(page.sections).toHaveLength(3);
    const picks = page.sections[0];
    expect(picks.title).toBe('Quick picks');
    expect(picks.contentKind).toBe('mixed');
    expect(picks.items.map((i: any) => [i.kind, i.id])).toEqual([['track', 'v-yellow'], ['album', 'MPREb_para'], ['artist', 'UCkeane'], ['playlist', 'PLchill']]);
    expect(picks.items[1]).toMatchObject({ title: 'Parachutes', year: '2021', playlistId: 'OLAK5uy_MPREb_para', artists: [{ id: 'UCartist1', name: 'Coldplay' }] });
    expect(picks.items[3].browseId).toBe('VLPLchill');
    expect(page.sections[1].more).toEqual({ browseId: 'FEmusic_new_releases_albums' });
    expect(page.sections[2].layout).toBe('text');
    expect(page.continuation).toEqual({ endpoint: 'browse', token: 'HOMECONT123', kind: 'home' });
  });

  it('prefers the largest thumbnail and keeps going when an item is unreadable', () => {
    const page = it3.parseHome(fx.homePayload([fx.carousel('Mix', [fx.twoRowAlbum('A', 'MPREb_a'), { musicTwoRowItemRenderer: { title: { runs: [] } } }, { somethingNew: {} }])]));
    expect(page.sections[0].items).toHaveLength(1);
    expect(page.sections[0].items[0].artworkUrl).toContain('w226');
    expect(page.skipped).toBe(2);
  });

  it('fails instead of returning an empty home when the container is missing', () => {
    expect(() => it3.parseHome({ contents: {} })).toThrowError(expect.objectContaining({ kind: 'invalid-response', status: 502 }));
  });
});

describe('search', () => {
  const payload = fx.searchPayload([
    { musicCardShelfRenderer: {
      title: fx.runs(fx.run('Yellow', fx.watch('v-yellow'))),
      subtitle: fx.runs(fx.run('Song'), fx.sep(), fx.artistRun('Coldplay', 'UCartist1')),
      thumbnail: fx.thumb(),
      contents: [fx.songRow('Yellow (Live)', 'v-live', { artist: 'Coldplay', duration: '5:10', videoType: 'MUSIC_VIDEO_TYPE_UGC' })],
    } },
    fx.shelf('Songs', [
      fx.songRow('Yellow', 'v-yellow', { typeLabel: 'Song', album: 'Parachutes', duration: '4:29' }),
      fx.songRow('Yellow Official', 'v-omv', { typeLabel: 'Video', videoType: 'MUSIC_VIDEO_TYPE_OMV', fixedDuration: '4:30' }),
      fx.continuationItem('SEARCHCONT456'),
    ]),
    fx.shelf('Artists', [fx.artistRow('Coldplay', 'UCartist1')]),
    fx.shelf('Albums', [fx.albumRow('Parachutes', 'MPREb_para')]),
  ]);

  it('separates the top card from the result list and classifies tracks and videos', () => {
    const page = it3.parseSearch(payload, 'all');
    expect(page.sections[0].topResult).toBe(true);
    expect(page.items.map((i: any) => i.id)).toEqual(['v-yellow', 'v-omv', 'UCartist1', 'MPREb_para']);
    const [song, video] = page.items;
    expect(song).toMatchObject({ kind: 'track', durationMs: 269000, album: { id: 'MPREb_album1' } });
    expect(video.kind).toBe('video');
    expect(video.durationMs).toBe(270000);
    expect(page.continuation).toMatchObject({ endpoint: 'search', token: 'SEARCHCONT456' });
    expect(page.sections.every((s: any) => !s.continuation)).toBe(true);
  });

  it('keeps remix/live variants as separate recordings', () => {
    const page = it3.parseSearch(fx.searchPayload([fx.shelf('Songs', [fx.songRow('Yellow', 'a'), fx.songRow('Yellow - Live', 'b'), fx.songRow('Yellow (Acoustic)', 'c')])]), 'songs');
    expect(page.items.map((i: any) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('parses suggestions into queries and entity hits', () => {
    const result = it3.parseSuggestions({ contents: [
      { searchSuggestionsSectionRenderer: { contents: [{ searchSuggestionRenderer: { suggestion: fx.runs(fx.run('yellow '), fx.run('coldplay')) } }] } },
      { searchSuggestionsSectionRenderer: { contents: [fx.songRow('Yellow', 'v-yellow')] } },
    ] });
    expect(result.queries).toEqual(['yellow coldplay']);
    expect(result.items[0].id).toBe('v-yellow');
  });

  it("keeps YouTube Music's flat run of one-row sections, grouped by kind in the phone's order (songs, videos, albums, artists, playlists)", () => {
    const row = (entry: any) => ({ itemSectionRenderer: { contents: [entry] } });
    const page = it3.parseSearch(fx.searchPayload([
      row(fx.songRow('Lagu A', 'a', { typeLabel: 'Song' })),
      row(fx.twoRowPlaylist('Daftar', 'PLq')),
      row(fx.songRow('Lagu Video', 'v', { typeLabel: 'Video', videoType: 'MUSIC_VIDEO_TYPE_OMV' })),
      row(fx.twoRowAlbum('Album X', 'MPREb_x')),
      row(fx.songRow('Lagu B', 'b', { typeLabel: 'Song' })),
    ]), 'all');
    expect(page.sections.map((section: any) => [section.contentKind, section.items.map((item: any) => item.title)])).toEqual([
      ['track', ['Lagu A', 'Lagu B']], ['video', ['Lagu Video']], ['album', ['Album X']], ['playlist', ['Daftar']],
    ]);
    expect(page.items).toHaveLength(5);
    expect(page.skipped).toBe(0);
  });

  it('returns no suggestions rather than failing on an empty body', () => {
    expect(it3.parseSuggestions({})).toEqual({ queries: [], items: [] });
  });
});

describe('detail pages', () => {
  it('parses an album header and track list with a continuation', () => {
    const page = it3.parseBrowse(fx.albumPayload([fx.songRow('Higher Power', 'v1', { duration: '3:27' }), fx.songRow('Humankind', 'v2', { duration: '4:26' })], { continuations: [{ nextContinuationData: { continuation: 'ALBUMCONT99' } }] }), 'MPREb_music');
    expect(page.type).toBe('album');
    expect(page.header).toMatchObject({ title: 'Music of the Spheres', year: '2021', playlistId: 'OLAK5uy_album1', artists: [{ name: 'Coldplay' }] });
    expect(page.tracks.map((t: any) => t.id)).toEqual(['v1', 'v2']);
    expect(page.related[0].title).toBe('More by Coldplay');
    expect(page.continuation).toMatchObject({ endpoint: 'browse', token: 'ALBUMCONT99', kind: 'tracks' });
  });

  it('routes VL ids to the playlist parser', () => {
    const page = it3.parseBrowse(fx.albumPayload([fx.songRow('One', 'p1')]), 'VLPLabc');
    expect(page.type).toBe('playlist');
    expect(page.tracks).toHaveLength(1);
  });

  it('parses an artist page: header, songs shelf, albums and similar artists', () => {
    const page = it3.parseBrowse(fx.artistPayload(), 'UCartist1');
    expect(page.type).toBe('artist');
    expect(page.header).toMatchObject({ title: 'Coldplay', subscribers: '3.2M subscribers', radioPlaylistId: 'RDEMartist', playlistId: 'RDAMVM1' });
    expect(page.songs.map((s: any) => s.id)).toEqual(['v-yellow', 'v-fix']);
    expect(page.songsMore).toEqual({ browseId: 'VLOLAK5uy_songs' });
    expect(page.sections.map((s: any) => s.title)).toEqual(['Albums', 'Fans might also like', 'About']);
  });

  it('parses a genre grid as a generic page with link items', () => {
    const page = it3.parseBrowse({
      header: { musicHeaderRenderer: { title: fx.runs(fx.run('Moods & genres')) } },
      contents: { singleColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ gridRenderer: { items: [
        { musicNavigationButtonRenderer: { buttonText: fx.runs(fx.run('Rock')), clickCommand: { browseEndpoint: { browseId: 'FEmusic_moods_and_genres_category', params: 'ggMPOg' } }, solid: { leftStripeColor: 0xffaa3366 } } },
      ] } }] } } } }] } },
    }, 'FEmusic_moods_and_genres');
    expect(page.type).toBe('page');
    expect(page.title).toBe('Moods & genres');
    expect(page.sections[0].items[0]).toMatchObject({ kind: 'link', title: 'Rock', browseId: 'FEmusic_moods_and_genres_category', params: 'ggMPOg', color: '#aa3366' });
  });

  it('throws when an album page lacks its header', () => {
    expect(() => it3.parseBrowse({ contents: {} }, 'MPREb_x')).toThrowError(expect.objectContaining({ kind: 'invalid-response' }));
  });
});

describe('next', () => {
  it('parses the queue panel, selected index, automix and tab browse ids', () => {
    const panel = fx.playlistPanel([fx.panelItem('a', 'One', true), fx.panelItem('b', 'Two'), {
      automixPreviewVideoRenderer: { content: { automixPlaylistVideoRenderer: { navigationEndpoint: { watchPlaylistEndpoint: { playlistId: 'RDAMPLx', params: 'wAEB' } } } } },
    }], fx.nextContinuation('NEXTCONT'));
    const payload: any = fx.nextPayload(panel, [
      { tabRenderer: { endpoint: { browseEndpoint: { browseId: 'MPLYt_lyrics' } } } },
      { tabRenderer: { endpoint: { browseEndpoint: { browseId: 'MPTRt_related' } } } },
    ]);
    const page = it3.parseNext(payload);
    expect(page.items.map((i: any) => i.id)).toEqual(['a', 'b']);
    expect(page.currentIndex).toBe(0);
    expect(page.items[0]).toMatchObject({ durationMs: 269000, album: { id: 'MPREb_para' } });
    expect(page.automix).toEqual({ playlistId: 'RDAMPLx', params: 'wAEB' });
    expect(page.lyricsBrowseId).toBe('MPLYt_lyrics');
    expect(page.relatedBrowseId).toBe('MPTRt_related');
    expect(page.continuation.token).toBe('NEXTCONT');
  });

  it('fails when the queue container is absent', () => {
    expect(() => it3.parseNext({ contents: {} })).toThrowError(expect.objectContaining({ kind: 'invalid-response' }));
  });
});

describe('continuation tokens and validation', () => {
  it('round-trips a token and rejects tampered or oversized ones', () => {
    const token = it3.encodeToken('search', 'CONT-1', { kind: 'search' });
    expect(it3.decodeToken(token)).toEqual({ endpoint: 'search', continuation: 'CONT-1', meta: { kind: 'search' } });
    for (const bad of ['', 'not a token', 'abcdefgh', token + '$$', 'x'.repeat(7000), 123 as any]) {
      expect(() => it3.decodeToken(bad), String(bad).slice(0, 12)).toThrowError(expect.objectContaining({ kind: 'bad-request', status: 400 }));
    }
    const wrongEndpoint = Buffer.from(JSON.stringify({ v: 1, e: 'player', c: 'abc12345' })).toString('base64').replace(/=+$/, '');
    expect(() => it3.decodeToken(wrongEndpoint)).toThrowError(expect.objectContaining({ kind: 'bad-request' }));
    const wrongVersion = Buffer.from(JSON.stringify({ v: 2, e: 'search', c: 'abc12345' })).toString('base64').replace(/=+$/, '');
    expect(() => it3.decodeToken(wrongVersion)).toThrowError(expect.objectContaining({ kind: 'bad-request' }));
  });

  it('builds requests from fixed upstream paths only', () => {
    expect(it3.buildOperation('home', {}).path).toBe('/youtubei/v1/browse');
    expect(it3.buildOperation('home', {}).body).toMatchObject({ browseId: 'FEmusic_home' });
    expect(it3.buildOperation('search', { query: ' yellow ', filter: 'songs' }).body).toMatchObject({ query: 'yellow', params: it3.SEARCH_FILTERS.songs });
    expect(it3.buildOperation('search', { query: 'x' }).body.params).toBeUndefined();
    expect(it3.buildOperation('suggest', { query: 'yel' }).path).toBe('/youtubei/v1/music/get_search_suggestions');
    expect(it3.buildOperation('next', { videoId: 'abc', playlistId: 'RDAMVMabc' }).body).toMatchObject({ videoId: 'abc', isAudioOnly: true });
    const resumed = it3.buildOperation('search', { continuation: { token: it3.encodeToken('search', 'CONT-1', { kind: 'search', endpoint: 'search' }) } });
    expect(resumed.path).toBe('/youtubei/v1/search');
    expect(resumed.body.continuation).toBe('CONT-1');
  });

  it.each([
    ['search', { query: '' }],
    ['search', { query: 'x'.repeat(201) }],
    ['search', { query: 'a', filter: 'bogus' }],
    ['suggest', {}],
    ['browse', { browseId: 'https://evil.test/x' }],
    ['browse', { browseId: '../../player' }],
    ['browse', {}],
    ['next', {}],
    ['next', { videoId: 'a b' }],
    ['next', { videoId: 'abc', index: -1 }],
    ['home', { params: '<script>' }],
    ['home', { continuation: 'garbage!' }],
  ])('rejects invalid %s params %j with 400', (operation, params) => {
    expect(() => it3.buildOperation(operation, params)).toThrowError(expect.objectContaining({ kind: 'bad-request', status: 400 }));
  });

  it('rejects unknown operations with 404', () => {
    expect(() => it3.buildOperation('player', { videoId: 'abc' })).toThrowError(expect.objectContaining({ kind: 'not-found', status: 404 }));
  });

  it('falls back to safe locale defaults', () => {
    const body = it3.buildOperation('home', { locale: { hl: '"><', gl: 'zz' } }).body;
    expect(body.context.client).toMatchObject({ clientName: 'WEB_REMIX', hl: 'en', gl: 'US' });
  });
});

describe('continuation responses', () => {
  const meta = (kind: string, endpoint = 'browse') => ({ kind, endpoint });
  it('parses a shelf continuation and chains the next token', () => {
    const page = it3.parseContinuation({ continuationContents: { musicShelfContinuation: { contents: [fx.songRow('Three', 'v3')], ...fx.nextContinuation('MORE2') } } }, meta('tracks'));
    expect(page.items.map((i: any) => i.id)).toEqual(['v3']);
    expect(page.continuation).toEqual({ endpoint: 'browse', token: 'MORE2', kind: 'tracks' });
  });
  it('parses a section-list continuation into sections', () => {
    const page = it3.parseContinuation({ continuationContents: { sectionListContinuation: { contents: [fx.carousel('More', [fx.twoRowAlbum('A', 'MPREb_a')])] } } }, meta('home'));
    expect(page.items).toHaveLength(0);
    expect(page.sections[0].title).toBe('More');
    expect(page.continuation).toBeUndefined();
  });
  it('parses the appendContinuationItemsAction format', () => {
    const page = it3.parseContinuation({ onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [fx.songRow('Four', 'v4'), fx.continuationItem('APPEND3')] } }] }, meta('tracks'));
    expect(page.items.map((i: any) => i.id)).toEqual(['v4']);
    expect(page.continuation.token).toBe('APPEND3');
  });
  it('parses a playlist panel continuation', () => {
    const page = it3.parseContinuation({ continuationContents: { playlistPanelContinuation: { contents: [fx.panelItem('n1', 'N1')], ...fx.nextContinuation('NEXT2') } } }, meta('next', 'next'));
    expect(page.items[0].id).toBe('n1');
    expect(page.continuation).toMatchObject({ endpoint: 'next', token: 'NEXT2' });
  });
  it('treats an unrecognised continuation body as an error, not an empty page', () => {
    expect(() => it3.parseContinuation({ foo: 1 }, meta('home'))).toThrowError(expect.objectContaining({ kind: 'invalid-response' }));
  });
});

describe('runCatalog', () => {
  it('seals continuation tokens so the client can feed them back', async () => {
    const first = scripted(ok(fx.searchPayload([fx.shelf('Songs', [fx.songRow('Yellow', 'a'), fx.continuationItem('SEARCHCONT456')])])));
    const page = await runCatalog('search', { query: 'yellow', filter: 'songs' }, first.upstream);
    expect(page.items[0].id).toBe('a');
    expect(page.continuation.token).not.toContain('SEARCHCONT456');
    const second = scripted(ok({ continuationContents: { musicShelfContinuation: { contents: [fx.songRow('Yellow 2', 'b')] } } }));
    const more = await runCatalog('search', { continuation: page.continuation }, second.upstream);
    expect(more.items[0].id).toBe('b');
    expect(second.calls[0].path).toBe('/youtubei/v1/search');
    expect(second.calls[0].body.continuation).toBe('SEARCHCONT456');
    expect(second.calls[0].body.query).toBeUndefined();
  });

  it('follows the automix preview and merges without duplicating tracks', async () => {
    const firstPanel = fx.nextPayload(fx.playlistPanel([fx.panelItem('a', 'A', true), fx.panelItem('b', 'B'), {
      automixPreviewVideoRenderer: { content: { automixPlaylistVideoRenderer: { navigationEndpoint: { watchPlaylistEndpoint: { playlistId: 'RDAMPLx', params: 'wAEB' } } } } },
    }]));
    const secondPanel = fx.nextPayload(fx.playlistPanel([fx.panelItem('b', 'B'), fx.panelItem('c', 'C')], fx.nextContinuation('RADIOCONT')));
    const { upstream, calls } = scripted(ok(firstPanel), ok(secondPanel));
    const page = await runCatalog('next', { videoId: 'a', playlistId: 'OLAK5uy_x' }, upstream);
    expect(page.items.map((i: any) => i.id)).toEqual(['a', 'b', 'c']);
    expect(page.radioPlaylistId).toBe('RDAMPLx');
    expect(page.automix).toBeUndefined();
    expect(page.continuation).toBeDefined();
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toMatchObject({ playlistId: 'RDAMPLx', params: 'wAEB' });
  });

  it('keeps the first panel and flags radioUnavailable when the automix follow-up fails', async () => {
    const firstPanel = fx.nextPayload(fx.playlistPanel([fx.panelItem('a', 'A', true), {
      automixPreviewVideoRenderer: { content: { automixPlaylistVideoRenderer: { navigationEndpoint: { watchPlaylistEndpoint: { playlistId: 'RDAMPLx' } } } } },
    }]));
    const { upstream } = scripted(ok(firstPanel), { status: 500, body: '' });
    const page = await runCatalog('next', { videoId: 'a' }, upstream);
    expect(page.items.map((i: any) => i.id)).toEqual(['a']);
    expect(page.radioUnavailable).toBe(true);
  });

  it.each([
    [{ status: 429, body: '' }, 'rate-limited', 429],
    [{ status: 403, body: '' }, 'forbidden', 502],
    [{ status: 401, body: '' }, 'forbidden', 502],
    [{ status: 500, body: '' }, 'upstream-http', 502],
    [{ status: 200, body: '<html>' }, 'invalid-response', 502],
    [{ status: 200, body: '[]' }, 'invalid-response', 502],
    [new Error('request timeout'), 'timeout', 504],
    [new Error('ECONNREFUSED'), 'network', 502],
  ])('maps upstream failure %# to %s', async (reply, kind, status) => {
    const { upstream } = scripted(reply as any);
    await expect(runCatalog('home', {}, upstream)).rejects.toMatchObject({ kind, status });
  });

  it('does not call upstream when validation fails', async () => {
    const { upstream, calls } = scripted(ok({}));
    await expect(runCatalog('browse', { browseId: 'http://x' }, upstream)).rejects.toMatchObject({ kind: 'bad-request' });
    expect(calls).toHaveLength(0);
  });
});

describe('POST /api/catalog/{operation}', () => {
  let servers: Server[] = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => { s.closeAllConnections(); s.close(() => resolve()); }))); });

  async function boot(handler: (path: string, body: any) => { status: number; json?: unknown; raw?: string }) {
    const { startRuntime } = require('../service/runtime.cjs');
    const seen: Array<{ path: string; body: any; headers: Record<string, any> }> = [];
    const upstream = createServer((req, res) => {
      let data = '';
      req.on('data', (chunk) => { data += chunk; });
      req.on('end', () => {
        const body = data ? JSON.parse(data) : undefined;
        seen.push({ path: req.url || '', body, headers: req.headers });
        const reply = handler(req.url || '', body);
        res.writeHead(reply.status, { 'Content-Type': 'application/json' });
        res.end(reply.raw !== undefined ? reply.raw : JSON.stringify(reply.json ?? {}));
      });
    });
    servers.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const requester = (url: string, options: any) => new Promise((resolve, reject) => {
      const target = new URL(url);
      const req = httpRequest({ hostname: '127.0.0.1', port: (upstream.address() as any).port, path: target.pathname + target.search, method: options.method, headers: options.headers }, resolve);
      req.on('error', reject);
      req.end(options.body);
    });
    const runtime = await startRuntime({ request: requester });
    servers.push(runtime.server);
    return { runtime, seen };
  }
  const post = (runtime: any, operation: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(runtime.baseUrl + '/api/catalog/' + operation, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers });

  it('serves a normalised search page with WEB_REMIX headers', async () => {
    const { runtime, seen } = await boot(() => ({ status: 200, json: fx.searchPayload([fx.shelf('Songs', [fx.songRow('Yellow', 'v-yellow')])]) }));
    const response = await post(runtime, 'search', { query: 'yellow', filter: 'songs' });
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(page.items[0]).toMatchObject({ kind: 'track', id: 'v-yellow' });
    expect(seen[0].path).toContain('/youtubei/v1/search');
    expect(seen[0].body.context.client.clientName).toBe('WEB_REMIX');
  });

  it('maps validation, rate limit and upstream failures to JSON errors', async () => {
    let mode = 429;
    const { runtime } = await boot(() => (mode === 0 ? { status: 200, raw: 'nope' } : { status: mode }));
    const bad = await post(runtime, 'browse', { browseId: 'http://x' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ kind: 'bad-request' });
    const limited = await post(runtime, 'home', {});
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ kind: 'rate-limited' });
    mode = 0;
    const broken = await post(runtime, 'home', {});
    expect(broken.status).toBe(502);
    expect(await broken.json()).toMatchObject({ kind: 'invalid-response' });
  });

  it('treats an upstream redirect as a failure instead of following it', async () => {
    const { runtime } = await boot(() => ({ status: 302 }));
    const response = await post(runtime, 'home', {});
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ kind: 'upstream-http' });
  });

  it('refuses unknown operations, non-POST, bad JSON, oversized bodies, foreign origins and missing tokens', async () => {
    const { runtime } = await boot(() => ({ status: 200, json: fx.homePayload([]) }));
    expect((await post(runtime, 'player', { videoId: 'abc' })).status).toBe(404);
    expect((await fetch(runtime.baseUrl + '/api/catalog/home')).status).toBeGreaterThanOrEqual(400);
    expect((await post(runtime, 'home', '{not json')).status).toBe(400);
    expect((await post(runtime, 'home', 'x'.repeat(33000))).status).toBe(413);
    expect((await post(runtime, 'home', {}, { Origin: 'https://evil.test' })).status).toBe(403);
    expect((await fetch(runtime.origin + '/api/catalog/home', { method: 'POST', body: '{}' })).status).toBe(403);
  });
});
