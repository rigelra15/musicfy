import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { createSources, createMemoryStorage, allowedSourceUrl, allowedMediaUrl, flacInfo, legacyKey, psshFor, jwtExpiryMs } = require('../service/sources.cjs');

const fixture = (name: string) => readFileSync(new URL(`./fixtures/sources/${name}`, import.meta.url));
type Req = { url: string; method?: string; headers?: Record<string, string>; body?: string };
const reply = (status: number, body: Buffer | string = '') => ({ status, body: Buffer.isBuffer(body) ? body : Buffer.from(body) });

// the real first 42 bytes of a CD-quality FLAC (captured from the streamer)
const flacHead = Buffer.from([0x66, 0x4c, 0x61, 0x43, 0, 0, 0, 0x22, 0x04, 0x80, 0x04, 0x80, 0, 0, 0x0e, 0, 0x11, 0x2d, 0x0a, 0xc4, 0x42, 0xf0, 0, 0x74, 0xf3, 0xbf, 0xdc, 0xee, 0xc0, 0x89, 0xf2, 0x89, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const devToken = 'eyJhbGciOiJFUzI1NiJ9.' + Buffer.from(JSON.stringify({ iss: 'AMPWebPlay', exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url') + '.c2ln';
const keyUri = 'data:;base64,ESIzRFVmd4iZqrvM3e7/AA==';
const legacyPlaylist = ['#EXTM3U', '#EXT-X-VERSION:5', '#EXT-X-TARGETDURATION:11',
  `#EXT-X-KEY:METHOD=SAMPLE-AES,URI="${keyUri}",KEYFORMAT="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed",KEYFORMATVERSIONS="1"`,
  '#EXT-X-MAP:URI="P123_A456_ctrp256.mp4",BYTERANGE="700@0"', '#EXTINF:10.0,', '#EXT-X-BYTERANGE:1000@700', 'P123_A456_ctrp256.mp4', '#EXT-X-ENDLIST'].join('\n');
const webPlayback = JSON.stringify({ songList: [{ assets: [{ flavor: '30:cbcp256', URL: 'https://aod.itunes.apple.com/a/b/fairplay.m3u8' }, { flavor: '32:ctrp64', URL: 'https://aod.itunes.apple.com/a/b/P123_64.m3u8' }, { flavor: '28:ctrp256', URL: 'https://aod.itunes.apple.com/a/b/P123.m3u8' }] }] });

let requests: Req[];
let storage: ReturnType<typeof createMemoryStorage>;
let routes: (req: Req) => ReturnType<typeof reply> | undefined;
let clock: number;
let counter: number;
const make = () => createSources({ http: async (url: string, o: Omit<Req, 'url'> = {}) => { const req = { url, ...o }; requests.push(req); const r = routes(req); if (!r) throw new Error('offline'); return r; }, storage, now: () => clock, newToken: () => `tok${(counter += 1)}` });

beforeEach(() => { requests = []; storage = createMemoryStorage(); clock = Date.now(); counter = 0; routes = () => undefined; });

describe('what may be asked', () => {
  it('only fixed hosts and paths', () => {
    expect(allowedSourceUrl('https://tracks.monochrome.st/search/tracks?q=x')).toBe(true);
    expect(allowedSourceUrl('https://amp-api.music.apple.com/v1/catalog/us/search?term=x')).toBe(true);
    expect(allowedSourceUrl('https://play.itunes.apple.com/WebObjects/MZPlay.woa/wa/webPlayback')).toBe(true);
    for (const bad of ['http://tracks.monochrome.st/search/tracks', 'https://tracks.monochrome.st/admin', 'https://evil.test/search/tracks', 'https://u:p@tracks.monochrome.st/search/tracks', 'https://tracks.monochrome.st:8443/search/tracks', 'https://amp-api.music.apple.com/v1/me/library', 'nope'])
      expect(allowedSourceUrl(bad)).toBe(false);
    expect(allowedMediaUrl('https://aod.itunes.apple.com/a/b/P123.mp4')).toBe(true);
    expect(allowedMediaUrl('https://is1-ssl.mzstatic.com/x.m4a')).toBe(true);
    expect(allowedMediaUrl('https://tracks.monochrome.st/track/123')).toBe(true);
    for (const bad of ['https://evil.test/x', 'https://apple.com.evil.test/x', 'http://aod.itunes.apple.com/x', 'https://tracks.monochrome.st/search/tracks', 'https://127.0.0.1/x']) expect(allowedMediaUrl(bad)).toBe(false);
  });
});

describe('Monochrome', () => {
  const eastside = { title: 'Eastside', artists: ['benny blanco', 'Halsey', 'Khalid'], durationMs: 173_000 };
  const online = () => { routes = (req) => (req.url.includes('/search/tracks?') ? reply(200, fixture('monochrome-search.json')) : req.url.includes('/track/') ? reply(206, flacHead) : undefined); };

  it('finds the recording, checks the file really is FLAC, and hands back a relay path with honest labels', async () => {
    online();
    const sources = make();
    const out = await sources.resolve('monochrome', eastside, {});
    expect(out.result).toBe('found');
    expect(out.stream).toMatchObject({ format: 'progressive', mimeType: 'audio/flac', codec: 'FLAC', qualityLabel: 'FLAC', sourceLabel: 'Monochrome', sampleRateHz: 44100, path: '/api/source/media/tok1' });
    expect(out.stream.matched.title).toContain('Eastside');
    expect(JSON.stringify(out)).not.toContain('tracks.monochrome.st');             // the renderer never sees the upstream address
    expect(sources.entry('tok1')).toMatchObject({ kind: 'media', url: expect.stringMatching(/^https:\/\/tracks\.monochrome\.st\/track\//) });
    expect(requests.find((r) => r.url.includes('/track/'))!.headers!.Range).toBe('bytes=0-41');
  });

  it('says "matching" when the song is not there, and remembers for a while without asking again', async () => {
    routes = (req) => (req.url.includes('/search/tracks?') ? reply(200, JSON.stringify({ tracks: [] })) : undefined);
    const sources = make();
    expect(await sources.resolve('monochrome', eastside, {})).toMatchObject({ result: 'notFound', kind: 'matching' });
    const before = requests.length;
    expect(await sources.resolve('monochrome', eastside, {})).toMatchObject({ result: 'notFound', kind: 'matching' });
    expect(requests.length).toBe(before);
  });

  it('says "network" when the server is down, then leaves it alone for ten minutes of status but still tries songs', async () => {
    const sources = make();
    expect(await sources.resolve('monochrome', eastside, {})).toMatchObject({ result: 'unavailable', kind: 'network' });
    expect(sources.status().modules[0].account).toMatchObject({ state: 'unreachable' });
    clock += 11 * 60_000;
    expect(sources.status().modules[0].account.state).toBe('ready');
  });

  it('says "stream" for a file that is not FLAC or a stream that answers an error', async () => {
    routes = (req) => (req.url.includes('/search/tracks?') ? reply(200, fixture('monochrome-search.json')) : reply(206, Buffer.from('<html>blocked</html>')));
    expect(await make().resolve('monochrome', eastside, {})).toMatchObject({ result: 'unavailable', kind: 'stream', reason: expect.stringMatching(/bukan FLAC/) });
    routes = (req) => (req.url.includes('/search/tracks?') ? reply(200, fixture('monochrome-search.json')) : reply(403));
    expect(await make().resolve('monochrome', eastside, {})).toMatchObject({ kind: 'stream', reason: expect.stringMatching(/403/) });
  });

  it('labels Hi-Res FLAC from the file header, not from a promise', () => {
    const head = Buffer.alloc(42);
    head.write('fLaC', 0, 'latin1');
    head[7] = 0x22;
    head[8 + 10] = 0x17; head[8 + 11] = 0x70; head[8 + 12] = 0x03; head[8 + 13] = 0x70;       // 96 kHz, stereo, 24 bit
    expect(flacInfo(head)).toEqual({ bits: 24, sampleRate: 96000 });
    expect(flacInfo(flacHead)).toMatchObject({ bits: 16, sampleRate: 44100 });
    expect(flacInfo(Buffer.from('nope'))).toBeUndefined();
    routes = (req) => (req.url.includes('/search/tracks?') ? reply(200, fixture('monochrome-search.json')) : reply(206, head));
    return make().resolve('monochrome', { title: 'Eastside', artists: ['benny blanco', 'Halsey', 'Khalid'], durationMs: 173_000 }, {}).then((out: { stream: { qualityLabel: string; sampleRateHz: number } }) => {
      expect(out.stream).toMatchObject({ qualityLabel: 'Hi-Res FLAC', sampleRateHz: 96000 });
    });
  });

  it('verify reports reachability; needs no account', async () => {
    online();
    expect(await make().verify('monochrome')).toMatchObject({ state: 'ready' });
    routes = () => reply(503);
    expect(await make().verify('monochrome')).toMatchObject({ state: 'unreachable', label: expect.stringMatching(/503/) });
  });
});

describe('Apple Music', () => {
  const espresso = { title: 'Espresso', artists: ['Sabrina Carpenter'], durationMs: 175_000 };
  const signedIn = () => {
    routes = (req) => {
      if (req.url.endsWith('/v1/me/storefront')) return reply(200, JSON.stringify({ data: [{ id: 'us', attributes: { name: 'United States' } }] }));
      if (req.url.includes('/search?')) return reply(200, fixture('apple-search.json'));
      if (req.url.endsWith('wa/webPlayback')) return reply(200, webPlayback);
      if (req.url.startsWith('https://aod.itunes.apple.com/a/b/P123')) return reply(200, legacyPlaylist);
      if (req.url.endsWith('acquireWebPlaybackLicense')) return reply(200, JSON.stringify({ status: 0, license: Buffer.from('LICENSE-BYTES').toString('base64') }));
      return reply(404);
    };
    const sources = make();
    sources.setSession('applemusic', { userToken: 'A'.repeat(40), developerToken: devToken });
    return sources;
  };

  it('signed out: asks for the phone, and says it is an account problem', async () => {
    const out = await make().resolve('applemusic', espresso, {});
    expect(out).toMatchObject({ result: 'unavailable', kind: 'auth' });
    expect(make().status().modules[1].account).toMatchObject({ state: 'signedOut' });
  });

  it('finds the song and opens the web-playback stream: HLS manifest on the service, one relay per file, a license path', async () => {
    const sources = signedIn();
    const out = await sources.resolve('applemusic', espresso, {});
    expect(out.result).toBe('found');
    expect(out.stream).toMatchObject({ format: 'hls', mimeType: 'application/vnd.apple.mpegurl', codec: 'AAC', qualityLabel: 'AAC 256', sourceLabel: 'Apple Music', drm: { system: 'com.widevine.alpha' } });
    expect(out.stream.matched.id).toBe('1740212434');
    const manifest = sources.entry(out.stream.path.split('/').pop()).body as string;
    expect(manifest).toContain('/api/source/media/');
    expect(manifest).not.toContain('aod.itunes.apple.com');                        // files go through the relay
    expect(manifest).toMatch(/#EXT-X-KEY:METHOD=SAMPLE-AES,URI="data:text\/plain;base64,[A-Za-z0-9+/=]+",KEYFORMAT="urn:uuid:edef8ba9/);
    const files = [...manifest.matchAll(/\/api\/source\/media\/(tok\d+)/g)].map((m) => sources.entry(m[1]));
    expect(files.every((f) => f.kind === 'media' && f.url.startsWith('https://aod.itunes.apple.com/a/b/'))).toBe(true);
    const play = requests.find((r) => r.url.endsWith('wa/webPlayback'))!;
    expect(JSON.parse(play.body!).salableAdamId).toBe('1740212434');
    expect(play.headers!['Media-User-Token']).toBe('A'.repeat(40));
    expect(requests.every((r) => r.headers && r.headers.Origin === 'https://music.apple.com')).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/AAAAAAAA|eyJhbGci|play\.itunes/);       // no credential, no upstream address
  });

  it('HE-AAC picks the smaller stream and says so', async () => {
    const out = await signedIn().resolve('applemusic', espresso, { quality: 'he64' });
    expect(out.stream).toMatchObject({ qualityLabel: 'HE-AAC 64', codec: 'HE-AAC' });
    expect(requests.some((r) => r.url === 'https://aod.itunes.apple.com/a/b/P123_64.m3u8')).toBe(true);
  });

  it('the license is fetched with the key the playlist named, and only the license bytes come back', async () => {
    const sources = signedIn();
    const out = await sources.resolve('applemusic', espresso, {});
    const token = out.stream.drm.licensePath.split('/').pop();
    const challenge = Buffer.concat([Buffer.from('chal'), Buffer.from('1122334455667788' + '99aabbccddeeff00', 'hex')]);
    const license = await sources.license(token, challenge);
    expect(license.toString()).toBe('LICENSE-BYTES');
    const sent = JSON.parse(requests.find((r) => r.url.endsWith('acquireWebPlaybackLicense'))!.body!);
    expect(sent).toMatchObject({ uri: keyUri, adamId: '1740212434', 'key-system': 'com.widevine.alpha' });
    expect(Buffer.from(sent.challenge, 'base64').equals(challenge)).toBe(true);
  });

  it('license failures are told apart: an expired session is "auth", a refusal or a server error is "license", offline is "network"', async () => {
    const sources = signedIn();
    const token = (await sources.resolve('applemusic', espresso, {})).stream.drm.licensePath.split('/').pop();
    const challenge = Buffer.from('abcdefgh');
    routes = (req) => (req.url.endsWith('acquireWebPlaybackLicense') ? reply(200, JSON.stringify({ status: -1002, customerMessage: 'Sesi berakhir' })) : undefined);
    await expect(sources.license(token, challenge)).rejects.toMatchObject({ kind: 'auth', status: 401 });
    expect(sources.status().modules[1].account.state).toBe('expired');
    routes = (req) => (req.url.endsWith('acquireWebPlaybackLicense') ? reply(200, JSON.stringify({ status: 5, customerMessage: 'Perangkat ditolak' })) : undefined);
    await expect(sources.license(token, challenge)).rejects.toMatchObject({ kind: 'license', message: expect.stringMatching(/ditolak/) });
    routes = () => reply(500);
    await expect(sources.license(token, challenge)).rejects.toMatchObject({ kind: 'license' });
    routes = () => undefined;
    await expect(sources.license(token, challenge)).rejects.toMatchObject({ kind: 'network' });
    await expect(sources.license('unknown', challenge)).rejects.toMatchObject({ kind: 'license', status: 410 });
    await expect(sources.license(token, Buffer.alloc(70000))).rejects.toMatchObject({ status: 400 });
  });

  it('a song Apple does not have is "matching"; no stream is "stream"; a refused session is "auth"', async () => {
    const sources = signedIn();
    expect(await sources.resolve('applemusic', { title: 'Lagu yang tidak ada', artists: ['Tidak Ada'] }, {})).toMatchObject({ result: 'notFound', kind: 'matching' });
    routes = (req) => (req.url.endsWith('wa/webPlayback') ? reply(200, JSON.stringify({ songList: [], customerMessage: 'Tidak ada di wilayahmu' })) : reply(200, fixture('apple-search.json')));
    expect(await sources.resolve('applemusic', espresso, {})).toMatchObject({ result: 'unavailable', kind: 'stream', reason: expect.stringMatching(/wilayahmu/) });
    routes = (req) => (req.url.endsWith('wa/webPlayback') ? reply(403) : reply(200, fixture('apple-search.json')));
    expect(await signedIn().resolve('applemusic', espresso, {})).toBeDefined();
  });

  it('verify reads the account and storefront; a 401 is an expired session after one token refresh; sign-out forgets everything', async () => {
    const sources = signedIn();
    expect(await sources.verify('applemusic')).toMatchObject({ state: 'signedIn', label: 'Terhubung · us' });
    routes = (req) => (req.url.endsWith('/v1/me/storefront') ? reply(401) : reply(404));
    expect(await sources.verify('applemusic')).toMatchObject({ state: 'expired' });
    expect(sources.status().modules[1].account.state).toBe('expired');
    sources.signOut('applemusic');
    expect(sources.status().modules[1].account).toMatchObject({ state: 'signedOut' });
    expect(storage.get('applemusic.user_token')).toBeUndefined();
    expect(storage.get('applemusic.developer_token')).toBeUndefined();
  });

  it('only a plausible session is accepted, and status never carries a secret', () => {
    const sources = make();
    expect(() => sources.setSession('applemusic', { userToken: 'short' })).toThrow();
    expect(() => sources.setSession('monochrome', { userToken: 'x'.repeat(40) })).toThrow();
    sources.setSession('applemusic', { userToken: 'B'.repeat(40) });
    expect(JSON.stringify(sources.status())).not.toMatch(/BBBBBBBB|eyJ/);
  });

  it('region and quality picks are checked, and the region choice searches that catalog', async () => {
    const sources = signedIn();
    await sources.resolve('applemusic', espresso, { region: 'id' });
    expect(requests.some((r) => r.url.includes('/v1/catalog/id/search'))).toBe(true);
    expect(sources.status().modules[1].choices.map((c: { id: string }) => c.id)).toEqual(['quality', 'region']);
    expect((await sources.resolve('applemusic', espresso, { region: '../x' })).result).toBe('found');   // an invalid pick is dropped, not used
  });
});

describe('inputs and diagnostics', () => {
  it('refuses nonsense queries and unknown sources', async () => {
    const sources = make();
    await expect(sources.resolve('monochrome', { title: '' }, {})).rejects.toMatchObject({ status: 400 });
    await expect(sources.resolve('spotify', { title: 'x' }, {})).rejects.toMatchObject({ status: 404 });
  });

  it('diagnose lists each step the way the Android test button does', async () => {
    routes = (req) => (req.url.includes('/search/tracks?') ? reply(200, fixture('monochrome-search.json')) : reply(206, flacHead));
    const out = await make().diagnose('monochrome', { title: 'Eastside', artists: ['benny blanco', 'Halsey', 'Khalid'], durationMs: 173_000 }, {});
    expect(out.result).toBe('found');
    expect(out.steps.map((s: { name: string; ok: boolean }) => [s.name, s.ok])).toEqual([['Cari lagu', true], ['Stream', true]]);
    routes = () => undefined;
    const down = await make().diagnose('monochrome', { title: 'Eastside', artists: ['x'] }, {});
    expect(down.steps[0]).toMatchObject({ name: 'Cari lagu', ok: false });
  });
});

describe('helpers', () => {
  it('reads the key and builds a PSSH that names it', () => {
    const key = legacyKey(legacyPlaylist);
    expect(key.keyId.toString('hex')).toBe('112233445566778899aabbccddeeff00');
    const pssh = psshFor(key.keyId);
    expect(pssh.subarray(4, 8).toString()).toBe('pssh');
    expect(pssh.readUInt32BE(0)).toBe(pssh.length);
    expect(pssh.subarray(12, 28).toString('hex')).toBe('edef8ba979d64acea3c827dcd51d21ed');
    expect(pssh.subarray(-16).equals(key.keyId)).toBe(true);
    expect(legacyKey('#EXTM3U\n#EXT-X-KEY:METHOD=NONE')).toBeUndefined();
  });
  it('reads a token\'s expiry', () => {
    expect(jwtExpiryMs(devToken)).toBeGreaterThan(Date.now());
    expect(jwtExpiryMs('garbage')).toBe(0);
  });
});
