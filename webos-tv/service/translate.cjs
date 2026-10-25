'use strict';
// Lyrics translation through the same keyless endpoint the Android app uses (GoogleTranslateEngine):
// lines go out in batches joined by a marker and must come back one-for-one, or they are not shown.
// The host and path are fixed here; the caller only supplies text and language codes.

const HOST = 'translate.googleapis.com';
const PATH = '/translate_a/single';
const MARKER = '\n@@@\n';
const BATCH_CHARS = 1500;
const MAX_LINES = 400;
const MAX_LINE_CHARS = 500;
const LANGUAGE = /^(auto|[a-z]{2,3}(-[A-Za-z]{2,4})?)$/;

class TranslateError extends Error {
  constructor(message, status) { super(message); this.name = 'TranslateError'; this.status = status; }
}

function validate(input) {
  const body = input && typeof input === 'object' ? input : {};
  const lines = body.lines;
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > MAX_LINES) throw new TranslateError('Daftar baris tidak valid.', 400);
  for (const line of lines) if (typeof line !== 'string' || line.length > MAX_LINE_CHARS) throw new TranslateError('Baris tidak valid.', 400);
  const source = body.source === undefined ? 'auto' : body.source;
  if (typeof source !== 'string' || !LANGUAGE.test(source)) throw new TranslateError('Bahasa asal tidak valid.', 400);
  if (typeof body.target !== 'string' || !LANGUAGE.test(body.target) || body.target === 'auto') throw new TranslateError('Bahasa tujuan tidak valid.', 400);
  return { lines, source, target: body.target };
}

/** The nested array the endpoint answers with; the pieces of one translation are concatenated. */
function readReply(text) {
  let root;
  try { root = JSON.parse(text); } catch (error) { return undefined; }
  const segments = Array.isArray(root) ? root[0] : undefined;
  if (!Array.isArray(segments)) return undefined;
  let joined = '';
  for (const segment of segments) if (Array.isArray(segment) && typeof segment[0] === 'string') joined += segment[0];
  return joined;
}

async function batch(lines, source, target, upstream) {
  const url = `https://${HOST}${PATH}?client=gtx&sl=${encodeURIComponent(source)}&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(lines.join(MARKER))}`;
  let response;
  try { response = await upstream(url); } catch (error) { return undefined; }
  if (response.status === 429) throw new TranslateError('Layanan terjemahan sedang membatasi permintaan. Coba lagi nanti.', 429);
  if (response.status !== 200) return undefined;
  const joined = readReply(response.body);
  if (joined === undefined) return undefined;
  const parts = joined.split(/\s*@@@\s*/).map((part) => part.trim());
  return parts.length === lines.length ? parts : undefined;
}

/**
 * Translates `lines` one-for-one. A batch whose markers come back mangled is asked again line by
 * line (a line that still fails keeps its original text) so the rest is not lost; if nothing at
 * all could be translated, or the count is off, the whole call fails rather than misalign lyrics.
 */
async function translateLines(input, upstream) {
  const { lines, source, target } = validate(input);
  const out = [];
  let anyTranslated = false;
  let pending = [];
  let budget = 0;
  const flush = async () => {
    if (!pending.length) return;
    let parts = await batch(pending, source, target, upstream);
    if (parts) anyTranslated = true;
    else {
      parts = [];
      for (const line of pending) {
        const single = line.trim() ? await batch([line], source, target, upstream) : [''];
        if (single) { parts.push(single[0]); if (line.trim()) anyTranslated = true; } else parts.push(line);
      }
    }
    out.push(...parts);
    pending = []; budget = 0;
  };
  for (const line of lines) {
    if (budget + line.length > BATCH_CHARS && pending.length) await flush();
    pending.push(line);
    budget += line.length + MARKER.length;
  }
  await flush();
  if (!anyTranslated || out.length !== lines.length) throw new TranslateError('Terjemahan gagal. Coba lagi.', 502);
  return { lines: out };
}

function allowedTranslateUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === HOST && url.pathname === PATH && !url.username && !url.password && (!url.port || url.port === '443');
  } catch (error) { return false; }
}

module.exports = { translateLines, allowedTranslateUrl, TranslateError, validate };
