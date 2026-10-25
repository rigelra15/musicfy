'use strict';

// These are the same source identities and HTTP contracts as Musicfy Android's providers/.
// The host supplies HTTPS transport so this module runs on webOS Node 16 and in development.
const providerDefinitions = [
  ['BetterLyrics', 'Apple Music', 'Third-party Better Lyrics service'],
  ['YouLyPlus', 'YouLyPlus'], ['Paxsenix', 'PaxSenix'], ['SimpMusic', 'SimpMusic'],
  ['LrcLib', 'LrcLib'], ['Deezer', 'Deezer'], ['YouTubeSubtitle', 'YouTube Subtitle'],
  ['YouTubeMusic', 'YouTube Music'], ['NetEase', 'NetEase'], ['QQMusic', 'QQ Music'],
  ['Kugou', 'KuGou'], ['YouTubeCaptions', 'YouTube Auto Captions', 'Speech recognition fallback'],
].map(([id, name, note]) => ({ id, name, ...(note ? { note } : {}) }));
const UA = 'Musicfy (+https://github.com/realidkroo/musicfy)';
const paths = {
  'lyrics-api.boidu.dev': /^\/getLyrics$/,
  'lyricsplus.prjktla.my.id': /^\/v2\/lyrics\/get$/,
  'lyricsplus.binimum.org': /^\/v2\/lyrics\/get$/,
  'lyrics.paxsenix.org': /^\/apple-music\/(search|lyrics)$/,
  'api-lyrics.simpmusic.org': /^\/v1\/[\w-]+$/,
  'musicfy-yt-music-server.onrender.com': /^\/v1\/[\w-]+$/,
  'lrclib.net': /^\/api\/search$/,
  'api.deezer.com': /^\/search$/,
  'auth.deezer.com': /^\/login\/anonymous$/,
  'pipe.deezer.com': /^\/api$/,
  'music.163.com': /^\/api\/(search\/get|song\/lyric)$/,
  'u.y.qq.com': /^\/cgi-bin\/musicu\.fcg$/,
  'mobileservice.kugou.com': /^\/api\/v3\/search\/song$/,
  'lyrics.kugou.com': /^\/(search|download)$/,
  'music.youtube.com': /^\/(youtubei\/v1\/(next|browse|player|get_transcript)|api\/timedtext)$/,
  'www.youtube.com': /^\/(youtubei\/v1\/player|api\/timedtext)$/,
  'youtube.com': /^\/api\/timedtext$/,
};
function allowedLyricsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && !!paths[url.hostname]?.test(url.pathname);
  } catch { return false; }
}
function endpoint(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params || {})) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  return url.toString();
}
const missing = (source) => ({ type: 'missing', source });
const plain = (text, source) => text?.trim() ? ({ type: 'plain', text: text.trim(), source }) : missing(source);
function decode(text) {
  return String(text || '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, entity) => {
    if (entity[0] === '#') {
      const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[entity.toLowerCase()] || all;
  });
}
function stamp(value) {
  const match = /^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(value);
  if (match) return Math.round(((Number(match[1] || 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000);
  if (/^\d+(?:\.\d+)?ms$/.test(value)) return Number(value.slice(0, -2));
  if (/^\d+(?:\.\d+)?s$/.test(value)) return Math.round(Number(value.slice(0, -1)) * 1000);
  // Apple TTML uses bare seconds below one minute, then minute:second clocks.
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.round(Number(value) * 1000);
  return undefined;
}
const unspaced = (text) => /[\u3040-\u30ff\u3400-\u9fff\u0e00-\u0e7f]/.test(text);
function joinWords(words) {
  return words.reduce((text, piece) => {
    const word = piece.trim();
    return !word ? text : text + (text && !/^[,.!?;:)\]}…'’]/.test(word) && !(unspaced(text.slice(-1)) && unspaced(word[0])) ? ' ' : '') + word;
  }, '');
}
function mergePieces(line) {
  const pieces = line.words?.filter((p) => p.text.trim() && Number.isFinite(p.startMs) && Number.isFinite(p.endMs));
  if (!pieces?.length) { delete line.words; return line; }
  const words = [];
  let cursor = 0, previousEnd = -1;
  for (const piece of pieces) {
    const text = piece.text.trim();
    const start = line.text.indexOf(text, cursor);
    const previous = words[words.length - 1];
    if (previous && start === previousEnd && !unspaced(text[0]) && !unspaced(line.text[start - 1])) {
      previous.text += text;
      previous.endMs = Math.max(previous.endMs, piece.endMs);
    } else words.push({ text, startMs: piece.startMs, endMs: Math.max(piece.startMs, piece.endMs) });
    cursor = start < 0 ? cursor : start + text.length;
    previousEnd = start < 0 ? -1 : cursor;
  }
  line.words = words;
  if (words.length !== pieces.length) line.syllables = pieces;
  return line;
}
function synced(lines, source) {
  lines = lines.filter((line) => Number.isFinite(line.timeMs) && line.timeMs >= 0 && line.text?.trim())
    .map((line) => ({ ...line, text: decode(line.text).trim() })).sort((a, b) => a.timeMs - b.timeMs);
  // Mobile repairs a source which dropped all word separators only with song-wide evidence.
  const spaced = lines.filter((l) => l.words?.length > 1 && !unspaced(l.text));
  const glued = spaced.filter((l) => !/\s/.test(l.text));
  const dropped = spaced.length >= 3 && glued.length * 5 >= spaced.length * 4 && glued.reduce((n, l) => n + l.words.length, 0) >= glued.length * 3;
  for (const line of lines) {
    if (dropped && line.words?.length > 1 && !/\s/.test(line.text) && !unspaced(line.text)) line.text = joinWords(line.words.map((w) => w.text));
    mergePieces(line);
  }
  return lines.length ? { type: 'synced', lines, source } : missing(source);
}
function parseLrc(raw, source) {
  if (!raw?.trim()) return missing(source);
  const lines = [], input = decode(raw).replace(/\\n/g, '\n').replace(/\\r/g, '\r').split(/\r?\n/);
  for (const inputLine of input) {
    const match = /^((?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+)(.*)$/.exec(inputLine.trim());
    if (!match) {
      const explicit = /^<(.+)>$/.exec(inputLine.trim());
      if (explicit && lines.length) {
        const words = explicit[1].split('|').map((w) => /^(.*):([\d.]+):([\d.]+)$/.exec(w)).filter(Boolean)
          .map((w) => ({ text: w[1], startMs: Number(w[2]) * 1000, endMs: Number(w[3]) * 1000 }));
        if (words.length) lines[lines.length - 1].words = words;
      }
      continue;
    }
    const times = Array.from(match[1].matchAll(/\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g), (m) => Number(m[1]) * 60000 + Number(m[2]) * 1000 + Number((m[3] || '').padEnd(3, '0')));
    let text = match[2];
    const agent = /\{agent:([^}]+)\}/.exec(text)?.[1];
    const isBackground = /\{bg\}/.test(text);
    text = text.replace(/\{(?:agent:[^}]+|bg)\}/g, '');
    const pieces = Array.from(text.matchAll(/<(\d{1,3}):(\d{2})\.(\d{2,3})>([^<]*)/g), (m) => ({ text: m[4], startMs: Number(m[1]) * 60000 + Number(m[2]) * 1000 + Number(m[3].padEnd(3, '0')) }));
    text = text.replace(/<\d{1,3}:\d{2}\.\d{2,3}>/g, '').trim();
    for (const timeMs of times) lines.push({ timeMs, text, ...(agent ? { agent } : {}), ...(isBackground ? { isBackground } : {}), ...(pieces.length ? { words: pieces.map((p, i) => ({ ...p, endMs: pieces[i + 1]?.startMs ?? p.startMs })) } : {}) });
  }
  // A last onset-only piece has no supplied end: keep its end equal to its start, never invent it.
  return lines.length ? synced(lines, source) : plain(raw, source);
}

// Small non-validating XML reader: no external entities, network, DTD expansion or executable XML.
function xmlTree(xml) {
  const root = { name: 'root', attrs: {}, children: [] }, stack = [root];
  for (const token of xml.match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>|[^<]+/g) || []) {
    if (token.startsWith('<!--') || /^<\?|^<![^[]/.test(token)) continue;
    if (token.startsWith('<![CDATA[')) { stack[stack.length - 1].children.push(token.slice(9, -3)); continue; }
    if (token.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
    if (token.startsWith('<')) {
      const name = /^<([^\s/>]+)/.exec(token)?.[1];
      if (!name) continue;
      const attrs = {};
      for (const m of token.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[m[1].split(':').pop()] = decode(m[2] ?? m[3]);
      const node = { name: name.split(':').pop(), attrs, children: [] };
      stack[stack.length - 1].children.push(node);
      if (!token.endsWith('/>')) stack.push(node);
    } else stack[stack.length - 1].children.push(decode(/^[\s]*[\r\n][\s]*$/.test(token) ? '' : token.replace(/[\r\n]+/g, '')));
  }
  return root;
}
function parseTtml(raw, source) {
  if (!raw || raw.length > 2 * 1024 * 1024) return missing(source);
  const lines = [];
  const hidden = (n) => /x-(translation|roman)/.test(n.attrs?.role || '');
  const isBg = (n) => /x-bg/.test(n.attrs?.role || '');
  const textOf = (n, includeBg) => typeof n === 'string' ? n : hidden(n) || (!includeBg && isBg(n)) ? '' : n.name === 'br' ? '\n' : n.children.map((c) => textOf(c, includeBg)).join('');
  function makeLine(node, inheritedTime, agent, background) {
    const words = [];
    function collect(n) {
      if (typeof n === 'string' || hidden(n) || (isBg(n) && !background)) return;
      const startMs = stamp(n.attrs.begin || ''), end = stamp(n.attrs.end || ''), duration = stamp(n.attrs.dur || '');
      const endMs = end ?? (startMs !== undefined && duration !== undefined ? startMs + duration : undefined);
      const nestedTimed = n.children.some((c) => typeof c !== 'string' && stamp(c.attrs.begin || '') !== undefined);
      if (n.name === 'span' && startMs !== undefined && endMs !== undefined && !nestedTimed) words.push({ text: textOf(n, background), startMs, endMs });
      else n.children.forEach(collect);
    }
    node.children.forEach(collect);
    const timeMs = stamp(node.attrs.begin || '') ?? words[0]?.startMs ?? inheritedTime;
    if (timeMs !== undefined) lines.push({ timeMs, text: textOf(node, background), ...(agent ? { agent } : {}), ...(background ? { isBackground: true } : {}), ...(words.length ? { words } : {}) });
  }
  function walk(node, time, agent) {
    if (typeof node === 'string' || hidden(node)) return;
    time = stamp(node.attrs.begin || '') ?? time;
    agent = node.attrs.agent || agent;
    if (node.name === 'p') {
      makeLine(node, time, agent, false);
      function backgrounds(n) {
        if (typeof n === 'string') return;
        if (isBg(n)) makeLine(n, time, undefined, true);
        else n.children.forEach(backgrounds);
      }
      node.children.forEach(backgrounds);
    } else node.children.forEach((child) => walk(child, time, agent));
  }
  walk(xmlTree(raw));
  return synced(lines, source);
}
function parseYrc(raw, source) {
  const lines = [];
  for (const line of (raw || '').split('\n')) {
    const m = /^\[(\d+),\d+\](.*)$/.exec(line.trim());
    if (!m) continue;
    const words = Array.from(m[2].matchAll(/\((\d+),(\d+),-?\d+\)(.*?)(?=\(\d+,\d+,-?\d+\)|$)/g), (w) => ({ text: w[3], startMs: Number(w[1]), endMs: Number(w[1]) + Number(w[2]) }));
    lines.push({ timeMs: Number(m[1]), text: words.map((w) => w.text).join(''), words });
  }
  return synced(lines, source);
}
function withoutCredits(doc) {
  if (doc.type !== 'synced') return doc;
  const credit = (line) => /^[^:：]{1,24}[:：].+$/.test(line.text) && line.text.split(/[:：]/)[0].split(' ').length <= 4;
  let head = 0;
  doc.lines.slice(0, 15).forEach((line, i) => { if (credit(line)) head = i + 1; });
  let lines = doc.lines.slice(head);
  const tailStart = Math.max(0, lines.length - 6), tail = lines.slice(tailStart).findIndex(credit);
  if (tail >= 0) lines = lines.slice(0, tailStart + tail);
  return lines.some((l) => l.text.includes('纯音乐')) ? missing(doc.source) : synced(lines, doc.source);
}
function normalize(value) { return String(value || '').replace(/\s*[(（\[【「『《].*?[)）\]】」』》]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }
function bestMatch(candidates, track, tolerance = 8) {
  const title = normalize(track.title), artist = normalize(track.artist), seconds = track.durationMs / 1000;
  return candidates.filter((c) => seconds <= 0 || Math.abs(c.duration - seconds) <= tolerance).map((c) => {
    const titleScore = Math.max(0, ...c.titles.map(normalize).filter(Boolean).map((t) => t === title ? 2 : t.includes(title) || title.includes(t) ? 1 : 0));
    const artistScore = c.artists.map(normalize).some((a) => a && (artist.includes(a) || a.includes(artist))) ? 2 : 0;
    return { ...c, score: titleScore ? titleScore + artistScore : 0 };
  }).filter((c) => c.score > 0).sort((a, b) => b.score - a.score)[0]?.ref;
}
const cleanTitle = (title) => title.replace(/\s*\([^)]*(?:official|video|audio|lyric|visualizer|hd|hq|4k|remaster|remix|live|acoustic|version|edit|extended|radio|clean|explicit|feat\.|ft\.)[^)]*\)|\s*\[[^\]]*(?:official|video|audio|lyric|hd|hq|remaster|live)[^\]]*\]|\s*【.*?】|\s*\|.*$|\s*-\s*(?:official|video|audio|lyric|visualizer).*$|\s*(?:feat\.|ft\.).*$/gi, '').trim();
const cleanArtist = (artist) => artist.split(/ & | and |, | x | feat\.? | ft\.? | featuring | with /i)[0].trim();
function bestDoc(docs, source) {
  return docs.filter((d) => d && d.type !== 'missing').sort((a, b) => quality(b) - quality(a))[0] || missing(source);
}
function quality(doc) { return doc.type !== 'synced' ? doc.type === 'plain' ? 1 : 0 : doc.lines.some((l) => l.words?.length) ? 3 : 2; }
const clients = {
  WEB: { clientName: 'WEB', clientVersion: '2.20260708.00.00' },
  WEB_REMIX: { clientName: 'WEB_REMIX', clientVersion: '1.20260707.12.00' },
  ANDROID_VR: { clientName: 'ANDROID_VR', clientVersion: '1.61.48' },
  IOS: { clientName: 'IOS', clientVersion: '21.03.1', osVersion: '18.2.22C152' },
};
function findValue(root, key) {
  if (!root || typeof root !== 'object') return undefined;
  if (root[key]) return root[key];
  for (const value of Object.values(root)) { const found = findValue(value, key); if (found) return found; }
  return undefined;
}
async function lookupLyrics(source, track, request) {
  if (!providerDefinitions.some((p) => p.id === source)) throw new Error('Unknown lyrics source');
  if (!track || typeof track.id !== 'string' || typeof track.title !== 'string' || typeof track.artist !== 'string' || !Number.isFinite(track.durationMs)) throw new Error('Invalid lyrics track');
  const duration = Math.round(track.durationMs / 1000), title = cleanTitle(track.title), artist = cleanArtist(track.artist);
  async function json(url, options = {}) {
    if (!allowedLyricsUrl(url)) throw new Error('Lyrics endpoint not allowed');
    const response = await request(url, { ...options, headers: { 'User-Agent': UA, Accept: 'application/json', ...options.headers } });
    if (response.status === 404) return null;
    if (response.status < 200 || response.status >= 300) throw new Error(`${providerDefinitions.find((p) => p.id === source).name} unavailable (HTTP ${response.status})`);
    try { return JSON.parse(response.body); } catch { throw new Error('Source returned an invalid response'); }
  }
  const get = (url, params, headers) => json(endpoint(url, params), { headers });
  const post = (url, body, headers) => json(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const lrc = (text) => parseLrc(text, source);
  if (source === 'BetterLyrics') {
    const data = await get('https://lyrics-api.boidu.dev/getLyrics', { s: track.title, a: track.artist, d: duration > 0 ? duration : undefined, al: track.album });
    return parseTtml(data?.ttml, source);
  }
  if (source === 'YouLyPlus') {
    const attempts = await Promise.allSettled(['https://lyricsplus.prjktla.my.id', 'https://lyricsplus.binimum.org'].map(async (base) => {
      const data = await get(base + '/v2/lyrics/get', { title: track.title, artist: track.artist, duration, album: track.album, id: track.id });
      if (!data) return missing(source);
      if (data.syncedLyrics?.trim()) return lrc(data.syncedLyrics);
      if (data.lyrics?.length) return synced(data.lyrics.map((line) => {
        const pieces = line.syllabus || [], spaced = pieces.slice(0, -1).some((p) => /\s$/.test(p.text || ''));
        const words = pieces.filter((p) => Number.isFinite(p.time)).map((p, i) => ({ text: (p.text || '') + (!spaced && i < pieces.length - 1 && !/\s$/.test(p.text || '') ? ' ' : ''), startMs: p.time, endMs: Number.isFinite(p.duration) ? p.time + p.duration : pieces[i + 1]?.time ?? p.time }));
        const isBackground = pieces.some((p) => p.isBackground);
        return { timeMs: line.time, text: words.length ? words.map((p) => p.text).join('') : line.text, words, ...(isBackground ? { isBackground: true } : line.element?.singer ? { agent: line.element.singer } : {}) };
      }), source);
      return plain(data.plainLyrics, source);
    }));
    const docs = attempts.filter((a) => a.status === 'fulfilled').map((a) => a.value);
    if (!docs.length) throw attempts[0].reason;
    return bestDoc(docs, source);
  }
  if (source === 'SimpMusic') {
    let data;
    try { data = await get('https://api-lyrics.simpmusic.org/v1/' + encodeURIComponent(track.id), {}, { 'User-Agent': 'SimpMusicLyrics/1.0' }); }
    catch { data = null; }
    if (!data) data = await get('https://musicfy-yt-music-server.onrender.com/v1/' + encodeURIComponent(track.id));
    const tracks = (data?.type === 'success' ? data.data || [] : []).filter((t) => duration <= 0 || Math.abs((t.durationSeconds || 0) - duration) <= 10);
    return bestDoc(tracks.map((t) => lrc(t.richSyncLyrics || t.syncedLyrics || t.plainLyric)), source);
  }
  if (source === 'LrcLib') {
    const queries = [{ track_name: title, artist_name: artist, album_name: track.album }, { track_name: title }, { q: `${artist} ${title}` }, { q: title }, { track_name: track.title, artist_name: track.artist }];
    let data = [];
    for (const query of queries) {
      data = (await get('https://lrclib.net/api/search', query) || []).filter((t) => t.syncedLyrics || t.plainLyrics);
      if (data.length) break;
    }
    return bestDoc(data.filter((t) => duration <= 0 || Math.abs(t.duration - duration) <= 5).sort((a, b) => Math.abs(a.duration - duration) - Math.abs(b.duration - duration)).slice(0, 5).map((t) => lrc(t.syncedLyrics || t.plainLyrics)), source);
  }
  if (source === 'Paxsenix') {
    let matches = [];
    for (const q of [`${title} ${artist}`, title, `${title} ${artist} ${track.album || ''}`]) {
      const data = await get('https://lyrics.paxsenix.org/apple-music/search', { q });
      matches = (Array.isArray(data) ? data : []).map((t) => {
        const target = normalize(title), name = normalize(t.trackName || t.songName), performer = (t.artistName || '').toLowerCase();
        const diff = Math.abs((t.duration || 0) - track.durationMs);
        let score = t.duration == null ? 0 : diff <= 2000 ? 100 : diff <= 5000 ? 50 : diff <= 10000 ? 10 : -50;
        score += name === target ? 80 : name && (name.includes(target) || target.includes(name)) ? 40 : 0;
        score += performer.includes(artist.toLowerCase()) ? 50 : artist.toLowerCase().split(/\s+/).some((a) => a.length > 2 && performer.includes(a)) ? 25 : 0;
        if (/mixed/i.test(t.trackName || t.songName || '') && !/mixed/i.test(track.title)) score -= 60;
        if (/remix/i.test(t.trackName || t.songName || '') && !/remix/i.test(track.title)) score -= 40;
        return { ...t, score };
      }).filter((t) => t.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
      if (matches.length) break;
    }
    const results = await Promise.allSettled(matches.map(async (t) => {
      const data = await get('https://lyrics.paxsenix.org/apple-music/lyrics', { id: t.id });
      if (!data) return missing(source);
      if (data.ttmlContent) { const doc = parseTtml(data.ttmlContent, source); if (doc.type !== 'missing') return doc; }
      if (data.elrcMultiPerson || data.elrc || data.plain) return lrc(data.elrcMultiPerson || data.elrc || data.plain);
      const content = data.content || [];
      const lineText = (pieces) => { const spacedByApi = pieces.slice(0, -1).some(p => /\s$/.test(p.text)); return pieces.map((p, i) => p.text + (!spacedByApi && i < pieces.length - 1 && !p.part && !/\s$/.test(p.text) ? ' ' : '')).join(''); };
      if (data.type !== 'Syllable' && !content.some((line) => line.timestamp > 0)) return plain(content.map((line) => lineText(line.text || [])).join('\n'), source);
      return synced(content.map((line) => ({ timeMs: line.timestamp, text: lineText(line.text || []), ...(data.type === 'Syllable' ? { words: (line.text || []).map((p) => ({ text: p.text, startMs: p.timestamp, endMs: p.endtime })), ...(line.background ? { isBackground: true } : { agent: line.oppositeTurn ? 'v2' : 'v1' }) } : {}) })), source);
    }));
    const docs = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (results.length && !docs.length) throw results[0].reason;
    return bestDoc(docs, source);
  }
  if (source === 'NetEase') {
    const data = await get('https://music.163.com/api/search/get', { s: `${track.title} ${track.artist}`, type: 1, limit: 10 });
    const id = bestMatch((data?.result?.songs || []).map((s) => ({ titles: [s.name, ...(s.alias || [])], artists: (s.artists || []).map((a) => a.name), duration: s.duration / 1000, ref: s.id })), track);
    if (id == null) return missing(source);
    const lyrics = await get('https://music.163.com/api/song/lyric', { id, lv: 1, yv: 1 });
    const yrc = parseYrc(lyrics?.yrc?.lyric, source);
    return withoutCredits(yrc.type !== 'missing' ? yrc : lrc(lyrics?.lrc?.lyric));
  }
  if (source === 'QQMusic') {
    const call = (module, method, param) => post('https://u.y.qq.com/cgi-bin/musicu.fcg', { req: { module, method, param } });
    const data = await call('music.search.SearchCgiService', 'DoSearchForQQMusicDesktop', { query: `${track.title} ${track.artist}`, num_per_page: 10, page_num: 1, search_type: 0 });
    const song = bestMatch((data?.req?.data?.body?.song?.list || []).map((s) => ({ titles: [s.name], artists: (s.singer || []).map((a) => a.name), duration: s.interval, ref: s })), track);
    if (!song) return missing(source);
    const lyrics = await call('music.musichallSong.PlayLyricInfo', 'GetPlayLyricInfo', { songMID: song.mid, songID: song.id });
    return withoutCredits(lrc(Buffer.from(lyrics?.req?.data?.lyric || '', 'base64').toString('utf8')));
  }
  if (source === 'Deezer') {
    const data = await get('https://api.deezer.com/search', { q: `${track.title} ${track.artist}`, limit: 10 });
    const id = bestMatch((data?.data || []).map((s) => ({ titles: [s.title, s.title_short], artists: [s.artist?.name], duration: s.duration, ref: s.id })), track);
    if (id == null) return missing(source);
    const auth = await get('https://auth.deezer.com/login/anonymous', { jo: 'p', rto: 'c' });
    if (!auth?.jwt) throw new Error('Deezer anonymous login unavailable');
    const response = await post('https://pipe.deezer.com/api', { query: `query { track(trackId: "${id}") { lyrics { text synchronizedLines { milliseconds line } synchronizedWordByWordLines { start words { start end word } } } } }` }, { Authorization: `Bearer ${auth.jwt}` });
    if (response?.errors?.length) throw new Error('Deezer lyrics service rejected the request');
    const lyrics = response?.data?.track?.lyrics;
    if (!lyrics) return missing(source);
    const wordLines = (lyrics.synchronizedWordByWordLines || []).map((line) => ({ timeMs: line.start, text: joinWords((line.words || []).map((w) => w.word)), words: (line.words || []).map((w) => ({ text: w.word, startMs: w.start, endMs: w.end })) }));
    const doc = synced(wordLines.length ? wordLines : (lyrics.synchronizedLines || []).map((line) => ({ timeMs: line.milliseconds, text: line.line })), source);
    return doc.type !== 'missing' ? doc : plain(lyrics.text, source);
  }
  if (source === 'Kugou') {
    const keyword = `${track.title.replace(/\(.*\)|（.*）|「.*」|『.*』|<.*>|《.*》|〈.*〉|＜.*＞/g, '').trim()} - ${track.artist.replace(/, | & |和/g, '、').replace(/\./g, '').replace(/\(.*\)|（.*）/g, '')}${track.album ? ' ' + track.album : ''}`;
    const data = await get('https://mobileservice.kugou.com/api/v3/search/song', { version: 9108, plat: 0, pagesize: 8, showtype: 0, keyword });
    let candidate;
    for (const song of data?.data?.info || []) {
      if (duration > 0 && Math.abs(song.duration - duration) > 8) continue;
      const lyrics = await get('https://lyrics.kugou.com/search', { ver: 1, man: 'yes', client: 'pc', hash: song.hash });
      candidate = lyrics?.candidates?.[0];
      if (candidate) break;
    }
    if (!candidate) candidate = (await get('https://lyrics.kugou.com/search', { ver: 1, man: 'yes', client: 'pc', duration: duration > 0 ? duration * 1000 : undefined, keyword }))?.candidates?.[0];
    if (!candidate) return missing(source);
    const lyrics = await get('https://lyrics.kugou.com/download', { fmt: 'lrc', charset: 'utf8', client: 'pc', ver: 1, id: candidate.id, accesskey: candidate.accesskey });
    return withoutCredits(lrc(Buffer.from(lyrics?.content || '', 'base64').toString('utf8')));
  }
  const yt = (method, body, client = clients.WEB_REMIX) => post('https://music.youtube.com/youtubei/v1/' + method, { context: { client: { ...client, hl: 'en', gl: 'US' } }, ...body }, { Origin: 'https://music.youtube.com', Referer: 'https://music.youtube.com/' });
  if (!/^[\w-]{11}$/.test(track.id)) return missing(source);
  if (source === 'YouTubeMusic') {
    const next = await yt('next', { videoId: track.id });
    const tabs = next?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs;
    const browse = tabs?.[1]?.tabRenderer?.endpoint?.browseEndpoint;
    if (!browse?.browseId) return missing(source);
    const page = await yt('browse', browse);
    const shelves = page?.contents?.sectionListRenderer?.contents || [];
    const description = shelves.find((s) => s.musicDescriptionShelfRenderer)?.musicDescriptionShelfRenderer?.description?.runs;
    return plain(description?.map((r) => r.text).join(''), source);
  }
  if (source === 'YouTubeSubtitle') {
    const data = await yt('get_transcript', { params: Buffer.from('\n\x0b' + track.id).toString('base64') }, clients.WEB);
    const groups = findValue(data, 'transcriptBodyRenderer')?.cueGroups || [];
    return synced(groups.map((group) => group.transcriptCueGroupRenderer?.cues?.[0]?.transcriptCueRenderer).filter(Boolean).map((cue) => ({ timeMs: Number(cue.startOffsetMs), text: cue.cue?.simpleText?.replace(/^♪+|♪+$/g, '').trim() })), source);
  }
  if (source === 'YouTubeCaptions') {
    let lastError;
    for (const client of [clients.ANDROID_VR, clients.IOS, clients.WEB_REMIX]) {
      try {
        const player = await yt('player', { videoId: track.id, contentCheckOk: true, racyCheckOk: true }, client);
        const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        const auto = tracks.find((t) => t.kind === 'asr' || t.vssId?.startsWith('a.'));
        if (!auto) continue;
        const caption = tracks.find((t) => t.kind !== 'asr' && !t.vssId?.startsWith('a.') && t.languageCode?.split('-')[0] === auto.languageCode?.split('-')[0]) || auto;
        if (!allowedLyricsUrl(caption.baseUrl) || new URL(caption.baseUrl).pathname !== '/api/timedtext') throw new Error('Source returned an invalid caption endpoint');
        const data = await get(caption.baseUrl, { fmt: 'json3' });
        let previous;
        const lines = (data?.events || []).filter((event) => Number.isFinite(event.tStartMs) && event.segs).map((event) => ({ timeMs: event.tStartMs, text: event.segs.map((s) => s.utf8 || '').join('').replace(/\[[^\]]*\]|♪/g, ' ').replace(/\s+/g, ' ').trim() })).filter((line) => {
          if (!line.text || line.text === previous) return false;
          previous = line.text; return true;
        });
        if (lines.length) return synced(lines, source);
      } catch (error) { lastError = error; }
    }
    if (lastError) throw lastError;
  }
  return missing(source);
}
module.exports = { providerDefinitions, lookupLyrics, allowedLyricsUrl, parseLrc, parseTtml, parseYrc };
