import { createServer, request as httpRequest, type Server } from 'node:http';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { createScrobbler, loadKeys, sign, allowedScrobbleUrl, cleanTrack } = require('../service/scrobble.cjs');
const { createMemoryStorage } = require('../service/sources.cjs');

const KEYS = { lastfm: { key: 'KEY1', secret: 'SECRET1' }, librefm: { key: 'KEY2', secret: 'SECRET2' } };
type Call = { url: string; params: Record<string, string> };
/** A stand-in for the two services: answers by method and records what was sent. */
function fake(answer: (call: Call) => unknown = () => ({})) {
  const calls: Call[] = [];
  const http = async (url: string, init: { body: string }) => {
    const params = Object.fromEntries(new URLSearchParams(init.body));
    const call = { url, params };
    calls.push(call);
    const result = answer(call);
    if (result instanceof Error) throw result;
    const status = (result as { __status?: number }).__status ?? 200;
    return { status, body: typeof result === 'string' ? result : JSON.stringify(result) };
  };
  return { http, calls };
}
const make = (f: ReturnType<typeof fake>, extra: object = {}) => {
  const storage = createMemoryStorage();
  const timers: Array<() => void> = [];
  const scrobbler = createScrobbler({ http: f.http, storage, keys: KEYS, now: () => 1_700_000_000_000, setTimer: (fn: () => void) => { timers.push(fn); return { unref() {} }; }, ...extra });
  return { scrobbler, storage, timers };
};
const signIn = async (s: ReturnType<typeof make>, site = 'lastfm') => { await s.scrobbler.begin(site); await s.scrobbler.finish(site); };
const answerAuth = (call: Call) => call.params.method === 'auth.getToken' ? { token: 'TOK' } : call.params.method === 'auth.getSession' ? { session: { name: 'rina', key: 'SESSIONKEY' } } : {};
const TRACK = { artist: 'Senja', track: 'Lagu Satu', album: 'Album', durationSeconds: 200 };

describe('signing', () => {
  it('signs calls the way the API asks (sorted names, secret, MD5, format left out)', () => {
    const expected = crypto.createHash('md5').update('api_keyKmethodauth.getTokenS').digest('hex');
    expect(sign({ method: 'auth.getToken', api_key: 'K' }, 'S')).toBe(expected);
    const f = fake(answerAuth);
    return make(f).scrobbler.begin('lastfm').then(() => {
      const { params } = f.calls[0];
      expect(params.format).toBe('json');
      expect(params.api_sig).toBe(sign({ method: 'auth.getToken', api_key: 'KEY1' }, 'SECRET1'));
    });
  });
  it('only talks to the two fixed endpoints', () => {
    expect(allowedScrobbleUrl('https://ws.audioscrobbler.com/2.0/')).toBe(true);
    expect(allowedScrobbleUrl('https://libre.fm/2.0/')).toBe(true);
    expect(allowedScrobbleUrl('http://libre.fm/2.0/')).toBe(false);
    expect(allowedScrobbleUrl('https://libre.fm.evil.test/2.0/')).toBe(false);
    expect(allowedScrobbleUrl('https://libre.fm/other')).toBe(false);
  });
});

