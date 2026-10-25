import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { FakePhone, parseQr } from './transferClient';
const require = createRequire(import.meta.url);
const t = require('../service/transfer.cjs');

const managers: Array<{ dispose(): void }> = [];
afterEach(() => { for (const manager of managers.splice(0)) manager.dispose(); });
function make(options: Record<string, unknown> = {}) {
  const manager = t.createTransferManager({ bindHost: '127.0.0.1', advertiseHost: '192.168.1.20', ...options });
  managers.push(manager);
  return manager;
}
async function pair(options: Record<string, unknown> = {}) {
  const manager = make(options);
  const started = await manager.start({ deviceName: 'Ruang Tamu' });
  const info = parseQr(started.qr);
  return { manager, started, info, phone: new FakePhone(info) };
}
const json = (value: unknown) => Buffer.from(JSON.stringify(value));

describe('pairing', () => {
  it('the QR carries the address, a one-time session id, a pairing secret and the TV key', async () => {
    const { started, info } = await pair();
    expect(started.qr.startsWith('musicfy://pair?v=1&')).toBe(true);
    expect(info.host).toBe('192.168.1.20');
    expect(info.tvPub.length).toBe(65);
    expect(info.secret.length).toBe(16);
    expect(info.name).toBe('Ruang Tamu');
    expect(started.expiresAt - Date.now()).toBeGreaterThan(4 * 60_000);
    expect(started.expiresAt - Date.now()).toBeLessThanOrEqual(5 * 60_000);
  });

  it('a phone that scanned the code pairs, and the TV proves it holds the secret too', async () => {
    const { phone, manager } = await pair();
    const reply = await phone.hello();
    expect(reply.status).toBe(200);
    expect(reply.body.chunkBytes).toBe(256 * 1024);
    expect(manager.status().phase).toBe('paired');
  });

  it('a wrong pairing code is refused, counted, and five of them end the session', async () => {
    const { phone, manager } = await pair();
    for (let i = 0; i < 4; i += 1) expect((await phone.hello({ secret: randomBytes(16) })).status).toBe(403);
    expect(manager.status().phase).toBe('waiting');
    expect((await phone.hello({ secret: randomBytes(16) })).status).toBe(403);
    expect(manager.status()).toMatchObject({ phase: 'failed' });
    await expect(phone.hello()).rejects.toThrow();                         // the listener is gone
  });

  it('only one phone can pair, and another session id is not found', async () => {
    const { phone, info } = await pair();
    expect((await phone.hello()).status).toBe(200);
    expect((await new FakePhone(info).hello()).status).toBe(409);
    expect((await phone.post('hello', {}, 'other-session')).status).toBe(404);
    const wrong = await fetch(`${phone.origin}/x/y`, { method: 'POST', body: '{}' });
    expect(wrong.status).toBe(404);
    const get = await fetch(`${phone.origin}/t/${info.sid}/hello`);
    expect(get.status).toBe(405);
  });

  it('refuses a malformed key and malformed JSON', async () => {
    const { phone, info } = await pair();
    expect((await phone.post('hello', { pub: 'AAAA', proof: 'AAAA' })).status).toBe(400);
    const raw = await fetch(`${phone.origin}/t/${info.sid}/hello`, { method: 'POST', body: '{nope' });
    expect(raw.status).toBe(400);
  });

  it('a second session cannot start while one is open', async () => {
    const { manager } = await pair();
    await expect(manager.start()).rejects.toMatchObject({ name: 'TransferError', status: 409 });
  });

  it('says so when the TV has no network address', async () => {
    const manager = t.createTransferManager({ bindHost: '127.0.0.1', networkInterfaces: () => ({ lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }] }) });
    managers.push(manager);
    await expect(manager.start()).rejects.toMatchObject({ status: 503 });
  });
});

