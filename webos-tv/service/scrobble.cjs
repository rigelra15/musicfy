'use strict';
// Last.fm / Libre.fm scrobbling (port of the Android Scrobbler + Audioscrobbler client). Everything
// secret lives here: the API keys and shared secrets (from the environment or a file the service
// reads), the account session keys, and the queue of plays still to send. The screen only ever
// sees account names and counts. Every play is queued before it is sent, so nothing is lost
// offline; Now Playing is sent straight out and never queued.

const crypto = require('crypto');

const SITES = {
  lastfm: { label: 'Last.fm', apiRoot: 'https://ws.audioscrobbler.com/2.0/', authPage: 'https://www.last.fm/api/auth/', env: 'LASTFM', profile: 'https://www.last.fm/user/' },
  librefm: { label: 'Libre.fm', apiRoot: 'https://libre.fm/2.0/', authPage: 'https://www.libre.fm/api/auth/', env: 'LIBREFM', profile: 'https://libre.fm/user/' },
};
const MAX_BATCH = 50;
const MAX_PLAYS = 5000;
const MAX_AGE_SECONDS = 14 * 24 * 60 * 60;
const STATE_KEY = 'scrobble.state';
// Last.fm error codes (see the API docs), as the Android client reads them.
const INVALID_TOKEN = 4; const INVALID_PARAMETERS = 6; const INVALID_RESOURCE = 7; const INVALID_SESSION = 9; const TOKEN_NOT_AUTHORIZED = 14; const TOKEN_EXPIRED = 15;
const SERVER_ERROR = -1;

class ScrobbleError extends Error {
  constructor(kind, message, status, code) { super(message); this.name = 'ScrobbleError'; this.kind = kind; this.status = status; this.code = code; }
}

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/** The signature the API asks for: parameters sorted by name and joined, the secret added, then MD5. `format` stays out of it. */
function sign(params, secret) {
  return crypto.createHash('md5').update(Object.keys(params).sort().map((key) => key + params[key]).join('') + secret, 'utf8').digest('hex');
}

function allowedScrobbleUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') &&
      ((url.hostname === 'ws.audioscrobbler.com' && url.pathname === '/2.0/') || (url.hostname === 'libre.fm' && url.pathname === '/2.0/'));
  } catch (error) { return false; }
}

/** `trackKeys` of a scrobbled song as the services want it: the first artist only, since "A, B" would become an artist of its own. */
function cleanTrack(input) {
  if (!isObject(input)) return undefined;
  const artist = text(input.artist, 300); const track = text(input.track, 300);
  if (!artist || !track) return undefined;
  const album = text(input.album, 300);
  const duration = Number.isFinite(input.durationSeconds) && input.durationSeconds > 0 ? Math.round(input.durationSeconds) : undefined;
  return { artist, track, ...(album ? { album } : {}), ...(duration ? { durationSeconds: duration } : {}) };
}

/**
 * `http(url, {method, body})` answers `{status, body: string}`. `keys` is `{lastfm: {key, secret}, librefm: {...}}` (a site
 * without both is "not configured" and cannot sign in). `storage` is the service's key/value file.
 */