describe('sign-in', () => {
  it('gives the page to open, waits until allowed, then keeps only the session in the service', async () => {
    let allowed = false;
    const f = fake((call) => call.params.method === 'auth.getSession' && !allowed ? { error: 14, message: 'Unauthorized Token' } : answerAuth(call));
    const s = make(f);
    const { authUrl } = await s.scrobbler.begin('lastfm');
    expect(authUrl).toBe('https://www.last.fm/api/auth/?api_key=KEY1&token=TOK');
    expect(await s.scrobbler.finish('lastfm')).toEqual({ state: 'waiting' });
    allowed = true;
    expect(await s.scrobbler.finish('lastfm')).toEqual({ state: 'signedIn', username: 'rina' });
    const status = s.scrobbler.status();
    expect(status.sites[0]).toMatchObject({ id: 'lastfm', signedIn: true, username: 'rina', enabled: true, profileUrl: 'https://www.last.fm/user/rina' });
    expect(JSON.stringify(status)).not.toMatch(/SESSIONKEY|SECRET|KEY1/);
    expect(s.storage.get('scrobble.state')).toContain('SESSIONKEY');              // survives a restart
    const again = createScrobbler({ http: f.http, storage: s.storage, keys: KEYS });
    expect(again.status().sites[0].signedIn).toBe(true);
  });
  it('says so when the token ran out, when a site has no keys, and for unknown sites', async () => {
    const f = fake((call) => call.params.method === 'auth.getSession' ? { error: 15, message: 'Token expired' } : answerAuth(call));
    const s = make(f);
    await s.scrobbler.begin('lastfm');
    expect(await s.scrobbler.finish('lastfm')).toEqual({ state: 'expired' });
    await expect(s.scrobbler.finish('lastfm')).rejects.toMatchObject({ kind: 'badRequest' });
    const none = createScrobbler({ http: f.http, storage: createMemoryStorage(), keys: {} });
    expect(none.status().sites.every((site: { configured: boolean }) => !site.configured)).toBe(true);
    await expect(none.begin('lastfm')).rejects.toMatchObject({ kind: 'notConfigured', status: 503 });
    await expect(none.begin('nope')).rejects.toMatchObject({ kind: 'badRequest' });
  });
  it('signing out forgets the account and what was waiting for it', async () => {
    const f = fake((call) => (call.params.method === 'track.scrobble' ? { error: 11, message: 'down' } : answerAuth(call)));
    const s = make(f);
    await signIn(s);
    s.scrobbler.scrobble(TRACK, 1_699_999_000);
    await s.scrobbler.flush();
    expect(s.scrobbler.status().pending).toBe(1);
    s.scrobbler.signOut('lastfm');
    expect(s.scrobbler.status()).toMatchObject({ pending: 0, sites: [{ signedIn: false }, { signedIn: false }] });
    expect(s.storage.get('scrobble.state')).not.toContain('SESSIONKEY');
  });
});

