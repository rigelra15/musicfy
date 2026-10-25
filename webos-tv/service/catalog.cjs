'use strict';
// One catalog operation: validate -> ask YouTube Music -> normalise. The transport is injected so
// the same code serves the packaged service, the Vite adapter and the tests.
const { buildOperation, parseOperation, CatalogError } = require('./innertube.cjs');

async function callUpstream(upstream, request) {
  let response;
  try {
    response = await upstream(request.path, request.body);
  } catch (error) {
    if (error instanceof CatalogError) throw error;
    const timeout = error && /timeout/i.test(String(error.message));
    throw new CatalogError(timeout ? 'timeout' : 'network', timeout
      ? 'YouTube Music terlalu lama menjawab. Coba lagi.'
      : 'Tidak bisa terhubung ke YouTube Music. Periksa koneksi lalu coba lagi.', timeout ? 504 : 502);
  }
  if (response.status === 429) throw new CatalogError('rate-limited', 'YouTube Music sedang membatasi permintaan. Tunggu sebentar lalu coba lagi.', 429);
  if (response.status === 401 || response.status === 403) throw new CatalogError('forbidden', 'YouTube Music menolak permintaan ini.', 502);
  if (response.status < 200 || response.status >= 300) throw new CatalogError('upstream-http', 'YouTube Music menjawab dengan kesalahan (' + response.status + ').', 502);
  try {
    return JSON.parse(response.body);
  } catch (error) {
    throw new CatalogError('invalid-response', 'YouTube Music mengirim respons yang tidak bisa dibaca.', 502);
  }
}

async function runCatalog(operation, params, upstream) {
  const request = buildOperation(operation, params);
  const page = parseOperation(operation, request, await callUpstream(upstream, request));
  if (operation === 'next' && !request.continuation && page.automix) {
    // Android follows the automix preview so the queue continues past the album/playlist panel.
    const automix = page.automix;
    delete page.automix;
    try {
      const followUp = buildOperation('next', { locale: params && params.locale, playlistId: automix.playlistId, videoId: automix.videoId, params: automix.params });
      const more = parseOperation('next', followUp, await callUpstream(upstream, followUp));
      const seen = new Set(page.items.map((item) => item.id));
      page.items = page.items.concat(more.items.filter((item) => !seen.has(item.id)));
      page.continuation = more.continuation;
      page.radioPlaylistId = automix.playlistId;
    } catch (error) {
      // The first panel is still a valid answer; record that the radio part is missing.
      page.radioUnavailable = true;
    }
  }
  return page;
}

module.exports = { runCatalog, callUpstream, CatalogError };
