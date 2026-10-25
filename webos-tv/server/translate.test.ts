import { createServer, request as httpRequest, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { translateLines, allowedTranslateUrl } = require('../service/translate.cjs');

const reply = (text: string) => ({ status: 200, body: JSON.stringify([[[text, 'orig', null, null, 1]], null, 'en']) });
/** Echoes each line as "<tl>:<line>" the way the real endpoint returns it: pieces concatenated, markers intact. */
const echo = (calls: string[] = []) => async (url: string) => {
  calls.push(url);
  const u = new URL(url);
  const lines = (u.searchParams.get('q') ?? '').split('\n@@@\n');
  return reply(lines.map((line) => `${u.searchParams.get('tl')}:${line}`).join('\n@@@\n'));
};

describe('translateLines', () => {
  it('translates in one request, one-for-one, in order', async () => {
    const calls: string[] = [];
    const result = await translateLines({ lines: ['halo', '', 'dunia'], target: 'en' }, echo(calls));
    expect(result.lines).toEqual(['en:halo', 'en:', 'en:dunia']);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('client=gtx');
    expect(calls[0]).toContain('sl=auto');
  });

  it('splits long lyrics into batches that stay under the character budget', async () => {
    const calls: string[] = [];
    const lines = Array.from({ length: 30 }, (_, i) => `baris nomor ${i} `.repeat(8));
    const result = await translateLines({ lines, target: 'id', source: 'en' }, echo(calls));
    expect(result.lines).toHaveLength(30);
    expect(calls.length).toBeGreaterThan(1);
    for (const call of calls) expect(new URL(call).searchParams.get('q')!.length).toBeLessThan(1700);
  });

  it('asks line by line when a batch comes back with mangled markers, and keeps the order', async () => {
    let first = true;
    const upstream = async (url: string) => {
      const q = new URL(url).searchParams.get('q')!;
      if (q.includes('@@@') && first) { first = false; return reply('satu dua tiga'); }
      return reply(`T(${q})`);
    };
    const result = await translateLines({ lines: ['a', 'b', 'c'], target: 'en' }, upstream);
    expect(result.lines).toEqual(['T(a)', 'T(b)', 'T(c)']);
  });

  it('a line that keeps failing keeps its own text; all failing is an error, never a misaligned answer', async () => {
    const partial = async (url: string) => {
      const q = new URL(url).searchParams.get('q')!;
      if (q.includes('@@@')) return reply('x');
      return q === 'b' ? { status: 500, body: '' } : reply(`T(${q})`);
    };
    expect((await translateLines({ lines: ['a', 'b'], target: 'en' }, partial)).lines).toEqual(['T(a)', 'b']);
    await expect(translateLines({ lines: ['a', 'b'], target: 'en' }, async () => ({ status: 500, body: '' }))).rejects.toMatchObject({ name: 'TranslateError', status: 502 });
    await expect(translateLines({ lines: ['a'], target: 'en' }, async () => ({ status: 200, body: 'not json' }))).rejects.toMatchObject({ status: 502 });
  });

  it('reports rate limiting as 429', async () => {
    await expect(translateLines({ lines: ['a'], target: 'en' }, async () => ({ status: 429, body: '' }))).rejects.toMatchObject({ status: 429 });
  });

  it('validates what it is given before asking anyone', async () => {
    const never = async () => { throw new Error('should not be called'); };
    for (const bad of [
      null, {}, { lines: [], target: 'en' }, { lines: ['a'], target: 'auto' }, { lines: ['a'], target: 'EN!' }, { lines: ['a'], target: 'en', source: '../x' },
      { lines: [1], target: 'en' }, { lines: ['x'.repeat(501)], target: 'en' }, { lines: Array(401).fill('a'), target: 'en' },
    ]) await expect(translateLines(bad, never)).rejects.toMatchObject({ name: 'TranslateError', status: 400 });
  });

  it('only ever talks to the translate endpoint', () => {
    expect(allowedTranslateUrl('https://translate.googleapis.com/translate_a/single?client=gtx')).toBe(true);
    for (const url of ['http://translate.googleapis.com/translate_a/single', 'https://evil.test/translate_a/single', 'https://translate.googleapis.com/other', 'https://u:p@translate.googleapis.com/translate_a/single', 'https://translate.googleapis.com:8443/translate_a/single', 'nonsense'])
      expect(allowedTranslateUrl(url)).toBe(false);
  });
});

describe('POST /api/translate', () => {
  let servers: Server[] = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => { s.closeAllConnections(); s.close(() => resolve()); }))); });

  async function start(upstream: Server) {
    const { startRuntime } = require('../service/runtime.cjs');
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
    return { runtime, seen };
  }

  it('answers through the service and refuses wrong methods, big bodies and other origins', async () => {
    const upstream = createServer((req, res) => {
      const q = new URL(req.url!, 'http://x').searchParams.get('q')!;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify([[[q.split('\n@@@\n').map((line) => line.toUpperCase()).join('\n@@@\n'), 'o']]]));
    });
    const { runtime, seen } = await start(upstream);
    const ok = await fetch(`${runtime.baseUrl}/api/translate`, { method: 'POST', body: JSON.stringify({ lines: ['halo', 'dunia'], target: 'en' }) });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ lines: ['HALO', 'DUNIA'] });
    expect(seen).toEqual(['translate.googleapis.com/translate_a/single']);
    expect((await fetch(`${runtime.baseUrl}/api/translate`)).status).toBe(405);
    expect((await fetch(`${runtime.baseUrl}/api/translate`, { method: 'POST', body: 'x'.repeat(70000) })).status).toBe(413);
    expect((await fetch(`${runtime.baseUrl}/api/translate`, { method: 'POST', body: '{', })).status).toBe(400);
    const bad = await fetch(`${runtime.baseUrl}/api/translate`, { method: 'POST', body: JSON.stringify({ lines: [], target: 'en' }) });
    expect(bad.status).toBe(400);
    expect((await fetch(`${runtime.baseUrl}/api/translate`, { method: 'POST', headers: { Origin: 'https://evil.test' }, body: '{}' })).status).toBe(403);
  });

  it('turns an upstream failure into a clear error, not a success', async () => {
    const upstream = createServer((req, res) => { res.statusCode = 503; res.end('down'); });
    const { runtime } = await start(upstream);
    const response = await fetch(`${runtime.baseUrl}/api/translate`, { method: 'POST', body: JSON.stringify({ lines: ['halo'], target: 'en' }) });
    expect(response.status).toBe(502);
    expect((await response.json()).error).toMatch(/gagal/i);
  });
});