describe('scrobbling', () => {
  it('sends a play with its start time, and Now Playing straight out without queueing', async () => {
    const f = fake(answerAuth);
    const s = make(f);
    await signIn(s);
    await s.scrobbler.nowPlaying(TRACK);
    const np = f.calls.find((c) => c.params.method === 'track.updateNowPlaying')!;
    expect(np.params).toMatchObject({ artist: 'Senja', track: 'Lagu Satu', album: 'Album', duration: '200', sk: 'SESSIONKEY' });
    expect(s.scrobbler.status().pending).toBe(0);
    s.scrobbler.scrobble(TRACK, 1_699_999_000);
    await s.scrobbler.flush();
    const sent = f.calls.find((c) => c.params.method === 'track.scrobble')!;
    expect(sent.params).toMatchObject({ 'artist[0]': 'Senja', 'track[0]': 'Lagu Satu', 'timestamp[0]': '1699999000', 'duration[0]': '200' });
    expect(s.scrobbler.status().pending).toBe(0);
  });
  it('keeps plays while offline, sends them in batches of 50 once back, and retries on a timer', async () => {
    let online = false;
    const f = fake((call) => (call.params.method === 'track.scrobble' && !online ? new Error('offline') : answerAuth(call)));
    const s = make(f);
    await signIn(s);
    for (let i = 0; i < 120; i += 1) s.scrobbler.scrobble({ ...TRACK, track: `L${i}` }, 1_699_990_000 + i);
    await s.scrobbler.flush();
    expect(s.scrobbler.status().pending).toBe(120);
    expect(s.timers.length).toBeGreaterThan(0);
    online = true;
    await s.timers[0]?.();
    await s.scrobbler.flush();
    expect(s.scrobbler.status().pending).toBe(0);
    const batches = f.calls.filter((c) => c.params.method === 'track.scrobble' && online && c.params['track[0]']).map((c) => Object.keys(c.params).filter((k) => k.startsWith('track[')).length);
    expect(batches.filter((n) => n === 50).length).toBeGreaterThanOrEqual(2);
  });
  it('a service being down does not hold back the other one; a paused one still gets older plays', async () => {
    const f = fake((call) => (call.params.method === 'track.scrobble' && call.params.api_key === 'KEY2' ? { error: 11, message: 'down' } : answerAuth(call)));
    const s = make(f);
    await signIn(s, 'lastfm'); await signIn(s, 'librefm');
    s.scrobbler.scrobble(TRACK, 1_699_999_000);
    await s.scrobbler.flush();
    expect(s.scrobbler.status().pending).toBe(1);                                  // still waiting for Libre.fm only
    s.scrobbler.setEnabled('librefm', false);
    s.scrobbler.scrobble({ ...TRACK, track: 'Baru' }, 1_699_999_100);              // paused: not queued for it
    await s.scrobbler.flush();
    const forLibre = f.calls.filter((c) => c.params.method === 'track.scrobble' && c.params.api_key === 'KEY2');
    expect(forLibre.length).toBeGreaterThanOrEqual(2);                              // the old play was still tried
    expect(forLibre.every((c) => !JSON.stringify(c.params).includes('Baru'))).toBe(true);
  });
  it('drops what the service turns down for good, forgets an account that took access back, and drops plays older than two weeks', async () => {
    const f = fake((call) => (call.params.method === 'track.scrobble' && call.params['track[0]'] === 'Rusak' ? { error: 6, message: 'bad' } : answerAuth(call)));
    const s = make(f);
    await signIn(s);
    s.scrobbler.scrobble({ ...TRACK, track: 'Rusak' }, 1_699_999_000);
    s.scrobbler.scrobble({ ...TRACK, track: 'Sehat' }, 1_699_999_100);
    s.scrobbler.scrobble({ ...TRACK, track: 'Tua' }, 1_700_000_000 - 15 * 24 * 3600);
    await s.scrobbler.flush();
    expect(s.scrobbler.status().pending).toBe(0);
    const all = f.calls.filter((c) => c.params.method === 'track.scrobble').map((c) => JSON.stringify(c.params));
    expect(all.some((x) => x.includes('Tua'))).toBe(false);
    const revoked = fake((call) => (call.params.method === 'track.scrobble' ? { error: 9, message: 'Invalid session' } : answerAuth(call)));
    const r = make(revoked);
    await signIn(r);
    r.scrobbler.scrobble(TRACK, 1_699_999_000);
    await r.scrobbler.flush();
    expect(r.scrobbler.status().sites[0].signedIn).toBe(false);
  });
  it('sends likes as loves and rejects invalid plays', async () => {
    const f = fake(answerAuth);
    const s = make(f);
    await signIn(s);
    await s.scrobbler.love('Senja', 'Lagu Satu', true);
    await s.scrobbler.love('Senja', 'Lagu Satu', false);
    expect(f.calls.filter((c) => /track\.(un)?love/.test(c.params.method)).map((c) => c.params.method)).toEqual(['track.love', 'track.unlove']);
    expect(() => s.scrobbler.scrobble({ artist: '', track: 'x' }, 1_699_999_000)).toThrow();
    expect(() => s.scrobbler.scrobble(TRACK, 5_000_000_000)).toThrow();
    expect(cleanTrack({ artist: ' A ', track: 'T', durationSeconds: 'x' })).toEqual({ artist: 'A', track: 'T' });
  });
  it('sends what was left over from the last run as soon as it starts', async () => {
    const f = fake(answerAuth);
    const s = make(f);
    await signIn(s);
    const down = fake((call) => (call.params.method === 'track.scrobble' ? new Error('offline') : answerAuth(call)));
    const first = createScrobbler({ http: down.http, storage: s.storage, keys: KEYS, now: () => 1_700_000_000_000, setTimer: () => ({ unref() {} }) });
    first.scrobble(TRACK, 1_699_999_000);
    await first.flush();
    expect(first.status().pending).toBe(1);
    const second = createScrobbler({ http: f.http, storage: s.storage, keys: KEYS, now: () => 1_700_000_000_000 });
    await second.flush();
    expect(second.status().pending).toBe(0);
  });
});

