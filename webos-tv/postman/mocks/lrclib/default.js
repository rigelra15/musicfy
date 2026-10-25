const http = require('http');

const PORT = process.env.PORT || 4501;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'accept, content-type',
  'Access-Control-Max-Age': '600',
  'Content-Type': 'application/json',
};

const syncedLyrics = {
  id: 12345,
  trackName: 'Malam di Kota',
  artistName: 'Senja',
  albumName: 'Ruang Sore',
  duration: 222,
  instrumental: false,
  plainLyrics: 'Malam turun perlahan\nKota menyimpan cerita',
  syncedLyrics: '[00:00.00]Baris lirik simulasi pertama\n[00:03.50]Baris lirik simulasi kedua\n[00:07.00]Baris lirik simulasi ketiga',
};

const plainLyrics = {
  ...syncedLyrics,
  id: 12346,
  trackName: 'Malam di Kota (Plain)',
  plainLyrics: [
    'Malam turun perlahan',
    'Kota menyimpan cerita',
    'Lampu jalan mulai menyala',
    'Angin membawa kabar lama',
    'Kita berjalan tanpa terburu',
    'Menyusuri sudut yang kita tahu',
    'Ada lagu dari kejauhan',
    'Ada rindu yang tertahan',
    'Malam turun perlahan',
    'Kota menyimpan cerita',
    'Sampai pagi membuka jendela',
    'Kita pulang membawa cerita',
  ].join('\n'),
  syncedLyrics: null,
};

const server = http.createServer((req, res) => {
  const { method, url } = req;
  const requestUrl = new URL(url, 'http://localhost');

  if (method === 'OPTIONS' && requestUrl.pathname === '/api/search') {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  if (method === 'GET' && requestUrl.pathname === '/api/search') {
    const title = (requestUrl.searchParams.get('track_name') ?? '').trim().toLowerCase();
    if (title === 'tidak ada hasil') {
      res.writeHead(200, CORS_HEADERS);
      return res.end('[]');
    }

    const record = title.includes('(plain)') ? plainLyrics : syncedLyrics;
    res.writeHead(200, CORS_HEADERS);
    return res.end(JSON.stringify([record]));
  }

  res.writeHead(404, CORS_HEADERS);
  return res.end(JSON.stringify({ error: 'Endpoint not defined', path: url }));
});

server.listen(PORT, () => console.log(`Musicfy LRCLIB mock on port ${PORT}`));
