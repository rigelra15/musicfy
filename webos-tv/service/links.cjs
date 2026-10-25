'use strict';
// Reads a public playlist or album from a share link, without logging in. Port of the Android
// LinkImporter: each source reads what its own web page shows a logged-out visitor (Spotify's embed
// page, Apple Music's page data, Deezer's public API), so private playlists are not reachable. The
// pages and hosts are fixed here; the person only supplies the link, which is parsed, never fetched
// as given. YouTube links are read by the catalog, not here (their ids are exact).

const SPOTIFY = /(?:open\.spotify\.com\/(?:intl-[a-zA-Z-]+\/)?(?:embed\/)?|spotify:)(playlist|album)[/:]([A-Za-z0-9]{22})/;
const APPLE = /music\.apple\.com\/([a-z]{2})\/(playlist|album)\/(?:[^/?#]+\/)?(pl\.[A-Za-z0-9-]+|\d+)/;
const DEEZER = /deezer\.com\/(?:[a-z]{2}\/)?(playlist|album)\/(\d+)/;
const SHORT = ['spotify.link', 'spotify.app.link', 'deezer.page.link', 'link.deezer.com'];
const SPOTIFY_EMBED_LIMIT = 100;

class LinkError extends Error {
  constructor(kind, message, status) { super(message); this.name = 'LinkError'; this.kind = kind; this.status = status; }
}

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const asArray = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const num = (v) => (Number.isFinite(v) && v > 0 ? v : undefined);
const path = (value, ...keys) => { let cur = value; for (const key of keys) { if (!isObject(cur) && !Array.isArray(cur)) return undefined; cur = cur[key]; } return cur; };

/** Which service a pasted link belongs to. */
function detect(link) {
  const text = String(link || '').trim();
  if (text.includes('spotify')) return 'spotify';
  if (text.includes('music.apple.com')) return 'applemusic';
  if (text.includes('deezer')) return 'deezer';
  if (text.includes('youtube.com') || text.includes('youtu.be')) return 'youtube';
  return undefined;
}

/** Share sheets paste "Lihat playlist ini! https://…": take just the address. */
function extractUrl(text) {
  const value = String(text || '').trim();
  if (value.startsWith('spotify:')) return value;
  const found = /https?:\/\/\S+/.exec(value);
  return found ? found[0].replace(/[.,)"']+$/, '') : undefined;
}

// ---- where each source may be read ---------------------------------------------------------------

const PAGES = {
  'open.spotify.com': /^\/embed\/(playlist|album)\/[A-Za-z0-9]{22}$/,
  'music.apple.com': /^\/[a-z]{2}\/(playlist|album)\/(?:[^/?#]+\/)?(pl\.[A-Za-z0-9-]+|\d+)$/,
  'api.deezer.com': /^\/(playlist|album)\/\d+(?:\/tracks)?$/,
};
function allowedLinkUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && Boolean(PAGES[url.hostname] && PAGES[url.hostname].test(url.pathname));
  } catch (error) { return false; }
}
/** Short links may only redirect to the pages above (or other share hosts), nothing else. */
function allowedShortHop(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    return SHORT.includes(url.hostname) || url.hostname === 'open.spotify.com' || url.hostname === 'www.deezer.com' || url.hostname === 'deezer.com' || url.hostname === 'music.apple.com' || url.hostname === 'www.deezer.page.link';
  } catch (error) { return false; }
}

// ---- parsers ---------------------------------------------------------------------------------------

function parseSpotifyEmbed(html, type) {
  const found = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!found) throw new LinkError('changed', 'Spotify mengubah halamannya. Pakai CSV TuneMyMusic dulu.', 502);
  let data;
  try { data = JSON.parse(found[1]); } catch (error) { throw new LinkError('changed', 'Spotify mengubah halamannya. Pakai CSV TuneMyMusic dulu.', 502); }
  const entity = path(data, 'props', 'pageProps', 'state', 'data', 'entity');
  if (!isObject(entity)) throw new LinkError('private', 'Spotify ' + type + ' itu privat atau tidak ada.', 404);
  const name = str(entity.name) || str(entity.title) || 'Spotify ' + type;
  const tracks = asArray(entity.trackList).flatMap((item) => {
    const title = isObject(item) ? str(item.title) : undefined;
    if (!title) return [];
    return [{ title, artist: (str(item.subtitle) || '').replace(/ /g, ' '), ...(type === 'album' ? { album: name } : {}), ...(num(item.duration) ? { durationMs: item.duration } : {}) }];
  });
  if (!tracks.length) throw new LinkError('empty', 'Spotify ' + type + ' itu tidak punya lagu yang bisa dibaca.', 422);
  const warnings = [];
  if (type === 'playlist' && tracks.length >= SPOTIFY_EMBED_LIMIT) warnings.push('Spotify hanya membagikan ' + SPOTIFY_EMBED_LIMIT + ' lagu pertama sebuah playlist lewat tautan. Untuk playlist utuh, pakai CSV TuneMyMusic.');
  const cover = asArray(path(entity, 'coverArt', 'sources')).filter(isObject).sort((a, b) => (num(b.width) || 0) - (num(a.width) || 0))[0];
  return { name, tracks, warnings, cover: cover && str(cover.url) };
}

function parseApplePage(html, type) {
  const found = /<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!found) throw new LinkError('changed', 'Apple Music mengubah halamannya. Pakai CSV TuneMyMusic dulu.', 502);
  let root;
  try { root = JSON.parse(found[1]); } catch (error) { throw new LinkError('changed', 'Apple Music mengubah halamannya. Pakai CSV TuneMyMusic dulu.', 502); }
  const page = path(asArray(path(root, 'data'))[0], 'data') || path(asArray(root)[0], 'data');
  if (!isObject(page)) throw new LinkError('private', 'Apple Music ' + type + ' itu privat atau tidak ada.', 404);
  const sections = asArray(page.sections).filter(isObject);
  const header = (() => { const s = sections.find((x) => x.itemKind === 'containerDetailHeaderLockup'); return s && isObject(asArray(s.items)[0]) ? asArray(s.items)[0] : undefined; })();
  const name = (header && str(header.title)) || 'Apple Music ' + type;
  const albumArtist = header && str(path(asArray(header.subtitleLinks)[0], 'title'));
  const declared = header && num(header.trackCount);
  const tracks = sections.filter((s) => s.itemKind === 'trackLockup').flatMap((s) => asArray(s.items)).flatMap((item) => {
    const title = isObject(item) ? str(item.title) : undefined;
    if (!title) return [];
    const artists = asArray(item.subtitleLinks).map((l) => str(path(l, 'title'))).filter(Boolean);
    const album = type === 'album' ? name : str(path(asArray(item.tertiaryLinks)[0], 'title'));
    return [{ title, artist: str(item.artistName) || artists.join(', ') || albumArtist || '', ...(album ? { album } : {}), ...(num(item.duration) ? { durationMs: item.duration } : {}) }];
  });
  if (!tracks.length) throw new LinkError('empty', 'Apple Music ' + type + ' itu tidak punya lagu yang bisa dibaca.', 422);
  const warnings = [];
  if (declared && declared > tracks.length) warnings.push('Halaman Apple Music hanya menampilkan ' + tracks.length + ' dari ' + declared + ' lagu. Untuk playlist utuh, pakai CSV TuneMyMusic.');
  const template = str(path(header, 'artwork', 'dictionary', 'url'));
  const cover = template && template.replace('{w}', '600').replace('{h}', '600').replace('{c}', 'bb').replace('{f}', 'jpg');
  return { name, tracks, warnings, cover: cover && cover.startsWith('https://') ? cover : undefined };
}

