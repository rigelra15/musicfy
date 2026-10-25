import { describe, expect, it, vi } from 'vitest';
import { CatalogRequestError, createCatalogGateway, createLatestGuard } from './gateway';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fetcherReturning = (...responses: Array<Response | Error>) => {
  const calls: Array<{ url: string; body: any }> = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (next instanceof Error) throw next;
    return next.clone();
  });
  return { fetcher, calls };
};

describe('catalog gateway', () => {
  it('posts each operation to /api/catalog and passes the locale', async () => {
    const { fetcher, calls } = fetcherReturning(json(200, { sections: [], items: [], filter: 'songs', skipped: 0 }));
    const gateway = createCatalogGateway({ fetch: fetcher, locale: { hl: 'id', gl: 'ID' } });
    await gateway.search('yellow', 'songs');
    expect(calls[0]).toEqual({ url: '/api/catalog/search', body: { query: 'yellow', filter: 'songs', locale: { hl: 'id', gl: 'ID' } } });
  });

  it('prefixes playlist ids with VL and checks the page type', async () => {
    const { fetcher, calls } = fetcherReturning(json(200, { type: 'playlist', header: {}, tracks: [], related: [], skipped: 0 }));
    const gateway = createCatalogGateway({ fetch: fetcher });
    await gateway.playlist('PLabc');
    await gateway.playlist('VLPLabc');
    expect(calls.map((c) => c.body.browseId)).toEqual(['VLPLabc', 'VLPLabc']);
    await expect(gateway.album('MPREb_x')).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('sends a continuation reference for more()', async () => {
    const { fetcher, calls } = fetcherReturning(json(200, { items: [], sections: [], skipped: 0 }));
    await createCatalogGateway({ fetch: fetcher }).more('search', { token: 'abc' });
    expect(calls[0]).toMatchObject({ url: '/api/catalog/search', body: { continuation: { token: 'abc' } } });
  });

  it.each([
    [json(429, { error: 'tunggu', kind: 'rate-limited' }), 'rate-limited', true],
    [json(400, { error: 'salah', kind: 'bad-request' }), 'bad-request', false],
    [json(502, { error: 'rusak', kind: 'invalid-response' }), 'invalid-response', true],
    [json(504, {}), 'upstream-http', true],
    [json(429, {}), 'rate-limited', true],
    [new Response('<html>', { status: 200 }), 'invalid-response', true],
    [new Error('Failed to fetch'), 'network', true],
  ])('maps failure %# to %s (retryable=%s)', async (reply, kind, retryable) => {
    const { fetcher } = fetcherReturning(reply as Response | Error);
    const error = await createCatalogGateway({ fetch: fetcher }).home().catch((e) => e);
    expect(error).toBeInstanceOf(CatalogRequestError);
    expect(error.kind).toBe(kind);
    expect(error.retryable).toBe(retryable);
  });

  it('reports aborts as aborted rather than a network failure', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn(async () => { throw new DOMException('x', 'AbortError'); });
    await expect(createCatalogGateway({ fetch: fetcher }).home({ signal: controller.signal })).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe('latest guard', () => {
  it('drops an older response that resolves after a newer request', async () => {
    const guard = createLatestGuard();
    let releaseSlow!: (value: string) => void;
    const slow = guard.run('search', () => new Promise<string>((resolve) => { releaseSlow = resolve; }));
    const fast = guard.run('search', async () => 'fast');
    await expect(fast).resolves.toBe('fast');
    releaseSlow('slow');
    await expect(slow).rejects.toMatchObject({ kind: 'stale' });
  });
  it('does not mix scopes', async () => {
    const guard = createLatestGuard();
    const a = guard.run('a', async () => 1);
    const b = guard.run('b', async () => 2);
    await expect(Promise.all([a, b])).resolves.toEqual([1, 2]);
  });
});
