'use strict';
// Finds the catalog song that is the same recording as the one being played. Port of the Android
// module API's TrackMatcher, so every source matches alike: titles are compared without the
// decorations sources add ("feat.", "Remastered", "Official Video"), but the words that make it a
// different recording (remix, live, acoustic, sped up...) count against it.

const VERSION_WORDS = ['remix', 'live', 'acoustic', 'instrumental', 'karaoke', 'sped up', 'slowed', 'nightcore', 'demo', 'cover', 'edit', 'mix', 'version', 'unplugged', 'orchestral', 'piano'];
const VERSION_PATTERNS = VERSION_WORDS.map((word) => new RegExp('\\b' + word.replace(/ /g, '\\s+') + '\\b'));
const MIN_SCORE = 0.7;

const words = (text) => String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0 && w !== 'the' && w !== 'and');

function core(title) {
  let t = String(title || '').toLowerCase();
  t = t.replace(/[(\[](?:feat|ft|with|prod)\.?\s[^)\]]*[)\]]/g, ' ');
  t = t.replace(/\s[-–]\s.*\b(?:remaster(?:ed)?|official|video|audio|lyrics?|visuali[sz]er|mv)\b.*$/g, ' ');
  t = t.replace(/[(\[][^)\]]*\b(?:remaster(?:ed)?|official|video|audio|lyrics?|visuali[sz]er|mv|explicit|clean)\b[^)\]]*[)\]]/g, ' ');
  t = t.replace(/\b(?:feat|ft)\.?\s.*$/g, ' ');
  return words(t).join(' ');
}

function similarity(a, b) {
  if (a === b) return 1;
  const wa = new Set(a.split(' ').filter(Boolean));
  const wb = new Set(b.split(' ').filter(Boolean));
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  return shared / (wa.size + wb.size - shared);
}

/** `query` {title, artists[], durationMs?, isrc?}; `song` {id, title, artist, album?, durationMs?, isrc?} */
function score(query, song) {
  const title = similarity(core(query.title), core(song.title));
  if (title < 0.55) return 0;
  const songArtists = words(song.artist);
  let artist = 0;
  for (const a of query.artists || []) {
    const w = words(a);
    if (w.length) artist = Math.max(artist, w.filter((x) => songArtists.includes(x)).length / w.length);
  }
  if (artist < 0.5) return 0;
  let duration = 0.6;
  if (Number.isFinite(query.durationMs) && Number.isFinite(song.durationMs)) {
    const diff = Math.abs(query.durationMs - song.durationMs) / 1000;
    duration = diff <= 2 ? 1 : diff >= 15 ? 0 : 1 - (diff - 2) / 13;
  }
  const q = String(query.title || '').toLowerCase();
  const s = String(song.title || '').toLowerCase();
  const mismatch = VERSION_PATTERNS.filter((p) => p.test(q) !== p.test(s)).length;
  return Math.min(1, Math.max(0, 0.5 * title + 0.3 * artist + 0.2 * duration - 0.25 * mismatch));
}

/** Every acceptable match, best first: the same recording is often in a catalog several times. */
function ranked(query, candidates) {
  const isrc = query.isrc;
  return (candidates || [])
    .map((song) => ({ song, score: isrc && song.isrc && String(song.isrc).toLowerCase() === String(isrc).toLowerCase() ? 1 : score(query, song) }))
    .filter((item) => item.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score);
}

module.exports = { core, score, ranked, words, MIN_SCORE };