/** `http(url)` answers `{status, body: string, finalUrl?}` for allowed addresses only. */
async function fetchLink(link, http) {
  const url = extractUrl(link);
  if (!url) throw new LinkError('badLink', 'Itu tidak terlihat seperti tautan.', 400);
  let resolved = url;
  if (SHORT.some((host) => url.includes(host))) resolved = await resolveShort(url, http);
  const source = detect(resolved) || detect(url);
  if (source === 'youtube') throw new LinkError('badLink', 'Tautan YouTube dibaca langsung oleh aplikasi, bukan layanan.', 400);
  if (!source) throw new LinkError('badLink', 'Tempel tautan Spotify, Apple Music, Deezer, atau YouTube Music.', 400);

  const get = async (target, what) => {
    if (!allowedLinkUrl(target)) throw new LinkError('badLink', 'Tautan ' + what + ' tidak dikenali.', 400);
    let response;
    try { response = await http(target); } catch (error) { throw new LinkError('network', 'Tidak bisa menghubungi server. Periksa koneksi.', 502); }
    if (response.status >= 200 && response.status < 300) return response.body;
    if (response.status === 404) throw new LinkError('private', what + ' tidak ditemukan. Apakah publik?', 404);
    if (response.status === 429) throw new LinkError('rateLimited', what + ' sedang membatasi permintaan. Coba lagi semenit lagi.', 429);
    throw new LinkError('upstream', what + ' menjawab dengan galat (' + response.status + ').', 502);
  };

  if (source === 'spotify') {
    const m = SPOTIFY.exec(resolved);
    if (!m) throw new LinkError('badLink', 'Tempel tautan playlist atau album Spotify.', 400);
    const parsed = parseSpotifyEmbed(await get('https://open.spotify.com/embed/' + m[1] + '/' + m[2], 'Spotify'), m[1]);
    return { source, kind: m[1], remoteId: m[2], url: 'https://open.spotify.com/' + m[1] + '/' + m[2], ...parsed };
  }
  if (source === 'applemusic') {
    const m = APPLE.exec(resolved);
    if (!m) throw new LinkError('badLink', 'Tempel tautan playlist atau album Apple Music.', 400);
    const page = resolved.split('#')[0].split('?')[0];
    const parsed = parseApplePage(await get(page, 'Apple Music'), m[2]);
    return { source, kind: m[2], remoteId: m[3], url: page, ...parsed };
  }
  const m = DEEZER.exec(resolved);
  if (!m) throw new LinkError('badLink', 'Tempel tautan playlist atau album Deezer.', 400);
  const [, type, id] = m;
  const json = async (target) => {
    let body; try { body = JSON.parse(await get(target, 'Deezer')); } catch (error) { if (error instanceof LinkError) throw error; throw new LinkError('upstream', 'Deezer mengirim sesuatu yang tidak bisa dibaca.', 502); }
    if (isObject(body) && body.error) {
      const message = str(path(body, 'error', 'message'));
      throw new LinkError('private', message && /no data/i.test(message) ? 'Playlist Deezer itu privat atau tidak ada.' : 'Deezer: ' + (message || 'galat tidak dikenal'), 404);
    }
    return isObject(body) ? body : {};
  };
  const info = await json('https://api.deezer.com/' + type + '/' + id);
  const name = str(info.title) || 'Deezer ' + type;
  const tracks = [];
  let next = 'https://api.deezer.com/' + type + '/' + id + '/tracks?limit=100';
  for (let pageNo = 0; next && pageNo < 100; pageNo += 1) {
    const page = await json(next);
    asArray(page.data).forEach((item) => {
      const title = isObject(item) ? str(item.title) : undefined;
      if (!title) return;
      const album = type === 'album' ? name : str(path(item, 'album', 'title'));
      tracks.push({ title, artist: str(path(item, 'artist', 'name')) || '', ...(album ? { album } : {}), ...(num(item.duration) ? { durationMs: item.duration * 1000 } : {}) });
    });
    next = typeof page.next === 'string' && page.next.startsWith('https://api.deezer.com/') ? page.next : undefined;
  }
  const total = num(info.nb_tracks);
  if (!tracks.length) throw new LinkError('empty', 'Deezer ' + type + ' itu tidak punya lagu yang bisa dibaca.', 422);
  return { source, kind: type, remoteId: id, url: 'https://www.deezer.com/' + type + '/' + id, name, tracks, warnings: total && total > tracks.length ? ['Deezer hanya mengirim ' + tracks.length + ' dari ' + total + ' lagu.'] : [], cover: str(info.picture_xl) || str(info.cover_xl) };
}

async function resolveShort(url, http) {
  let current = url;
  for (let hop = 0; hop < 4; hop += 1) {
    if (!allowedShortHop(current)) throw new LinkError('badLink', 'Tautan pendek itu mengarah ke tempat yang tidak dikenal.', 400);
    let response;
    try { response = await http(current, { manual: true }); } catch (error) { throw new LinkError('network', 'Tidak bisa menghubungi server. Periksa koneksi.', 502); }
    if (response.status >= 300 && response.status < 400 && response.location) { current = new URL(response.location, current).href; if (!SHORT.includes(new URL(current).hostname) || hop === 3) return current; continue; }
    const body = String(response.body || '');
    const s = SPOTIFY.exec(body); if (s) return 'https://open.spotify.com/' + s[1] + '/' + s[2];
    const d = DEEZER.exec(body); if (d) return 'https://www.deezer.com/' + d[1] + '/' + d[2];
    return current;
  }
  return current;
}

module.exports = { fetchLink, detect, extractUrl, allowedLinkUrl, allowedShortHop, parseSpotifyEmbed, parseApplePage, LinkError, SPOTIFY_EMBED_LIMIT };