describe('sending', () => {
  const payload = (size: number) => Buffer.from(JSON.stringify({ pad: 'x'.repeat(size) }));

  it('delivers a payload in chunks, verified, and hands it over once', async () => {
    const { phone, manager } = await pair();
    await phone.hello();
    const data = payload(700_000);                                             // three chunks
    const last = await phone.sendPayload('portable', data);
    expect(last.body.done).toBe(true);
    expect(manager.status()).toMatchObject({ phase: 'received', kind: 'portable', device: 'Pixel (test)', receivedBytes: data.length });
    const taken = manager.takePayload();
    expect(taken).toMatchObject({ kind: 'portable', device: 'Pixel (test)' });
    expect(taken.text).toBe(data.toString('utf8'));
    expect(() => manager.takePayload()).toThrow(/Belum ada data/);
    expect(manager.status().phase).toBe('idle');
  });

  it('closes the listener when it is done', async () => {
    const { phone } = await pair();
    await phone.hello();
    await phone.sendPayload('csv', payload(100));
    await expect(phone.send(Buffer.from('x'))).rejects.toThrow();
  });

  it('reports progress while receiving', async () => {
    const { phone, manager } = await pair();
    await phone.hello();
    const data = payload(600_000);
    await phone.send(json({ type: 'header', kind: 'portable', name: 'a', device: 'P', size: data.length, chunks: Math.ceil(data.length / (256 * 1024)), sha256: createHash('sha256').update(data).digest('hex') }));
    await phone.send(data.subarray(0, 256 * 1024));
    expect(manager.status()).toMatchObject({ phase: 'receiving', receivedBytes: 256 * 1024, totalBytes: data.length });
  });

  it('rejects a replayed message, an out-of-order one, and a tampered one', async () => {
    const { phone } = await pair();
    await phone.hello();
    const header = { type: 'header', kind: 'csv', size: 10, chunks: 1, sha256: createHash('sha256').update('0123456789').digest('hex') };
    const first = phone.message(0, json(header));
    expect((await phone.post('send', first)).status).toBe(200);
    expect((await phone.post('send', first)).status).toBe(409);                    // replay
    expect((await phone.post('send', phone.message(5, Buffer.from('0123456789')))).status).toBe(409);   // out of order
    const forged = phone.message(1, Buffer.from('0123456789'));
    forged.ct = forged.ct.slice(0, -4) + (forged.ct.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect((await phone.post('send', forged)).status).toBe(403);                   // tampered
    expect((await phone.post('send', phone.message(1, Buffer.from('0123456789')))).status).toBe(200);
  });

  it('a message encrypted for another session or key is rejected', async () => {
    const a = await pair();
    await a.phone.hello();
    const stranger = Buffer.from(JSON.stringify({ seq: 0, ct: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }));
    const response = await fetch(`${a.phone.origin}/t/${a.info.sid}/send`, { method: 'POST', body: stranger });
    expect(response.status).toBe(403);
  });

  it('refuses unknown kinds, oversized payloads and bad digests before taking any data', async () => {
    for (const [header, status] of [
      [{ kind: 'credential', size: 10, chunks: 1 }, 400],
      [{ kind: 'csv', size: 10 * 1024 * 1024 + 1, chunks: 41 }, 413],
      [{ kind: 'portable', size: 64 * 1024 * 1024 + 1, chunks: 257 }, 413],
      [{ kind: 'csv', size: 10, chunks: 2 }, 400],
      [{ kind: 'csv', size: 10, chunks: 1, sha256: 'zz' }, 400],
    ] as const) {
      const { phone } = await pair();
      await phone.hello();
      const digest = createHash('sha256').update('x').digest('hex');
      expect((await phone.send(json({ type: 'header', sha256: digest, ...header }))).status).toBe(status);
    }
  });

  it('a chunk past the announced size is refused, and a payload that fails its digest is not delivered', async () => {
    const { phone, manager } = await pair();
    await phone.hello();
    await phone.send(json({ type: 'header', kind: 'csv', size: 4, chunks: 1, sha256: createHash('sha256').update('abcd').digest('hex') }));
    expect((await phone.send(Buffer.from('abcde'))).status).toBe(413);
    expect((await phone.send(Buffer.from('abcX'), 1)).status).toBe(422);   // the refused chunk did not use up its number
    expect(manager.status().phase).toBe('failed');
    expect(() => manager.takePayload()).toThrow();
  });

  it('cancelling from the phone ends the session and the TV says so', async () => {
    const { phone, manager } = await pair();
    await phone.hello();
    expect((await phone.cancel()).status).toBe(200);
    expect(manager.status()).toMatchObject({ phase: 'cancelled' });
    expect(manager.status().error).toMatch(/dibatalkan dari HP/);
  });

  it('a forged cancel is not accepted', async () => {
    const { phone, manager } = await pair();
    await phone.hello();
    expect((await phone.post('cancel', { proof: 'AAAA' })).status).toBe(403);
    expect(manager.status().phase).toBe('paired');
  });
});

describe('ending a session', () => {
  it('the TV can cancel; the listener closes and nothing stays behind', async () => {
    const { phone, manager } = await pair();
    await phone.hello();
    manager.cancel('Dibatalkan di TV.');
    expect(manager.status()).toMatchObject({ phase: 'cancelled', error: 'Dibatalkan di TV.' });
    await expect(phone.send(Buffer.from('x'))).rejects.toThrow();
    manager.cancel();
    expect(manager.status().phase).toBe('idle');
  });

  it('expires after five minutes, even in the middle of a transfer', async () => {
    const timers: Array<() => void> = [];
    const { phone, manager } = await pair({ setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; }, clearTimeout: () => undefined });
    await phone.hello();
    timers[0]();                                                                     // the session timer
    expect(manager.status()).toMatchObject({ phase: 'expired' });
    await expect(phone.send(Buffer.from('x'))).rejects.toThrow();
  });

  it('dispose (service stopping) closes the listener', async () => {
    const { phone, manager } = await pair();
    manager.dispose();
    await expect(phone.hello()).rejects.toThrow();
  });

  it('an old session id is useless once a new session starts', async () => {
    const first = await pair();
    first.manager.cancel();
    const started = await first.manager.start();
    const stale = new FakePhone(first.info, `http://127.0.0.1:${parseQr(started.qr).port}`);
    expect((await stale.post('hello', { pub: 'x', proof: 'y' })).status).toBe(404);
  });

  it('never proxies: only /t/<session>/hello|send|cancel exist on the listener', async () => {
    const { info } = await pair();
    for (const path of ['/', '/api/youtube/sw.js_data', '/api/catalog/home', '/media/x', `/t/${info.sid}`, `/t/${info.sid}/send/x`]) {
      const response = await fetch(`http://127.0.0.1:${info.port}${path}`, { method: 'POST', body: '{}' });
      expect(response.status).toBe(404);
    }
  });
});

