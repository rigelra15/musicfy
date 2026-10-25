'use strict';
// Phone -> TV transfer. A short-lived listener on the local network that only the phone that scanned
// the QR code can talk to: ECDH (P-256) for the key, HKDF-SHA256 to split it, AES-256-GCM for every
// message, and a sequence number inside the nonce and the associated data so nothing can be replayed
// or reordered. The listener exists only between "Hubungkan HP" and the end of the session; it never
// proxies anything. Core Node modules only (Node 16).
const http = require('http');
const crypto = require('crypto');
const os = require('os');

const SESSION_MS = 5 * 60 * 1000;
const CHUNK_BYTES = 256 * 1024;
const MAX_BODY = 512 * 1024;
const MAX_FAILURES = 5;
const LIMITS = { csv: 10 * 1024 * 1024, portable: 64 * 1024 * 1024, 'applemusic-session': 16 * 1024 };
/** Kinds that are credentials: handled inside the service, never handed to the screen. */
const PRIVATE_KINDS = ['applemusic-session'];
const KINDS = Object.keys(LIMITS);
const PAYLOAD_KEEP_MS = 10 * 60 * 1000;

const b64u = (buffer) => Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (text) => {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length > 1024 * 1024) throw new Error('bad encoding');
  return Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
};
const equal = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);
const hmac = (key, ...parts) => { const h = crypto.createHmac('sha256', key); for (const part of parts) h.update(part); return h.digest(); };

/** Both sides derive the same two keys; `info` ties them to this session and both public keys. */
function deriveKeys(shared, secret, sid, tvPub, phonePub) {
  const info = Buffer.concat([Buffer.from('musicfy-transfer-v1|' + sid + '|'), tvPub, phonePub]);
  const okm = Buffer.from(crypto.hkdfSync('sha256', shared, secret, info, 64));
  return { phoneToTv: okm.subarray(0, 32), tvToPhone: okm.subarray(32, 64) };
}
const nonceFor = (seq) => { const n = Buffer.alloc(12); n.writeUInt32BE(Math.floor(seq / 0x100000000), 0); n.writeUInt32BE(seq >>> 0, 4); return n; };
const aadFor = (sid, seq) => Buffer.from('musicfy-msg|' + sid + '|' + seq);
const helloProof = (secret, sid, phonePub) => hmac(secret, Buffer.from('musicfy-hello|' + sid + '|'), phonePub);

function encryptMessage(key, sid, seq, plaintext) {
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonceFor(seq));
  cipher.setAAD(aadFor(sid, seq));
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}
function decryptMessage(key, sid, seq, data) {
  if (data.length < 16) throw new Error('short message');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonceFor(seq));
  decipher.setAAD(aadFor(sid, seq));
  decipher.setAuthTag(data.subarray(data.length - 16));
  return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]);
}

function lanAddress(interfaces) {
  for (const list of Object.values(interfaces)) for (const item of list || []) if (item.family === 'IPv4' && !item.internal) return item.address;
  return undefined;
}

class TransferError extends Error {
  constructor(message, status, code) { super(message); this.name = 'TransferError'; this.status = status; this.code = code; }
}

