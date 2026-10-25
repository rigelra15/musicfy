'use strict';
// Audio sources other than YouTube: Monochrome (lossless FLAC, no account) and Apple Music (the
// user's own subscription, AAC behind Widevine). Port of the Android source modules, with the same
// rules: a song is searched, matched like every module matches, and handed back as a stream. The
// renderer never sees a credential, a signed address or a license: it gets relay paths on this
// service, and every upstream host and path is fixed here.
//
// Honest labels: `codec` and `qualityLabel` say what the source actually sent. Nothing here can say
// whether the TV's decoder or its DRM will play a stream; that is proven on the TV, not here.
const crypto = require('crypto');
const matcher = require('./matcher.cjs');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const MONO = 'https://tracks.monochrome.st';
const APPLE_API = 'https://amp-api.music.apple.com';
const APPLE_PLAY = 'https://play.itunes.apple.com';
const WEB_PLAYBACK = APPLE_PLAY + '/WebObjects/MZPlay.woa/wa/webPlayback';
const LICENSE = APPLE_PLAY + '/WebObjects/MZPlay.woa/wa/acquireWebPlaybackLicense';
const WIDEVINE_KEYFORMAT = 'urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed';
const MISS_MEMORY_MS = 30 * 60 * 1000;
const UNREACHABLE_RETRY_MS = 10 * 60 * 1000;
const TOKEN_TTL_MS = 60 * 60 * 1000;
const MAX_TOKENS = 2048;
const REGIONS = [['us', 'United States'], ['gb', 'United Kingdom'], ['jp', 'Japan'], ['kr', 'South Korea'], ['id', 'Indonesia'], ['sg', 'Singapore'], ['my', 'Malaysia'], ['ph', 'Philippines'], ['th', 'Thailand'], ['in', 'India'], ['au', 'Australia'], ['ca', 'Canada'], ['de', 'Germany'], ['fr', 'France'], ['br', 'Brazil'], ['mx', 'Mexico']];

/** What went wrong, in the terms the screen shows: the account, the song match, the stream, the license. */
const KINDS = ['auth', 'network', 'matching', 'stream', 'license'];
class SourceError extends Error {
  constructor(kind, message, status) { super(message); this.name = 'SourceError'; this.kind = kind; this.status = status; }
}

// ---- what may be asked, and of whom ---------------------------------------------------------------

const hostPaths = {
  'tracks.monochrome.st': /^\/(search\/tracks|track\/[A-Za-z0-9_-]{1,64})$/,
  'amp-api.music.apple.com': /^\/v1\/(me\/storefront|catalog\/[a-z]{2}\/(songs|search|albums\/[0-9]+))$/,
  'play.itunes.apple.com': /^\/WebObjects\/MZPlay\.woa\/wa\/(webPlayback|acquireWebPlaybackLicense)$/,
  'music.apple.com': /^\/(us\/browse|assets\/index(?:-legacy)?[~-][A-Za-z0-9_-]+\.js)$/,
};
const mediaSuffixes = ['.apple.com', '.mzstatic.com', '.aaplimg.com'];

function allowedSourceUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
    return Boolean(hostPaths[url.hostname] && hostPaths[url.hostname].test(url.pathname));
  } catch (error) { return false; }
}
/** Audio and playlist files: Monochrome's own track address, or an Apple media host. */
function allowedMediaUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
    if (url.hostname === 'tracks.monochrome.st') return /^\/track\/[A-Za-z0-9_-]{1,64}$/.test(url.pathname);
    return mediaSuffixes.some((suffix) => url.hostname.endsWith(suffix));
  } catch (error) { return false; }
}

