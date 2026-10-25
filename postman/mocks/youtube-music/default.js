const http = require('http');

const PORT = process.env.PORT || 4500;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'content-type, x-goog-api-format-version, x-goog-visitor-id, x-origin, x-youtube-client-name, x-youtube-client-version',
  'Access-Control-Max-Age': '600',
  'Content-Type': 'application/json',
};

const song = {
  musicResponsiveListItemRenderer: {
    playlistItemData: { videoId: 'simulated-song-1' },
    navigationEndpoint: { watchEndpoint: { videoId: 'simulated-song-1' } },
    flexColumns: [
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: { runs: [{ text: 'Malam di Kota' }] },
        },
      },
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: {
            runs: [
              { text: 'Senja' },
              { text: ' • ' },
              { text: 'Ruang Sore', navigationEndpoint: { browseEndpoint: { browseId: 'MPREsimulated' } } },
              { text: ' • ' },
              { text: '3:42' },
            ],
          },
        },
      },
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: { runs: [{ text: '3:42' }] },
        },
      },
    ],
    thumbnail: {
      musicThumbnailRenderer: {
        thumbnail: { thumbnails: [{ url: 'https://img.youtube.com/simulated-cover.jpg' }] },
      },
    },
  },
};

function responseFor(query) {
  const normalizedQuery = query.trim().toLowerCase();
  const isEmptySearch = normalizedQuery === 'tidak ada hasil';
  const isPlainSearch = normalizedQuery.includes('plain');
  const resultSong = isPlainSearch ? JSON.parse(JSON.stringify(song)) : song;
  if (isPlainSearch) {
    resultSong.musicResponsiveListItemRenderer.flexColumns[0]
      .musicResponsiveListItemFlexColumnRenderer.text.runs[0].text = 'Malam di Kota (Plain)';
  }
  return {
    contents: {
      tabbedSearchResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [
                    { musicShelfRenderer: { contents: isEmptySearch ? [] : [resultSong] } },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  };
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;
  const pathname = new URL(url, 'http://localhost').pathname;

  if (method === 'OPTIONS' && pathname === '/youtubei/v1/search') {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  if (method === 'OPTIONS' && pathname === '/youtubei/v1/player') {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  if (method === 'GET' && pathname === '/sw.js_data') {
    res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
    return res.end(')]}\',\n[[0, 0, ["CgtGuestVisitorData"]]]');
  }

  if (method === 'POST' && pathname === '/youtubei/v1/search') {
    const body = await readJson(req);
    const query = typeof body.query === 'string' ? body.query : '';
    const isGuestSearch =
      body.context?.client?.clientName === 'WEB_REMIX' &&
      body.params === 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D' &&
      body.context?.user?.onBehalfOfUser == null;

    if (!isGuestSearch || !query.trim()) {
      res.writeHead(400, CORS_HEADERS);
      return res.end(JSON.stringify({ error: 'Expected a guest WEB_REMIX song search.' }));
    }

    res.writeHead(200, CORS_HEADERS);
    return res.end(JSON.stringify(responseFor(query)));
  }

  if (method === 'POST' && pathname === '/youtubei/v1/player') {
    const body = await readJson(req);
    const isGuestPlayerRequest =
      body.context?.client?.clientName === 'VISIONOS' &&
      body.context?.client?.visitorData === 'CgtGuestVisitorData' &&
      body.context?.user?.onBehalfOfUser == null &&
      body.serviceIntegrityDimensions == null &&
      typeof body.videoId === 'string';

    if (!isGuestPlayerRequest) {
      res.writeHead(400, CORS_HEADERS);
      return res.end(JSON.stringify({ error: 'Expected a guest VISIONOS player request.' }));
    }

    const expires = Math.floor(Date.now() / 1000) + 3600;
    res.writeHead(200, CORS_HEADERS);
    return res.end(JSON.stringify({
      playabilityStatus: { status: 'OK', reason: null },
      streamingData: {
        expiresInSeconds: 3600,
        adaptiveFormats: [
          {
            itag: 140,
            url: `https://rr1---sn.googlevideo.com/videoplayback?expire=${expires}&itag=140`,
            mimeType: 'audio/mp4; codecs="mp4a.40.2"',
            bitrate: 128000,
            width: null,
            height: null,
            signatureCipher: null,
            cipher: null,
          },
        ],
      },
    }));
  }

  res.writeHead(404, CORS_HEADERS);
  return res.end(JSON.stringify({ error: 'Endpoint not defined', path: url }));
});

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        const parsed = raw ? JSON.parse(raw) : {};
        resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
      } catch {
        resolve({});
      }
    });
  });
}

server.listen(PORT, () => console.log(`Musicfy YouTube Music mock on port ${PORT}`));
