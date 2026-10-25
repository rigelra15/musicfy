import { createRequire } from 'node:module';
import { createECDH, createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const t = require('../service/transfer.cjs');

/**
 * A reference phone: what the Android companion does, in a few lines, so the protocol is exercised
 * end to end by tests (and documented by code). Synthetic data only.
 */
export interface PairingInfo { host: string; port: number; sid: string; secret: Buffer; tvPub: Buffer; name: string }

export function parseQr(qr: string): PairingInfo {
  const url = new URL(qr.replace('musicfy://', 'https://'));
  if (url.hostname !== 'pair' || url.searchParams.get('v') !== '1') throw new Error('not a pairing code');
  return {
    host: url.searchParams.get('h')!, port: Number(url.searchParams.get('p')), sid: url.searchParams.get('s')!,
    secret: t.unb64u(url.searchParams.get('k')!), tvPub: t.unb64u(url.searchParams.get('t')!), name: url.searchParams.get('n') ?? '',
  };
}

export class FakePhone {
  keys!: { phoneToTv: Buffer; tvToPhone: Buffer };
  seq = 0;
  constructor(readonly info: PairingInfo, readonly origin = `http://127.0.0.1:${info.port}`) {}

  async post(route: string, body: unknown, sid = this.info.sid) {
    const response = await fetch(`${this.origin}/t/${sid}/${route}`, { method: 'POST', body: JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  }

  async hello(options: { secret?: Buffer } = {}) {
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const phonePub = ecdh.getPublicKey();
    const secret = options.secret ?? this.info.secret;
    const reply = await this.post('hello', { pub: t.b64u(phonePub), proof: t.b64u(t.helloProof(secret, this.info.sid, phonePub)) });
    if (reply.status === 200) {
      this.keys = t.deriveKeys(ecdh.computeSecret(this.info.tvPub), this.info.secret, this.info.sid, this.info.tvPub, phonePub);
      const confirm = t.hmac(this.keys.tvToPhone, Buffer.from('musicfy-tv-ready|' + this.info.sid));
      if (!t.equal(t.unb64u(reply.body.confirm as string), confirm)) throw new Error('TV did not prove it knows the secret');
    }
    return reply;
  }

  message(seq: number, plain: Buffer) { return { seq, ct: t.b64u(t.encryptMessage(this.keys.phoneToTv, this.info.sid, seq, plain)) }; }
  send(plain: Buffer, seq = this.seq++) { return this.post('send', this.message(seq, plain)); }

  /** Sends one payload the way the companion does: a header, then 256 KiB chunks. */
  async sendPayload(kind: 'portable' | 'csv', data: Buffer, extra: Record<string, unknown> = {}) {
    const chunkBytes: number = t.CHUNK_BYTES;
    const header = { type: 'header', kind, name: 'test', device: 'Pixel (test)', size: data.length, chunks: Math.ceil(data.length / chunkBytes), sha256: createHash('sha256').update(data).digest('hex'), ...extra };
    let last = await this.send(Buffer.from(JSON.stringify(header)));
    for (let offset = 0; offset < data.length && last.status === 200; offset += chunkBytes) last = await this.send(data.subarray(offset, offset + chunkBytes));
    return last;
  }

  cancel() { return this.post('cancel', { proof: t.b64u(t.hmac(this.keys.phoneToTv, Buffer.from('musicfy-cancel|' + this.info.sid))) }); }
}