// ---- small helpers ---------------------------------------------------------------------------------

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v ? v : undefined);
const jsonOf = (body) => { try { const v = JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body)); return isObject(v) ? v : {}; } catch (error) { return {}; } };
const enc = (text) => encodeURIComponent(text).replace(/%20/g, '%20');
const jwtPayload = (token) => { try { return Buffer.from(String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch (error) { return undefined; } };
const jwtExpiryMs = (token) => { const m = /"exp":(\d+)/.exec(jwtPayload(token) || ''); return m ? Number(m[1]) * 1000 : 0; };

/** STREAMINFO of a FLAC file's head: bit depth and sample rate. */
function flacInfo(bytes) {
  if (!bytes || bytes.length < 4 || bytes.subarray(0, 4).toString('latin1') !== 'fLaC') return undefined;
  if (bytes.length < 26) return { bits: 16, sampleRate: 44100 };
  const b = bytes.subarray(8, 26);
  const sampleRate = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
  const bits = (((b[12] & 1) << 4) | (b[13] >> 4)) + 1;
  return sampleRate >= 8000 && sampleRate <= 768000 && bits >= 8 && bits <= 32 ? { bits, sampleRate } : { bits: 16, sampleRate: 44100 };
}
function flacLabel(info) {
  const hiRes = info.bits > 16 || info.sampleRate > 48000;
  const rate = info.sampleRate % 1000 === 0 ? String(info.sampleRate / 1000) : (info.sampleRate / 1000).toFixed(1);
  return { short: hiRes ? 'Hi-Res FLAC' : 'FLAC', long: (hiRes ? 'Hi-Res FLAC' : 'FLAC') + ' · ' + info.bits + '-bit / ' + rate + ' kHz' };
}

// ---- Apple's HLS, as far as Widevine playback needs ------------------------------------------------

const WIDEVINE_SYSTEM_ID = Buffer.from('edef8ba979d64acea3c827dcd51d21ed', 'hex');
const attribute = (line, name) => {
  const m = new RegExp('(?:^|[:,])' + name + '=("([^"]*)"|[^,]*)').exec(line);
  return m ? (m[2] || m[1]) : undefined;
};
function keyIdOf(pssh) {
  for (let i = 32; i < pssh.length - 17; i += 1) if (pssh[i] === 0x12 && pssh[i + 1] === 0x10) return pssh.subarray(i + 2, i + 18);
  return pssh.subarray(Math.min(32, pssh.length));
}
function legacyKey(media) {
  const line = media.split('\n').find((l) => l.startsWith('#EXT-X-KEY') && (attribute(l, 'KEYFORMAT') === WIDEVINE_KEYFORMAT || (attribute(l, 'URI') || '').startsWith('data:')));
  if (!line) return undefined;
  const uri = attribute(line, 'URI');
  if (!uri) return undefined;
  let payload;
  try { payload = Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64'); } catch (error) { return undefined; }
  const keyId = payload.length === 16 ? payload : payload.length > 32 ? keyIdOf(payload) : undefined;
  return keyId ? { uri, keyId } : undefined;
}
/** A Widevine PSSH box (version 0) whose data names `keyId`. */
function psshFor(keyId) {
  const data = Buffer.concat([Buffer.from([0x08, 0x01, 0x12, keyId.length]), keyId]);
  const head = Buffer.alloc(32);
  head.writeUInt32BE(32 + data.length, 0); head.write('pssh', 4, 'latin1'); head.writeUInt32BE(0, 8);
  WIDEVINE_SYSTEM_ID.copy(head, 12); head.writeUInt32BE(data.length, 28);
  return Buffer.concat([head, data]);
}
const playerMethod = (method) => (['SAMPLE-AES', 'SAMPLE-AES-CENC', 'SAMPLE-AES-CTR'].includes(method) ? method : 'SAMPLE-AES-CTR');
const resolveUri = (base, uri) => (/^https?:/.test(uri) ? uri : base.slice(0, base.lastIndexOf('/') + 1) + uri);

/** The playlist the player opens: the Widevine key as a whole box, every file address replaced by `relay(url)`. */
function rewriteLegacy(media, base, keyUri, pssh, relay) {
  const psshUri = 'data:text/plain;base64,' + pssh.toString('base64');
  return media.split('\n').map((line) => {
    if (line.startsWith('#EXT-X-KEY')) {
      return attribute(line, 'URI') !== keyUri ? null : '#EXT-X-KEY:METHOD=' + playerMethod(attribute(line, 'METHOD')) + ',URI="' + psshUri + '",KEYFORMAT="' + WIDEVINE_KEYFORMAT + '",KEYFORMATVERSIONS="1"';
    }
    if (line.startsWith('#EXT-X-MAP')) {
      const uri = attribute(line, 'URI');
      return uri ? line.replace('URI="' + uri + '"', 'URI="' + relay(resolveUri(base, uri)) + '"') : line;
    }
    if (line.trim() && !line.startsWith('#')) return relay(resolveUri(base, line.trim()));
    return line;
  }).filter((line) => line !== null).join('\n');
}
const segmentCount = (media) => media.split('\n').filter((l) => l.trim() && !l.startsWith('#')).length;

// ---- the registry ------------------------------------------------------------------------------------

/**
 * `http(url, {method, headers, body})` answers `{status, body: Buffer}` and is given only
 * addresses that passed `allowedSourceUrl`/`allowedMediaUrl`. `storage` is `{get, set}` on strings,
 * private to the service (credentials live here and nowhere else).
 */
function createSources({ http, storage, now = Date.now, newToken = () => crypto.randomBytes(18).toString('hex') }) {
  const tokens = new Map();
  const misses = new Map();
  const matches = new Map();

  const put = (entry) => {
    for (const [key, value] of tokens) if (value.expires <= now()) tokens.delete(key);
    while (tokens.size >= MAX_TOKENS) tokens.delete(tokens.keys().next().value);
    const token = newToken();
    tokens.set(token, { ...entry, expires: now() + TOKEN_TTL_MS });
    return token;
  };
  const take = (token) => { const entry = tokens.get(token); if (!entry || entry.expires <= now()) { tokens.delete(token); return undefined; } return entry; };

  async function call(url, options) {
    if (!allowedSourceUrl(url) && !allowedMediaUrl(url)) throw new SourceError('stream', 'Alamat sumber tidak diizinkan.');
    try { return await http(url, options || {}); } catch (error) { throw new SourceError('network', 'Tidak bisa menghubungi layanan sumber.'); }
  }

  // ---- Monochrome ---------------------------------------------------------------------------------
  const monoHeaders = { Accept: 'application/json', 'User-Agent': UA };
  const monochrome = {
    info: { id: 'monochrome', name: 'Monochrome', description: 'FLAC lossless untuk lagu yang dimiliki Monochrome, tanpa akun.', needsAccount: false },
    choices: [],
    account() {
      const reason = storage.get('monochrome.unreachable');
      if (!reason) return { state: 'ready', label: 'Tanpa akun' };
      return now() - Number(storage.get('monochrome.unreachable_at') || 0) < UNREACHABLE_RETRY_MS ? { state: 'unreachable', label: reason } : { state: 'ready', label: 'Tanpa akun' };
    },
    markUnreachable(reason) { storage.set('monochrome.unreachable', reason); storage.set('monochrome.unreachable_at', String(now())); },
    async verify() {
      let response;
      try { response = await call(MONO + '/search/tracks?q=test&limit=1', { headers: monoHeaders }); } catch (error) { response = undefined; }
      if (response && response.status >= 200 && response.status < 300) { storage.set('monochrome.unreachable', null); return { state: 'ready', label: 'Tanpa akun · server terjangkau' }; }
      const reason = 'Server Monochrome tidak menjawab (' + (response ? response.status : 'offline') + ')';
      this.markUnreachable(reason);
      return { state: 'unreachable', label: reason };
    },
    signOut() { /* no account */ },
    tracksIn(body) {
      const list = Array.isArray(jsonOf(body).tracks) ? jsonOf(body).tracks : [];
      return list.flatMap((t) => {
        if (!isObject(t) || t.playable === false) return [];
        const id = str(t.trackId) || str(t.id);
        const title = str(t.title);
        if (!id || !title) return [];
        const duration = Number.isFinite(t.duration) ? (t.duration > 10000 ? t.duration : t.duration * 1000) : undefined;
        return [{ id, title, artist: (Array.isArray(t.artistNames) ? t.artistNames.filter((n) => typeof n === 'string') : []).join(', '), album: str(t.albumTitle) || str(t.releaseTitle), durationMs: duration, isrc: str(t.isrc) }];
      });
    },
    async resolve(query, _picks, report) {
      const key = query.title + '|' + (query.artists || []).join(',');
      const missed = misses.get('mono|' + key);
      if (missed && now() - missed < MISS_MEMORY_MS) { report('Cari lagu', false, 'Tidak ada di Monochrome'); throw new SourceError('matching', 'Tidak ada di Monochrome.'); }
      report('Cari lagu', null, 'Mencari di Monochrome…');
      let found = matches.get('mono|' + key);
      if (!found) {
        const term = ((query.artists || [])[0] || '') + ' ' + matcher.core(query.title);
        let response;
        try { response = await call(MONO + '/search/tracks?q=' + enc(term.trim()) + '&limit=8', { headers: monoHeaders }); } catch (error) {
          this.markUnreachable('Server Monochrome tidak menjawab');
          report('Cari lagu', false, 'Server Monochrome tidak menjawab');
          throw new SourceError('network', 'Server Monochrome tidak menjawab.');
        }
        if (response.status < 200 || response.status >= 300) { report('Cari lagu', false, 'Monochrome menjawab ' + response.status); throw new SourceError('network', 'Monochrome menjawab ' + response.status + '.', response.status); }
        storage.set('monochrome.unreachable', null);
        const best = matcher.ranked(query, this.tracksIn(response.body))[0];
        if (!best) { misses.set('mono|' + key, now()); report('Cari lagu', false, 'Tidak ada rekaman yang cocok'); throw new SourceError('matching', 'Tidak ada rekaman yang cocok di Monochrome.'); }
        found = best.song;
        matches.set('mono|' + key, found);
      }
      report('Cari lagu', true, found.title + ' · ' + found.artist);
      report('Stream', null, 'Membuka stream…');
      const url = MONO + '/track/' + found.id;
      let head;
      try { head = await call(url, { headers: { 'User-Agent': UA, Range: 'bytes=0-41' }, maxBytes: 64 }); } catch (error) { head = undefined; }
      if (!head || head.status < 200 || head.status >= 300) { report('Stream', false, 'Stream menjawab ' + (head ? head.status : 'tidak ada')); throw new SourceError('stream', 'Stream Monochrome menjawab ' + (head ? head.status : 'tidak ada') + '.'); }
      const info = flacInfo(head.body);
      if (!info) { report('Stream', false, 'Bukan berkas FLAC'); throw new SourceError('stream', 'Stream Monochrome bukan FLAC.'); }
      const label = flacLabel(info);
      report('Stream', true, label.long);
      const token = put({ kind: 'media', url, headers: { 'User-Agent': UA } });
      return { format: 'progressive', path: '/api/source/media/' + token, mimeType: 'audio/flac', codec: 'FLAC', qualityLabel: label.short, sampleRateHz: info.sampleRate, sourceLabel: 'Monochrome', matched: { id: found.id, title: found.title, artist: found.artist, album: found.album, durationMs: found.durationMs, confidence: matcher.score(query, found) } };
    },
  };

  // ---- Apple Music ----------------------------------------------------------------------------------
  const appleHeaders = { Origin: 'https://music.apple.com', Referer: 'https://music.apple.com/', 'User-Agent': UA };
  const userToken = () => storage.get('applemusic.user_token') || undefined;
  async function refreshDeveloperToken(signal) {
    let page;
    try { page = await call('https://music.apple.com/us/browse', { headers: appleHeaders, signal }); } catch (error) { return false; }
    if (page.status !== 200) return false;
    const scripts = [...new Set((page.body.toString('utf8').match(/\/assets\/index(?:-legacy)?[~-][a-zA-Z0-9_-]+\.js/g) || []))];
    for (const path of scripts) {
      let script;
      if(signal && signal.aborted)return false;
      try { script = await call('https://music.apple.com' + path, { headers: appleHeaders, signal }); } catch (error) { continue; }
      if (script.status !== 200) continue;
      const found = (script.body.toString('utf8').match(/eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g) || []).filter((t) => jwtExpiryMs(t) > now()).sort((a, b) => Number((jwtPayload(b) || '').includes('AMPWebPlay')) - Number((jwtPayload(a) || '').includes('AMPWebPlay')))[0];
      if (found) { storage.set('applemusic.developer_token', found); return true; }
    }
    return false;
  }
  async function developerToken(signal) {
    const saved = storage.get('applemusic.developer_token');
    if (saved && jwtExpiryMs(saved) > now() + 60000) return saved;
    await refreshDeveloperToken(signal);
    return storage.get('applemusic.developer_token') || '';
  }
  async function appleApi(path, signal) {
    const headers = { ...appleHeaders, Authorization: 'Bearer ' + (await developerToken(signal)) };
    if (userToken()) headers['Media-User-Token'] = userToken();
    return call(APPLE_API + path, { headers, signal });
  }
  const apple = {
    info: { id: 'applemusic', name: 'Apple Music', description: 'Langganan Apple Music milikmu, AAC 256 atau HE-AAC 64, lewat Widevine. Belum terbukti di TV.', needsAccount: true },
    choices: [
      { id: 'quality', label: 'Kualitas', options: [{ id: 'aac256', label: 'AAC 256', description: 'Stream stereo standar Apple Music' }, { id: 'he64', label: 'HE-AAC 64', description: 'Seperempat data, untuk jaringan lambat' }] },
      { id: 'region', label: 'Wilayah', options: [{ id: 'auto', label: 'Akunmu', description: 'Katalog negara akun Apple-mu' }].concat(REGIONS.map(([id, label]) => ({ id, label, description: 'Katalog ' + label + '. Lagu yang tidak dilisensikan negara akunmu bisa tetap ditolak' }))) },
    ],
    account() {
      if (!userToken()) return { state: 'signedOut', label: 'Belum terhubung' };
      const expired = storage.get('applemusic.expired');
      if (expired) return { state: 'expired', label: expired };
      return { state: 'signedIn', label: storage.get('applemusic.account_label') || 'Terhubung' };
    },
    /** From the phone (explicit pairing). Returns whether there is enough to try. */
    setSession(session) {
      const user = str(session && session.userToken);
      if (!user || user.length < 20 || user.length > 4096) throw new SourceError('auth', 'Sesi Apple Music tidak valid.');
      storage.set('applemusic.user_token', user);
      const developer = str(session && session.developerToken);
      if (developer && developer.startsWith('eyJ') && developer.length < 4096 && jwtExpiryMs(developer) > now()) storage.set('applemusic.developer_token', developer);
      storage.set('applemusic.expired', null);
      storage.set('applemusic.account_label', null);
      storage.set('applemusic.storefront', null);
    },
    async verify(retried) {
      if (!userToken()) return { state: 'signedOut', label: 'Belum terhubung' };
      let response;
      try { response = await appleApi('/v1/me/storefront'); } catch (error) { return { state: 'unreachable', label: 'Apple Music tidak terjangkau' }; }
      if (response.status === 401 || response.status === 403) {
        if (!retried && (await refreshDeveloperToken())) return this.verify(true);
        storage.set('applemusic.expired', 'Sesi Apple Music berakhir. Hubungkan lagi lewat HP: login Apple tidak bisa dibuka dari aplikasi TV.');
        return { state: 'expired', label: 'Sesi Apple Music berakhir. Hubungkan lagi lewat HP: login Apple tidak bisa dibuka dari aplikasi TV.' };
      }
      if (response.status < 200 || response.status >= 300) return { state: 'unreachable', label: 'Apple Music tidak menjawab (' + response.status + ')' };
      const front = (Array.isArray(jsonOf(response.body).data) ? jsonOf(response.body).data : [])[0];
      const id = isObject(front) ? str(front.id) : undefined;
      const country = isObject(front) && isObject(front.attributes) ? str(front.attributes.name) : undefined;
      if (id) storage.set('applemusic.storefront', id);
      const label = 'Terhubung' + (id ? ' · ' + id : country ? ' · ' + country : '');
      storage.set('applemusic.account_label', label); storage.set('applemusic.expired', null);
      return { state: 'signedIn', label };
    },
    signOut() { for (const k of ['user_token', 'developer_token', 'storefront', 'account_label', 'expired']) storage.set('applemusic.' + k, null); matches.clear(); misses.clear(); },
    songsIn(data) {
      return (Array.isArray(data) ? data : []).flatMap((item) => {
        const a = isObject(item) && isObject(item.attributes) ? item.attributes : undefined;
        const id = isObject(item) ? str(item.id) : undefined;
        const title = a && str(a.name);
        return id && title ? [{ id, title, artist: str(a.artistName) || '', album: str(a.albumName), durationMs: Number.isFinite(a.durationInMillis) ? a.durationInMillis : undefined, isrc: str(a.isrc) }] : [];
      });
    },
    async catalogMatch(query, region) {
      if (query.isrc) {
        const byIsrc = await appleApi('/v1/catalog/' + region + '/songs?filter[isrc]=' + enc(query.isrc));
        if (byIsrc.status >= 200 && byIsrc.status < 300) { const songs = this.songsIn(jsonOf(byIsrc.body).data); if (songs.length) return songs.map((song) => ({ song, score: 1 })); }
      }
      const term = (matcher.core(query.title) + ' ' + ((query.artists || [])[0] || '')).trim();
      const search = await appleApi('/v1/catalog/' + region + '/search?term=' + enc(term) + '&types=songs&limit=15');
      if (search.status < 200 || search.status >= 300) throw new SourceError(search.status === 401 || search.status === 403 ? 'auth' : 'network', 'Pencarian Apple Music menjawab ' + search.status + '.', search.status);
      const songs = jsonOf(search.body).results && jsonOf(search.body).results.songs ? jsonOf(search.body).results.songs.data : [];
      return matcher.ranked(query, this.songsIn(songs));
    },
    async resolve(query, picks, report) {
      if (!userToken()) { report('Akun', false, 'Belum terhubung'); throw new SourceError('auth', 'Apple Music belum terhubung. Login Apple tidak bisa dibuka dari aplikasi TV, jadi hubungkan lewat HP (Pengaturan, Modul).'); }
      if (!storage.get('applemusic.storefront')) {
        report('Akun', null, 'Memeriksa akunmu…');
        const state = await this.verify(false);
        if (state.state !== 'signedIn') { report('Akun', false, state.label); throw new SourceError(state.state === 'unreachable' ? 'network' : 'auth', state.label); }
      }
      report('Akun', true, storage.get('applemusic.account_label') || 'Terhubung');
      const region = (picks && picks.region && picks.region !== 'auto' ? picks.region : undefined) || storage.get('applemusic.storefront') || 'us';
      if (!/^[a-z]{2}$/.test(region)) throw new SourceError('matching', 'Wilayah tidak valid.');
      const quality = (picks && picks.quality) === 'he64' ? 'he64' : 'aac256';
      const key = 'apple|' + region + '|' + query.title + '|' + (query.artists || []).join(',');
      const missed = misses.get(key);
      if (missed && now() - missed < MISS_MEMORY_MS) { report('Cari lagu', false, 'Tidak ada di Apple Music'); throw new SourceError('matching', 'Tidak ada di Apple Music.'); }
      report('Cari lagu', null, 'Mencari di Apple Music (' + region + ')…');
      const cached = matches.get(key);
      const list = cached ? [{ song: cached, score: 1 }] : await this.catalogMatch(query, region);
      if (!list.length) { misses.set(key, now()); report('Cari lagu', false, 'Tidak ada rekaman yang cocok di ' + region); throw new SourceError('matching', 'Tidak ada rekaman yang cocok di Apple Music.'); }
      const best = list[0];
      report('Cari lagu', true, best.song.title + ' · ' + best.song.artist + (list.length > 1 ? ' (' + list.length + ' salinan)' : ''));
      report('Stream', null, 'Membuka stream…');
      let problem = 'Tidak ada stream untuk lagu ini di ' + region;
      let problemKind = 'stream';
      for (const candidate of list.filter((item) => item.score >= best.score - 0.06).slice(0, 4)) {
        const attempt = await this.webPlayback(candidate.song, quality, query);
        if (attempt.stream) { matches.set(key, candidate.song); report('Stream', true, attempt.detail); return attempt.stream; }
        problem = attempt.reason; problemKind = attempt.kind;
      }
      report('Stream', false, problem);
      throw new SourceError(problemKind, problem);
    },
    async webPlayback(song, quality, query) {
      const bad = (reason, kind) => ({ reason, kind: kind || 'stream' });
      const body = JSON.stringify({ salableAdamId: song.id, language: 'en-US' });
      let response;
      try { response = await call(WEB_PLAYBACK, { method: 'POST', headers: { ...appleHeaders, 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await developerToken()), 'Media-User-Token': userToken() }, body }); } catch (error) { return bad('Apple Music tidak terjangkau', 'network'); }
      if (response.status === 401 || response.status === 403) return bad('Apple menolak sesi ini (' + response.status + ')', 'auth');
      if (response.status < 200 || response.status >= 300) return bad('Web playback menjawab ' + response.status);
      const answer = jsonOf(response.body);
      const entry = Array.isArray(answer.songList) ? answer.songList[0] : undefined;
      if (!isObject(entry)) return bad(str(answer.customerMessage) || 'Web playback tidak punya stream untuk lagu ini');
      const assets = (Array.isArray(entry.assets) ? entry.assets : []).filter(isObject);
      const wanted = quality === 'he64' ? 'ctrp64' : 'ctrp256';
      const asset = assets.find((a) => (str(a.flavor) || '').endsWith(wanted)) || assets.find((a) => (str(a.flavor) || '').includes('ctrp'));
      if (!asset) return bad('Web playback hanya menawarkan ' + assets.map((a) => str(a.flavor)).filter(Boolean).join(', '));
      const url = str(asset.URL);
      if (!url || !allowedMediaUrl(url)) return bad('Alamat stream tidak dikenal');
      let media;
      try { media = await call(url, { headers: appleHeaders }); } catch (error) { return bad('Playlist stream tidak terjangkau', 'network'); }
      if (media.status !== 200) return bad('Playlist web playback menjawab ' + media.status);
      const text = media.body.toString('utf8');
      const key = legacyKey(text);
      if (!key) return bad('Stream tidak punya kunci Widevine');
      const pssh = psshFor(key.keyId);
      const relay = (target) => '/api/source/media/' + put({ kind: 'media', url: target, headers: appleHeaders, apple: true });
      const manifest = rewriteLegacy(text, url, key.uri, pssh, relay);
      const flavor = str(asset.flavor) || '';
      const label = flavor.endsWith('ctrp256') ? 'AAC 256' : flavor.endsWith('ctrp64') ? 'HE-AAC 64' : 'AAC';
      const manifestToken = put({ kind: 'manifest', body: manifest });
      const licenseToken = put({ kind: 'license', songId: song.id, keyUri: key.uri, keyId: key.keyId });
      return {
        detail: label + ' · ' + segmentCount(manifest) + ' segmen',
        stream: {
          format: 'hls', path: '/api/source/manifest/' + manifestToken, mimeType: 'application/vnd.apple.mpegurl', codec: flavor.endsWith('ctrp64') ? 'HE-AAC' : 'AAC', qualityLabel: label, sourceLabel: 'Apple Music',
          drm: { system: 'com.widevine.alpha', licensePath: '/api/source/license/' + licenseToken },
          matched: { id: song.id, title: song.title, artist: song.artist, album: song.album, durationMs: song.durationMs, confidence: matcher.score(query, song) },
        },
      };
    },
  };

  const modules = { monochrome, applemusic: apple };
  const moduleOf = (id) => { const m = modules[id]; if (!m) throw new SourceError('matching', 'Sumber tidak dikenal.', 404); return m; };
  const cleanQuery = (q) => {
    if (!isObject(q) || typeof q.title !== 'string' || !q.title.trim() || q.title.length > 500) throw new SourceError('matching', 'Data lagu tidak valid.', 400);
    const artists = (Array.isArray(q.artists) ? q.artists : []).filter((a) => typeof a === 'string' && a.length <= 300).slice(0, 10);
    return { title: q.title.trim(), artists, album: str(q.album), durationMs: Number.isFinite(q.durationMs) && q.durationMs > 0 ? q.durationMs : undefined, isrc: typeof q.isrc === 'string' && /^[A-Za-z0-9]{8,16}$/.test(q.isrc) ? q.isrc : undefined };
  };
  const cleanPicks = (p) => { const out = {}; if (isObject(p)) for (const k of ['quality', 'region']) if (typeof p[k] === 'string' && /^[a-z0-9]{2,10}$/.test(p[k])) out[k] = p[k]; return out; };
  const failure = (error) => {
    if (error instanceof SourceError) return { result: error.kind === 'matching' ? 'notFound' : 'unavailable', kind: error.kind, reason: error.message };
    return { result: 'unavailable', kind: 'network', reason: 'Sumber tidak terjangkau.' };
  };

  return {
    /** Same public catalog/editorial assets as Android; credentials stay service-side. */
    async canvas(track, signal) {
      const {matches:exactMatch}=require('./canvas.cjs');
      const query=enc(track.title+' '+track.artist);
      const response=await appleApi('/v1/catalog/us/search?term='+query+'&types=songs&limit=8&extend=editorialVideo&include=albums',signal);
      if(response.status!==200)return null;
      const songs=jsonOf(response.body).results?.songs?.data || [];
      for(const song of songs){
        const a=song.attributes || {};
        if(!exactMatch(track,a.name,[a.artistName]))continue;
        const albums=song.relationships?.albums?.data || [];
        const assets=[a];
        for(const album of albums.slice(0,2)){
          if(album.attributes)assets.push(album.attributes);
          if(!/^\d+$/.test(album.id)||signal?.aborted)continue;
          const detail=await appleApi('/v1/catalog/us/albums/'+album.id+'?extend=editorialVideo',signal);
          if(detail.status===200)assets.push(...(jsonOf(detail.body).data || []).map(v=>v.attributes || {}));
        }
        for(const asset of assets){
          for(const name of ['motionDetailSquare','motionSquareVideo1x1','motionDetailRaw']){
            const motion=asset.editorialVideo?.[name];
            const url=motion && (motion.video || motion.videoUrl || motion.hlsUrl || motion.url);
            if(typeof url==='string'&&allowedMediaUrl(url))return {result:'found',url,provider:'applemusic'};
          }
        }
      }
      return null;
    },
    /** What the screen may know: no tokens, no addresses. */
    status() {
      return { modules: Object.values(modules).map((m) => ({ id: m.info.id, name: m.info.name, description: m.info.description, needsAccount: m.info.needsAccount, account: m.account(), choices: m.choices })) };
    },
    async resolve(id, query, picks) {
      const m = moduleOf(id);
      try { return { result: 'found', stream: await m.resolve(cleanQuery(query), cleanPicks(picks), () => undefined) }; } catch (error) { if (error && error.status === 400) throw error; return failure(error); }
    },
    async diagnose(id, query, picks) {
      const m = moduleOf(id);
      const steps = [];
      const STEP_IDS = { Akun: 'account', 'Cari lagu': 'search', Stream: 'stream' };
      const report = (name, ok, detail) => { const at = steps.findIndex((s) => s.name === name); const step = { id: STEP_IDS[name] || name, name, ok, detail }; if (at >= 0) steps[at] = step; else steps.push(step); };
      let outcome;
      try { await m.resolve(cleanQuery(query), cleanPicks(picks), report); outcome = { result: 'found' }; } catch (error) { if (error && error.status === 400) throw error; outcome = failure(error); }
      return { ...outcome, steps };
    },
    async verify(id) { return moduleOf(id).verify ? moduleOf(id).verify(false) : { state: 'ready', label: '' }; },
    signOut(id) { moduleOf(id).signOut(); return moduleOf(id).account(); },
    setSession(id, session) { const m = moduleOf(id); if (!m.setSession) throw new SourceError('auth', 'Sumber ini tidak memakai akun.', 400); m.setSession(session); return m.account(); },
    /** Entries behind /api/source/*: media files to relay, the rewritten playlist, license requests. */
    entry: take,
    /** Trades a CDM challenge for a license, for the song the token was made for. Never returns anything but the license bytes. */
    async license(token, challenge) {
      const entry = take(token);
      if (!entry || entry.kind !== 'license') throw new SourceError('license', 'Permintaan lisensi kedaluwarsa.', 410);
      if (!userToken()) throw new SourceError('auth', 'Akun Apple Music belum terhubung.', 401);
      if (!Buffer.isBuffer(challenge) || challenge.length < 4 || challenge.length > 65536) throw new SourceError('license', 'Tantangan lisensi tidak valid.', 400);
      const body = JSON.stringify({ challenge: challenge.toString('base64'), 'key-system': 'com.widevine.alpha', uri: entry.keyUri, adamId: entry.songId, isLibrary: false, 'user-initiated': true });
      let response;
      try { response = await call(LICENSE, { method: 'POST', headers: { ...appleHeaders, 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await developerToken()), 'Media-User-Token': userToken() }, body }); } catch (error) { throw new SourceError('network', 'Server lisensi Apple tidak terjangkau.', 502); }
      if (response.status === 401 || response.status === 403) throw new SourceError('auth', 'Apple menolak sesi untuk lisensi (' + response.status + ').', 401);
      if (response.status < 200 || response.status >= 300) throw new SourceError('license', 'Server lisensi Apple menjawab ' + response.status + '.', 502);
      const answer = jsonOf(response.body);
      if (answer.status !== 0 || typeof answer.license !== 'string') {
        const message = str(answer.customerMessage) || 'status ' + answer.status;
        if (answer.status === -1002) { storage.set('applemusic.expired', message); throw new SourceError('auth', 'Apple menolak lisensi: ' + message, 401); }
        throw new SourceError('license', 'Apple menolak lisensi: ' + message, 502);
      }
      return Buffer.from(answer.license, 'base64');
    },
  };
}

/** Credentials and choices that must survive a restart, in a file only this service reads (0600, replaced atomically). */
function createFileStorage(fs, path, file) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); if (!isObject(data)) data = {}; } catch (error) { data = {}; }
  return {
    get: (key) => (typeof data[key] === 'string' ? data[key] : undefined),
    set(key, value) {
      if (value === null || value === undefined) delete data[key]; else data[key] = String(value);
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const temp = file + '.' + process.pid + '.tmp';
        fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
        fs.renameSync(temp, file);
      } catch (error) { /* a read-only disk keeps the value in memory for this run */ }
    },
  };
}
const createMemoryStorage = () => { const data = new Map(); return { get: (k) => data.get(k), set: (k, v) => { if (v === null || v === undefined) data.delete(k); else data.set(k, String(v)); } }; };

module.exports = { createSources, createFileStorage, createMemoryStorage, SourceError, KINDS, allowedSourceUrl, allowedMediaUrl, flacInfo, legacyKey, psshFor, rewriteLegacy, jwtExpiryMs };
