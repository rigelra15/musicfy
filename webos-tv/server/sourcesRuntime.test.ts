import { readFileSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { FakePhone, parseQr } from './transferClient';
const require = createRequire(import.meta.url);

const fixture = (name: string) => readFileSync(new URL(`./fixtures/sources/${name}`, import.meta.url));
const flacHead = Buffer.from([0x66, 0x4c, 0x61, 0x43, 0, 0, 0, 0x22, 0x04, 0x80, 0x04, 0x80, 0, 0, 0x0e, 0, 0x11, 0x2d, 0x0a, 0xc4, 0x42, 0xf0, 0, 0x74, 0xf3, 0xbf, 0xdc, 0xee, 0xc0, 0x89, 0xf2, 0x89, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const audio = Buffer.concat([flacHead, Buffer.from('0123456789'.repeat(20))]);
const devToken = 'eyJhbGciOiJFUzI1NiJ9.' + Buffer.from(JSON.stringify({ iss: 'AMPWebPlay', exp: Math.floor(Date.now() / 1000) + 86400 })).toString('base64url') + '.c2ln';
const keyUri = 'data:;base64,ESIzRFVmd4iZqrvM3e7/AA==';
const playlist = ['#EXTM3U', `#EXT-X-KEY:METHOD=SAMPLE-AES,URI="${keyUri}",KEYFORMAT="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed",KEYFORMATVERSIONS="1"`, '#EXT-X-MAP:URI="init.mp4"', '#EXTINF:10.0,', 'seg1.mp4', '#EXT-X-ENDLIST'].join('\n');

let servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => { s.closeAllConnections(); s.close(() => resolve()); }))); });

async function start() {
  const seen: Array<{ host: string; path: string; headers: Record<string, string | string[] | undefined> }> = [];
  const upstream = createServer((req, res) => {
    const host = String(req.headers['x-test-host']);
    const url = new URL(req.url!, 'http://x');
    seen.push({ host, path: url.pathname + url.search, headers: req.headers });
    const send = (status: number, body: Buffer | string, type = 'application/json', extra: Record<string, string> = {}) => { res.writeHead(status, { 'Content-Type': type, ...extra }); res.end(body); };
    if (host === 'tracks.monochrome.st' && url.pathname === '/search/tracks') return send(200, fixture('monochrome-search.json'));
    if (host === 'tracks.monochrome.st' && url.pathname.startsWith('/track/')) {
      const range = /bytes=(\d+)-(\d*)/.exec(String(req.headers.range ?? ''));
      if (!range) return send(200, audio, 'audio/flac', { 'Accept-Ranges': 'bytes' });
      const from = Number(range[1]); const to = range[2] ? Number(range[2]) : audio.length - 1;
      return send(206, audio.subarray(from, to + 1), 'audio/flac', { 'Content-Range': `bytes ${from}-${to}/${audio.length}` });
    }
    if (url.pathname === '/v1/me/storefront') return send(200, JSON.stringify({ data: [{ id: 'us', attributes: { name: 'United States' } }] }));
    if (url.pathname.includes('/search')) return send(200, fixture('apple-search.json'));
    if (url.pathname.endsWith('/webPlayback')) return send(200, JSON.stringify({ songList: [{ assets: [{ flavor: '28:ctrp256', URL: 'https://aod.itunes.apple.com/a/b/P123.m3u8' }] }] }));
    if (host === 'aod.itunes.apple.com' && url.pathname.endsWith('.m3u8')) return send(200, playlist, 'application/vnd.apple.mpegurl');
    if (host === 'aod.itunes.apple.com') return send(200, 'SEGMENT:' + url.pathname, 'audio/mp4');
    if (url.pathname.endsWith('/acquireWebPlaybackLicense')) return send(200, JSON.stringify({ status: 0, license: Buffer.from('LICENSE').toString('base64') }));
    return send(404, '');
  });
  servers.push(upstream);
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const requester = (url: string, options: { method?: string; headers?: Record<string, string>; body?: string }) => new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = httpRequest({ hostname: '127.0.0.1', port: (upstream.address() as { port: number }).port, path: target.pathname + target.search, method: options.method ?? 'GET', headers: { ...options.headers, 'x-test-host': target.hostname } }, resolve);
    req.on('error', reject); req.end(options.body);
  });
  const { startRuntime } = require('../service/runtime.cjs');
  const runtime = await startRuntime({ request: requester, sourceDir: false, transferOptions: { bindHost: '127.0.0.1', advertiseHost: '192.168.1.20' } });
  servers.push(runtime.server);
  const api = (path: string, body?: unknown, init: RequestInit = {}) => fetch(runtime.baseUrl + path, { ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), ...init });
  return { runtime, api, seen };
}
const eastside = { title: 'Eastside', artists: ['benny blanco', 'Halsey', 'Khalid'], durationMs: 173_000 };