describe('secrets', () => {
  it('nothing secret is in the status, and the key material is gone after the session', async () => {
    const { phone, manager, started } = await pair();
    await phone.hello();
    const status = JSON.stringify(manager.status());
    expect(status).not.toContain(started.qr);
    expect(status).not.toMatch(/secret|key|proof/i);
    await phone.sendPayload('csv', Buffer.from('a,b\n1,2'));
    expect(JSON.stringify(manager.status())).not.toMatch(/secret|key/i);
  });
});


describe('through the service', () => {
  it('start, status, payload and cancel work on the loopback API, and need the session token', async () => {
    const { startRuntime } = require('../service/runtime.cjs');
    const runtime = await startRuntime({ transferOptions: { bindHost: '127.0.0.1', advertiseHost: '192.168.1.20' } });
    try {
      expect((await fetch(`${runtime.origin}/api/transfer/start`, { method: 'POST' })).status).toBe(403);
      expect((await fetch(`${runtime.baseUrl}/api/transfer/status`)).json()).resolves.toEqual({ phase: 'idle' });
      const started = await (await fetch(`${runtime.baseUrl}/api/transfer/start`, { method: 'POST', body: JSON.stringify({ deviceName: 'Ruang Tamu' }) })).json();
      const phone = new FakePhone(parseQr(started.qr));
      expect((await fetch(`${runtime.baseUrl}/api/transfer/start`, { method: 'POST' })).status).toBe(409);
      await phone.hello();
      await phone.sendPayload('csv', Buffer.from('Type,Track name\nFavorite,Lagu'));
      expect((await (await fetch(`${runtime.baseUrl}/api/transfer/status`)).json()).phase).toBe('received');
      const payload = await (await fetch(`${runtime.baseUrl}/api/transfer/payload`)).json();
      expect(payload).toMatchObject({ kind: 'csv', text: 'Type,Track name\nFavorite,Lagu' });
      expect((await fetch(`${runtime.baseUrl}/api/transfer/payload`)).status).toBe(404);
      expect((await fetch(`${runtime.baseUrl}/api/transfer/other`)).status).toBe(404);
      await fetch(`${runtime.baseUrl}/api/transfer/start`, { method: 'POST' });
      const cancelled = await (await fetch(`${runtime.baseUrl}/api/transfer/cancel`, { method: 'POST' })).json();
      expect(cancelled.phase).toBe('cancelled');
    } finally { runtime.close(); }
  });

  it('closing the service closes an open pairing listener', async () => {
    const { startRuntime } = require('../service/runtime.cjs');
    const runtime = await startRuntime({ transferOptions: { bindHost: '127.0.0.1', advertiseHost: '192.168.1.20' } });
    const started = await (await fetch(`${runtime.baseUrl}/api/transfer/start`, { method: 'POST' })).json();
    const info = parseQr(started.qr);
    runtime.close();
    await expect(new FakePhone(info).hello()).rejects.toThrow();
  });
});