describe('keys', () => {
  it('come from the environment or a file, and a site needs both parts', () => {
    expect(loadKeys({ MUSICFY_LASTFM_API_KEY: 'a', MUSICFY_LASTFM_SECRET: 'b' }, () => { throw new Error('none'); })).toEqual({ lastfm: { key: 'a', secret: 'b' } });
    expect(loadKeys({}, () => JSON.stringify({ librefm: { key: 'x', secret: 'y' }, lastfm: { key: 'only' } }))).toEqual({ librefm: { key: 'x', secret: 'y' } });
    expect(loadKeys({}, () => 'not json')).toEqual({});
  });
});

describe('/api/scrobble routes', () => {
  let servers: Server[] = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => { s.closeAllConnections(); s.close(() => resolve()); }))); });
  it('answers through the service, refuses wrong methods and other origins, and never returns secrets', async () => {
    const { startRuntime } = require('../service/runtime.cjs');
    const upstream = createServer((req, res) => {
      let body = ''; req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const p = new URLSearchParams(body); res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(p.get('method') === 'auth.getToken' ? { token: 'TOK' } : p.get('method') === 'auth.getSession' ? { session: { name: 'rina', key: 'SESSIONKEY' } } : {}));
      });
    });
    servers.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const seen: string[] = [];
    const requester = (url: string, init: { body?: string; method?: string }) => new Promise((resolve, reject) => {
      const target = new URL(url); seen.push(target.hostname + target.pathname);
      const req = httpRequest({ hostname: '127.0.0.1', port: (upstream.address() as { port: number }).port, path: target.pathname, method: init.method ?? 'GET' }, resolve);
      req.on('error', reject); req.end(init.body);
    });
    const runtime = await startRuntime({ request: requester, sourceDir: false, scrobbleKeys: KEYS });
    servers.push(runtime.server);
    const url = (a: string) => `${runtime.baseUrl}/api/scrobble/${a}`;
    const post = (a: string, body: unknown = {}, headers: Record<string, string> = {}) => fetch(url(a), { method: 'POST', headers, body: JSON.stringify(body) });
    expect((await (await fetch(url('status'))).json()).sites[0]).toMatchObject({ id: 'lastfm', configured: true, signedIn: false });
    const begin = await (await post('begin', { site: 'lastfm' })).json();
    expect(begin.authUrl).toContain('token=TOK');
    expect(await (await post('finish', { site: 'lastfm' })).json()).toEqual({ state: 'signedIn', username: 'rina' });
    expect((await post('scrobble', { track: TRACK, startedAt: Math.floor(Date.now() / 1000) - 100 })).status).toBe(200);
    const text = await (await fetch(url('status'))).text();
    expect(text).not.toMatch(/SESSIONKEY|SECRET1|KEY1/);
    expect(seen.every((s) => s === 'ws.audioscrobbler.com/2.0/')).toBe(true);
    expect((await fetch(url('status'), { method: 'POST' })).status).toBe(405);
    expect((await fetch(url('begin'))).status).toBe(405);
    expect((await fetch(url('nope'))).status).toBe(404);
    expect((await post('begin', { site: 'x' })).status).toBe(400);
    expect((await post('scrobble', { track: { artist: '' }, startedAt: 1 })).status).toBe(400);
    expect((await fetch(url('begin'), { method: 'POST', body: '{' })).status).toBe(400);
    expect((await post('begin', { site: 'lastfm' }, { Origin: 'https://evil.test' })).status).toBe(403);
  });
});