function createScrobbler({ http, storage, keys = {}, now = Date.now, retryMs = 60_000, setTimer = setTimeout }) {
  let state = { sites: {}, queue: [] };
  try { const raw = JSON.parse(storage.get(STATE_KEY) || '{}'); if (isObject(raw)) state = { sites: isObject(raw.sites) ? raw.sites : {}, queue: Array.isArray(raw.queue) ? raw.queue : [] }; } catch (error) { /* start again */ }
  const tokens = new Map();                                     // request tokens live only in memory
  let sending = null; let timer = null; let backoff = retryMs;
  const save = () => storage.set(STATE_KEY, JSON.stringify(state));
  const configured = (id) => Boolean(keys[id] && keys[id].key && keys[id].secret);
  const session = (id) => (isObject(state.sites[id]) && state.sites[id].session ? state.sites[id] : undefined);

  async function call(id, method, params = {}, sessionKey) {
    const site = SITES[id];
    if (!site || !configured(id)) throw new ScrobbleError('notConfigured', (site ? site.label : String(id)) + ' belum diatur di layanan TV ini (kunci API tidak ada).', 503);
    const signed = { method, api_key: keys[id].key, ...(sessionKey ? { sk: sessionKey } : {}), ...params };
    const body = new URLSearchParams({ ...signed, api_sig: sign(signed, keys[id].secret), format: 'json' }).toString();
    let response;
    try { response = await http(site.apiRoot, { method: 'POST', body }); } catch (error) { throw new ScrobbleError('network', 'Tidak bisa menghubungi ' + site.label + '.', 502, SERVER_ERROR); }
    let json; try { json = JSON.parse(response.body); } catch (error) { json = undefined; }
    if (isObject(json) && json.error !== undefined) {
      const code = Number(json.error); const c = Number.isFinite(code) ? code : SERVER_ERROR;
      throw new ScrobbleError(c === INVALID_SESSION ? 'signedOut' : c === INVALID_PARAMETERS || c === INVALID_RESOURCE ? 'rejected' : c === TOKEN_NOT_AUTHORIZED ? 'waiting' : c === TOKEN_EXPIRED || c === INVALID_TOKEN ? 'tokenExpired' : 'upstream', typeof json.message === 'string' ? json.message : 'Galat ' + c, 502, c);
    }
    if (response.status < 200 || response.status >= 300 || !isObject(json)) throw new ScrobbleError('upstream', site.label + ' menjawab dengan galat (' + response.status + ').', 502, SERVER_ERROR);
    return json;
  }

  function signedOut(id) {
    delete state.sites[id];
    state.queue = state.queue.map((play) => ({ ...play, sites: play.sites.filter((s) => s !== id) })).filter((play) => play.sites.length);
    save();
  }

  const activeSites = (includePaused) => Object.keys(SITES).filter((id) => session(id) && (includePaused || state.sites[id].enabled !== false));

  function status() {
    return {
      sites: Object.keys(SITES).map((id) => ({ id, label: SITES[id].label, configured: configured(id), signedIn: Boolean(session(id)), username: session(id) ? session(id).username : undefined, enabled: session(id) ? state.sites[id].enabled !== false : false, profileUrl: session(id) ? SITES[id].profile + encodeURIComponent(session(id).username) : undefined })),
      pending: state.queue.length,
    };
  }

  /** First step of signing in: a token, and the page the person opens (on a phone, from the QR code) to allow Musicfy. */
  async function begin(id) {
    if (!SITES[id]) throw new ScrobbleError('badRequest', 'Layanan tidak dikenal.', 400);
    const json = await call(id, 'auth.getToken');
    const token = text(json.token, 100);
    if (!token) throw new ScrobbleError('upstream', 'Jawaban layanan tidak dikenali.', 502);
    tokens.set(id, token);
    return { authUrl: SITES[id].authPage + '?api_key=' + encodeURIComponent(keys[id].key) + '&token=' + encodeURIComponent(token) };
  }

  /** `{state: 'waiting'}` until the person has allowed Musicfy on the page, then `{state: 'signedIn', username}`. */
  async function finish(id) {
    const token = tokens.get(id);
    if (!SITES[id] || !token) throw new ScrobbleError('badRequest', 'Mulai masuk dulu.', 400);
    let json;
    try { json = await call(id, 'auth.getSession', { token }); } catch (error) {
      if (error instanceof ScrobbleError && error.kind === 'waiting') return { state: 'waiting' };
      if (error instanceof ScrobbleError && error.kind === 'tokenExpired') { tokens.delete(id); return { state: 'expired' }; }
      throw error;
    }
    const sessionInfo = isObject(json.session) ? json.session : {};
    const key = text(sessionInfo.key, 200); const name = text(sessionInfo.name, 100);
    if (!key || !name) throw new ScrobbleError('upstream', 'Jawaban layanan tidak dikenali.', 502);
    tokens.delete(id);
    state.sites[id] = { session: key, username: name, enabled: true };
    save();
    return { state: 'signedIn', username: name };
  }

  function signOut(id) { if (!SITES[id]) throw new ScrobbleError('badRequest', 'Layanan tidak dikenal.', 400); tokens.delete(id); signedOut(id); }
  function setEnabled(id, enabled) { if (!session(id)) throw new ScrobbleError('badRequest', 'Belum masuk.', 400); state.sites[id].enabled = Boolean(enabled); save(); }

  async function nowPlaying(input) {
    const track = cleanTrack(input);
    if (!track) return;
    for (const id of activeSites(false)) {
      try { await call(id, 'track.updateNowPlaying', trackParams(track, null), session(id).session); } catch (error) { if (error instanceof ScrobbleError && error.kind === 'signedOut') signedOut(id); /* nothing to keep: by the next try it is another song */ }
    }
  }

  function trackParams(track, index) {
    const suffix = index === null ? '' : '[' + index + ']';
    return { ['artist' + suffix]: track.artist, ['track' + suffix]: track.track, ...(track.album ? { ['album' + suffix]: track.album } : {}), ...(track.durationSeconds ? { ['duration' + suffix]: String(track.durationSeconds) } : {}) };
  }

  /** A play that counted, which started at `startedAt` (seconds since 1970). */
  function scrobble(input, startedAt) {
    const track = cleanTrack(input);
    const at = Number(startedAt);
    if (!track || !Number.isFinite(at) || at <= 0 || at > now() / 1000 + 300) throw new ScrobbleError('badRequest', 'Data scrobble tidak valid.', 400);
    if (at < now() / 1000 - MAX_AGE_SECONDS) return { queued: false, pending: state.queue.length };   // too old for any service to take
    const sites = activeSites(false);
    if (!sites.length) return { queued: false, pending: state.queue.length };
    state.queue.push({ track, startedAt: Math.floor(at), sites });
    while (state.queue.length > MAX_PLAYS) state.queue.shift();
    save();
    void flush();
    return { queued: true, pending: state.queue.length };
  }

  async function love(artist, trackName, loved) {
    const a = text(artist, 300); const t = text(trackName, 300);
    if (!a || !t) return;
    for (const id of activeSites(false)) {
      try { await call(id, loved ? 'track.love' : 'track.unlove', { artist: a, track: t }, session(id).session); } catch (error) { if (error instanceof ScrobbleError && error.kind === 'signedOut') signedOut(id); }
    }
  }

  /** Sends what is waiting, a batch at a time, until each service has it all or cannot take more right now. */
  function flush() {
    if (sending) return sending;
    sending = (async () => {
      let allSent = true;
      const oldest = now() / 1000 - MAX_AGE_SECONDS;
      state.queue = state.queue.filter((play) => play.startedAt >= oldest);
      for (const id of activeSites(true)) {
        for (;;) {
          const batch = state.queue.filter((play) => play.sites.includes(id)).slice(0, MAX_BATCH);
          if (!batch.length || !session(id)) break;
          const params = {};
          batch.forEach((play, index) => { Object.assign(params, trackParams(play.track, index)); params['timestamp[' + index + ']'] = String(play.startedAt); });
          const markSent = () => { for (const play of batch) play.sites = play.sites.filter((s) => s !== id); state.queue = state.queue.filter((play) => play.sites.length); save(); };
          try { await call(id, 'track.scrobble', params, session(id).session); markSent(); }
          catch (error) {
            if (error instanceof ScrobbleError && error.kind === 'signedOut') { signedOut(id); break; }
            // turned down for good (bad song data): dropped, or it would hold back every play after it
            if (error instanceof ScrobbleError && error.kind === 'rejected') { markSent(); continue; }
            allSent = false; break;
          }
        }
      }
      if (!allSent) { schedule(); } else { backoff = retryMs; }
      return allSent;
    })().finally(() => { sending = null; });
    return sending;
  }

  function schedule() {
    if (timer) return;
    timer = setTimer(() => { timer = null; void flush(); }, backoff);
    if (timer && timer.unref) timer.unref();
    backoff = Math.min(backoff * 2, 15 * 60_000);
  }

  if (state.queue.length) void flush();                         // what was left from last time goes out as soon as the service is back
  return { status, begin, finish, signOut, setEnabled, nowPlaying, scrobble, love, flush, configured };
}

/** API keys from the environment (`MUSICFY_LASTFM_API_KEY`/`_SECRET`, `MUSICFY_LIBREFM_...`) or from `scrobble-keys.json` beside the service's data. */
function loadKeys(env, readFile) {
  const out = {};
  let file = {};
  try { const raw = JSON.parse(readFile()); if (isObject(raw)) file = raw; } catch (error) { /* none */ }
  for (const id of Object.keys(SITES)) {
    const prefix = 'MUSICFY_' + SITES[id].env + '_';
    const key = env[prefix + 'API_KEY'] || (isObject(file[id]) ? file[id].key : undefined);
    const secret = env[prefix + 'SECRET'] || (isObject(file[id]) ? file[id].secret : undefined);
    if (typeof key === 'string' && typeof secret === 'string' && key && secret) out[id] = { key, secret };
  }
  return out;
}

module.exports = { createScrobbler, loadKeys, sign, allowedScrobbleUrl, cleanTrack, ScrobbleError, SITES, MAX_BATCH, MAX_AGE_SECONDS };