describe('sources through the service', () => {
  it('Monochrome: resolve, then the audio plays from a relay with byte ranges and HEAD; nothing upstream leaks', async () => {
    const { api, seen } = await start();
    const out = await (await api('/api/sources/resolve', { provider: 'monochrome', track: eastside })).json();
    expect(out).toMatchObject({ result: 'found', stream: { format: 'progressive', codec: 'FLAC' } });
    expect(JSON.stringify(out)).not.toMatch(/monochrome\.st/);
    const path = out.stream.path as string;
    const full = await api(path);
    expect(full.status).toBe(200);
    expect(Buffer.from(await full.arrayBuffer()).equals(audio)).toBe(true);
    const part = await api(path, undefined, { headers: { Range: 'bytes=4-9' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 4-9/${audio.length}`);
    expect(Buffer.from(await part.arrayBuffer()).toString('latin1')).toBe(audio.subarray(4, 10).toString('latin1'));
    expect((await api(path, undefined, { method: 'HEAD' })).status).toBe(200);
    expect((await api(path, undefined, { headers: { Range: 'bytes=abc' } })).status).toBe(416);
    expect((await api(path, {})).status).toBe(405);
    expect((await api('/api/source/media/ffffffff')).status).toBe(410);
    expect(seen.every((s) => s.host === 'tracks.monochrome.st')).toBe(true);
  });

  it('the first bytes are read as bytes, not text: the FLAC check sees a real header', async () => {
    const { api } = await start();
    const out = await (await api('/api/sources/resolve', { provider: 'monochrome', track: eastside })).json();
    expect(out.stream.sampleRateHz).toBe(44100);
  });

  it('refuses everything that is not a known action, provider or body, and needs the session token and origin', async () => {
    const { api, runtime } = await start();
    expect((await api('/api/sources/other', {})).status).toBe(404);
    expect((await api('/api/sources/resolve', {})).status).toBe(400);
    expect((await api('/api/sources/resolve', { provider: 'spotify', track: { title: 'x' } })).status).toBe(404);
    expect((await api('/api/sources/resolve', { provider: 'monochrome', track: { title: '' } })).status).toBe(400);
    expect((await api('/api/sources/resolve', { provider: 'monochrome', track: eastside }, { headers: { Origin: 'https://evil.test' } })).status).toBe(403);
    expect((await fetch(runtime.origin + '/api/sources/status')).status).toBe(403);
    expect((await api('/api/sources/status', undefined, { method: 'POST' })).status).toBe(405);
  });

  it('status lists both sources with no secret, signed out', async () => {
    const { api } = await start();
    const status = await (await api('/api/sources/status')).json();
    expect(status.modules.map((m: { id: string; account: { state: string } }) => [m.id, m.account.state])).toEqual([['monochrome', 'ready'], ['applemusic', 'signedOut']]);
  });
});

describe('Apple Music through the service, with a session sent from the phone', () => {
  async function pairSession(userToken = 'U'.repeat(40)) {
    const ctx = await start();
    const started = await (await ctx.api('/api/transfer/start', {})).json();
    const phone = new FakePhone(parseQr(started.qr));
    await phone.hello();
    const data = Buffer.from(JSON.stringify({ userToken, developerToken: devToken }));
    const last = await phone.sendPayload('applemusic-session' as never, data);
    return { ...ctx, last };
  }

  it('the session is accepted by the service, never offered to the screen, and then the account verifies', async () => {
    const { api, last } = await pairSession();
    expect(last.status).toBe(200);
    const status = await (await api('/api/transfer/status')).json();
    expect(status).toMatchObject({ phase: 'received', kind: 'applemusic-session', private: true });
    expect((await api('/api/transfer/payload')).status).toBe(404);
    expect(JSON.stringify(status)).not.toMatch(/UUUU|eyJ/);
    expect((await (await api('/api/sources/status')).json()).modules[1].account.state).toBe('signedIn');
    expect(await (await api('/api/sources/verify', { provider: 'applemusic' })).json()).toMatchObject({ state: 'signedIn', label: 'Terhubung · us' });
  });

  it('a session that is not valid is refused, and the phone is told', async () => {
    const { last, api } = await pairSession('short');
    expect(last.status).toBe(422);
    expect((await (await api('/api/sources/status')).json()).modules[1].account.state).toBe('signedOut');
  });

  it('resolve returns an HLS manifest whose files and license go through the service', async () => {
    const { api, seen } = await pairSession();
    const out = await (await api('/api/sources/resolve', { provider: 'applemusic', track: { title: 'Espresso', artists: ['Sabrina Carpenter'], durationMs: 175_000 } })).json();
    expect(out).toMatchObject({ result: 'found', stream: { format: 'hls', codec: 'AAC', drm: { system: 'com.widevine.alpha' } } });
    expect(JSON.stringify(out)).not.toMatch(/UUUU|eyJhbGci|itunes\.apple/);
    const manifest = await (await api(out.stream.path)).text();
    expect(manifest).toContain('#EXT-X-KEY:METHOD=SAMPLE-AES,URI="data:text/plain;base64,');
    const files = [...manifest.matchAll(/\/api\/source\/media\/[a-z0-9]+/g)].map((m) => m[0]);
    expect(files).toHaveLength(2);
    expect(await (await api(files[1])).text()).toBe('SEGMENT:/a/b/seg1.mp4');
    const challenge = Buffer.concat([Buffer.from('chal'), Buffer.from('112233445566778899aabbccddeeff00', 'hex')]);
    const license = await fetch((await api('/api/sources/status')).url.replace('/api/sources/status', out.stream.drm.licensePath), { method: 'POST', body: challenge });
    expect(license.status).toBe(200);
    expect(await license.text()).toBe('LICENSE');
    const licenseCall = seen.find((s) => s.path.endsWith('acquireWebPlaybackLicense'))!;
    expect(licenseCall.headers['media-user-token']).toBe('U'.repeat(40));
  });

  it('license failures carry the kind, so the player can tell an account problem from a license one', async () => {
    const { api } = await pairSession();
    const out = await (await api('/api/sources/resolve', { provider: 'applemusic', track: { title: 'Espresso', artists: ['Sabrina Carpenter'], durationMs: 175_000 } })).json();
    const base = (await api('/api/sources/status')).url.replace('/api/sources/status', '');
    const bad = await fetch(base + out.stream.drm.licensePath, { method: 'POST', body: Buffer.from('xy') });
    expect(bad.status).toBe(400);
    expect(bad.headers.get('x-source-error')).toBe('license');
    const unknown = await fetch(base + '/api/source/license/ffffffff', { method: 'POST', body: Buffer.from('abcdefgh') });
    expect(unknown.status).toBe(410);
    expect((await fetch(base + out.stream.drm.licensePath)).status).toBe(405);
  });

  it('sign-out forgets the session, and a new resolve says the account is the problem', async () => {
    const { api } = await pairSession();
    expect(await (await api('/api/sources/signout', { provider: 'applemusic' })).json()).toMatchObject({ state: 'signedOut' });
    const out = await (await api('/api/sources/resolve', { provider: 'applemusic', track: { title: 'Espresso', artists: ['Sabrina Carpenter'] } })).json();
    expect(out).toMatchObject({ result: 'unavailable', kind: 'auth' });
  });
});