function createTransferManager(options = {}) {
  const now = options.now || (() => Date.now());
  const setTimer = options.setTimeout || setTimeout;
  const clearTimer = options.clearTimeout || clearTimeout;
  let session;       // the live session, if any
  let result;        // what the last session ended as (and its payload until taken)
  let resultTimer;

  const publicStatus = () => {
    const s = session;
    if (s) return { phase: s.phase, expiresAt: s.expiresAt, device: s.device, kind: s.kind, name: s.name, receivedBytes: s.received, totalBytes: s.size };
    if (result) return { phase: result.phase, device: result.device, kind: result.kind, name: result.name, receivedBytes: result.size, totalBytes: result.size, error: result.error, code: result.code, private: result.private };
    return { phase: 'idle' };
  };

  function wipe(s) {
    if (s.keys) { s.keys.phoneToTv.fill(0); s.keys.tvToPhone.fill(0); }
    s.keys = undefined; s.secret.fill(0);
  }

  function finish(phase, extra) {
    const s = session;
    if (!s) return;
    session = undefined;
    clearTimer(s.timer);
    wipe(s);
    for (const socket of s.sockets) socket.destroy();
    s.server.close();
    clearTimer(resultTimer);
    result = { phase, device: s.device, kind: s.kind, name: s.name, size: s.size, ...extra };
    if (phase === 'received') resultTimer = setTimer(() => { result = undefined; }, PAYLOAD_KEEP_MS);
    else resultTimer = setTimer(() => { if (result && !result.payload) result = undefined; }, 60 * 1000);
    if (resultTimer && resultTimer.unref) resultTimer.unref();
  }

  const fail = (message, code) => finish('failed', { error: message, code });

  function onRequest(s, req, res) {
    const reply = (status, body) => { if (!res.headersSent) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body || {})); } };
    const bump = (status, message) => {
      s.failures += 1;
      reply(status, { error: message });
      if (s.failures >= MAX_FAILURES) fail('Terlalu banyak percobaan yang gagal. Mulai sambungan baru.', 'tooMany');
    };
    if (session !== s) { reply(410, { error: 'Session over' }); return; }
    const url = (req.url || '').split('?')[0].split('/');
    if (url.length !== 4 || url[1] !== 't' || url[2] !== s.sid) { reply(404, { error: 'Not found' }); return; }
    if (req.method !== 'POST') { reply(405, { error: 'POST only' }); return; }
    const route = url[3];
    if (!['hello', 'send', 'cancel'].includes(route)) { reply(404, { error: 'Not found' }); return; }
    const chunks = []; let size = 0; let tooBig = false;
    req.on('data', (chunk) => { size += chunk.length; if (size > MAX_BODY) { tooBig = true; req.destroy(); } else chunks.push(chunk); });
    req.on('error', () => undefined);
    req.on('close', () => { if (tooBig && !res.headersSent) bump(413, 'Body too large'); });
    req.on('end', () => {
      if (tooBig || session !== s) return;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!body || typeof body !== 'object') throw new Error(); } catch (error) { bump(400, 'Invalid JSON'); return; }
      try { dispatch(s, route, body, reply, bump); } catch (error) { bump(400, 'Invalid request'); }
    });
  }

  function dispatch(s, route, body, reply, bump) {
    if (route === 'hello') {
      if (s.phase !== 'waiting') { reply(409, { error: 'Already paired' }); return; }
      const phonePub = unb64u(body.pub);
      if (phonePub.length !== 65 || phonePub[0] !== 4) { bump(400, 'Bad key'); return; }
      if (!equal(unb64u(body.proof), helloProof(s.secret, s.sid, phonePub))) { bump(403, 'Wrong pairing code'); return; }
      let shared;
      try { shared = s.ecdh.computeSecret(phonePub); } catch (error) { bump(400, 'Bad key'); return; }
      s.keys = deriveKeys(shared, s.secret, s.sid, s.tvPub, phonePub);
      shared.fill(0);
      s.phase = 'paired';
      reply(200, { confirm: b64u(hmac(s.keys.tvToPhone, Buffer.from('musicfy-tv-ready|' + s.sid))), chunkBytes: CHUNK_BYTES, limits: LIMITS });
      return;
    }
    if (s.phase !== 'paired' && s.phase !== 'receiving') { reply(409, { error: 'Not paired' }); return; }
    if (route === 'cancel') {
      if (!equal(unb64u(body.proof), hmac(s.keys.phoneToTv, Buffer.from('musicfy-cancel|' + s.sid)))) { bump(403, 'Bad proof'); return; }
      reply(200, {});
      finish('cancelled', { error: 'Pengiriman dibatalkan dari HP.', code: 'phoneCancelled' });
      return;
    }
    // send
    const seq = body.seq;
    if (!Number.isInteger(seq) || seq < 0) { bump(400, 'Bad sequence'); return; }
    if (seq !== s.nextSeq) { bump(409, seq < s.nextSeq ? 'Replay' : 'Out of order'); return; }
    let plain;
    try { plain = decryptMessage(s.keys.phoneToTv, s.sid, seq, unb64u(body.ct)); } catch (error) { bump(403, 'Message rejected'); return; }
    if (seq === 0) {
      let header;
      try { header = JSON.parse(plain.toString('utf8')); } catch (error) { bump(400, 'Bad header'); return; }
      if (!header || header.type !== 'header' || !KINDS.includes(header.kind)) { bump(400, 'Unknown kind'); return; }
      if (!Number.isInteger(header.size) || header.size <= 0 || header.size > LIMITS[header.kind]) { bump(413, 'Too large'); return; }
      if (!Number.isInteger(header.chunks) || header.chunks !== Math.ceil(header.size / CHUNK_BYTES)) { bump(400, 'Bad chunk count'); return; }
      if (typeof header.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(header.sha256)) { bump(400, 'Bad digest'); return; }
      s.kind = header.kind; s.size = header.size; s.chunks = header.chunks; s.sha = header.sha256;
      s.name = typeof header.name === 'string' ? header.name.slice(0, 120) : undefined;
      s.device = typeof header.device === 'string' ? header.device.slice(0, 80) : undefined;
      s.parts = []; s.received = 0; s.phase = 'receiving'; s.nextSeq = 1;
      reply(200, { next: 1 });
      return;
    }
    if (s.phase !== 'receiving') { bump(409, 'No header'); return; }
    if (plain.length === 0 || plain.length > CHUNK_BYTES || s.received + plain.length > s.size) { bump(413, 'Chunk too large'); return; }
    s.parts.push(plain); s.received += plain.length; s.nextSeq += 1;
    if (seq < s.chunks) { reply(200, { next: s.nextSeq }); return; }
    const payload = Buffer.concat(s.parts);
    s.parts = [];
    if (payload.length !== s.size || crypto.createHash('sha256').update(payload).digest('hex') !== s.sha) { reply(422, { error: 'Corrupt' }); fail('Data dari HP rusak di perjalanan. Coba kirim lagi.', 'corrupt'); return; }
    if (PRIVATE_KINDS.includes(s.kind)) {
      let accepted = false;
      try { accepted = Boolean(options.onSession && options.onSession(s.kind, payload.toString('utf8'))); } catch (error) { accepted = false; }
      payload.fill(0);
      if (!accepted) { reply(422, { error: 'Session refused' }); fail('Sesi dari HP tidak valid atau tidak bisa dipakai.', 'refused'); return; }
      reply(200, { done: true });
      finish('received', { private: true });
      return;
    }
    reply(200, { done: true });
    finish('received', { payload });
  }

  return {
    /** Opens the listener for one phone. Resolves with what the QR code carries. */
    async start(startOptions = {}) {
      if (session) throw new TransferError('Sambungan HP sedang berjalan.', 409, 'busy');
      clearTimer(resultTimer); result = undefined;
      const ecdh = crypto.createECDH('prime256v1');
      ecdh.generateKeys();
      const s = {
        sid: b64u(crypto.randomBytes(12)), secret: crypto.randomBytes(16), ecdh, tvPub: ecdh.getPublicKey(), phase: 'waiting', failures: 0,
        nextSeq: 0, sockets: new Set(), expiresAt: now() + SESSION_MS, received: 0, size: 0, parts: [],
      };
      s.server = http.createServer((req, res) => onRequest(s, req, res));
      s.server.requestTimeout = 30000; s.server.headersTimeout = 10000;
      s.server.on('connection', (socket) => { s.sockets.add(socket); socket.on('close', () => s.sockets.delete(socket)); });
      await new Promise((resolve, reject) => { s.server.once('error', reject); s.server.listen(0, options.bindHost || '0.0.0.0', resolve); });
      const host = options.advertiseHost || lanAddress((options.networkInterfaces || os.networkInterfaces)());
      if (!host) { s.server.close(); throw new TransferError('TV tidak terhubung ke jaringan Wi-Fi atau Ethernet.', 503, 'noNetwork'); }
      const port = s.server.address().port;
      s.timer = setTimer(() => { if (session === s) finish('expired', { error: 'Waktu sambungan habis. Mulai lagi.', code: 'expired' }); }, SESSION_MS);
      if (s.timer && s.timer.unref) s.timer.unref();
      session = s;
      const name = String(startOptions.deviceName || 'Musicfy TV').slice(0, 40);
      const qr = 'musicfy://pair?v=1&h=' + host + '&p=' + port + '&s=' + s.sid + '&k=' + b64u(s.secret) + '&t=' + b64u(s.tvPub) + '&n=' + encodeURIComponent(name);
      return { qr, host, port, sessionId: s.sid, expiresAt: s.expiresAt };
    },
    status: publicStatus,
    /** The received data, once. Nothing is kept after this. */
    takePayload() {
      if (!result || result.phase !== 'received' || !result.payload) throw new TransferError('Belum ada data dari HP.', 404, 'noData');
      const taken = { kind: result.kind, name: result.name, device: result.device, text: result.payload.toString('utf8') };
      result.payload.fill(0); result = undefined; clearTimer(resultTimer);
      return taken;
    },
    cancel(reason, code) {
      if (session) finish('cancelled', { error: reason || 'Sambungan dibatalkan.', code: code || 'cancelled' });
      else { clearTimer(resultTimer); if (result && result.payload) result.payload.fill(0); result = undefined; }
    },
    dispose() { this.cancel('Layanan berhenti.'); },
  };
}

module.exports = { createTransferManager, TransferError, deriveKeys, helloProof, encryptMessage, decryptMessage, b64u, unb64u, hmac, equal, SESSION_MS, CHUNK_BYTES, LIMITS, MAX_FAILURES };
