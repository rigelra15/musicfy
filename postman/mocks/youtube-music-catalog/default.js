// Stand-in for music.youtube.com InnerTube used by the catalog service. Payloads are fixtures built
// from server/fixtures/innertube.ts (regenerate with scripts/build-catalog-mock-fixtures.mjs).
// Fault injection by search text: "rate limit" -> 429, "forbidden" -> 403, "rusak" -> invalid JSON,
// "lambat" -> 6 s delay, "kosong" -> a valid search body with no result container.
const http = require('http');
const fixtures = require('./fixtures.json');
const PORT = process.env.PORT || 4501;
const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

function pick(path, body) {
  if (body.continuation) return fixtures.continuation;
  if (path.startsWith('/youtubei/v1/music/get_search_suggestions')) return fixtures.suggest;
  if (path.startsWith('/youtubei/v1/search')) {
    const query = String(body.query || '').toLowerCase();
    if (query.includes('kosong')) return { contents: {} };
    return fixtures.search;
  }
  if (path.startsWith('/youtubei/v1/next')) return fixtures.next;
  if (path.startsWith('/youtubei/v1/browse')) {
    const id = String(body.browseId || '');
    if (id === 'FEmusic_home') return fixtures.home;
    if (/^MPRE|^VL|^OLAK/.test(id)) return fixtures.album;
    if (/^UC/.test(id)) return fixtures.artist;
  }
  return null;
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, HEADERS); res.end(); return; }
  let data = '';
  req.on('data', (chunk) => { data += chunk; });
  req.on('end', () => {
    let body = {};
    try { body = data ? JSON.parse(data) : {}; } catch (error) { res.writeHead(400, HEADERS); res.end('{}'); return; }
    const text = String(body.query || body.input || '').toLowerCase();
    const reply = () => {
      if (text.includes('rate limit')) { res.writeHead(429, HEADERS); res.end('{}'); return; }
      if (text.includes('forbidden')) { res.writeHead(403, HEADERS); res.end('{}'); return; }
      if (text.includes('rusak')) { res.writeHead(200, HEADERS); res.end('<html>'); return; }
      const payload = pick(req.url || '', body);
      if (!payload) { res.writeHead(404, HEADERS); res.end('{}'); return; }
      res.writeHead(200, HEADERS); res.end(JSON.stringify(payload));
    };
    if (text.includes('lambat')) setTimeout(reply, 6000); else reply();
  });
}).listen(PORT, '127.0.0.1');
