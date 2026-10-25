'use strict';
// YouTube Music (InnerTube) request building and response normalisation for the catalog.
// Ported from the Android provider (providers/innertube): same endpoints, same search filters,
// same renderer shapes. Runs in the packaged Node 16 service and in the Vite adapter, so it uses
// only core Node and syntax Node 16 understands.

const WEB_REMIX_VERSION = '1.20260707.12.00';
const API_ORIGIN = 'https://music.youtube.com';

const SEARCH_FILTERS = {
  songs: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D',
  videos: 'EgWKAQIQAWoKEAkQChAFEAMQBA%3D%3D',
  albums: 'EgWKAQIYAWoKEAkQChAFEAMQBA%3D%3D',
  artists: 'EgWKAQIgAWoKEAkQChAFEAMQBA%3D%3D',
  playlists: 'EgeKAQQoADgBagwQDhAKEAMQBRAJEAQ%3D',
  community: 'EgeKAQQoAEABagoQAxAEEAoQCRAF',
};

class CatalogError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.name = 'CatalogError';
    this.kind = kind;
    this.status = status;
  }
}

// ---- small helpers --------------------------------------------------------------------------

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const asArray = (value) => (Array.isArray(value) ? value : []);
const get = (value, ...path) => {
  let current = value;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    current = current[key];
  }
  return current;
};
const first = (value) => asArray(value)[0];
const text = (value) => {
  if (!isObject(value)) return undefined;
  if (typeof value.simpleText === 'string') return value.simpleText.trim() || undefined;
  if (Array.isArray(value.runs)) return value.runs.map((run) => (run && run.text) || '').join('').trim() || undefined;
  if (typeof value.text === 'string') return value.text.trim() || undefined;
  return undefined;
};
const runsOf = (value) => asArray(get(value, 'runs')).filter(isObject);
const joinRuns = (runs) => runs.map((run) => run.text || '').join('').trim() || undefined;

function parseDurationMs(value) {
  if (typeof value !== 'string') return undefined;
  const match = /^(?:(\d+)[:.])?(\d+)[:.](\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  return ((Number(match[1] || 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000;
}
const isDuration = (value) => /^\d+(?::\d{2}){1,2}$/.test(String(value).trim());

function bestThumbnail(thumbnails) {
  const list = asArray(thumbnails).filter((item) => isObject(item) && typeof item.url === 'string' && item.url);
  if (!list.length) return undefined;
  const sorted = list.slice().sort((a, b) => (a.width || 0) - (b.width || 0));
  const url = sorted[sorted.length - 1].url;
  return url.startsWith('//') ? 'https:' + url : url;
}
function thumbnailOf(renderer) {
  return bestThumbnail(get(renderer, 'thumbnail', 'musicThumbnailRenderer', 'thumbnail', 'thumbnails'))
    || bestThumbnail(get(renderer, 'thumbnailRenderer', 'musicThumbnailRenderer', 'thumbnail', 'thumbnails'))
    || bestThumbnail(get(renderer, 'thumbnail', 'croppedSquareThumbnailRenderer', 'thumbnail', 'thumbnails'))
    || bestThumbnail(get(renderer, 'thumbnail', 'thumbnails'));
}

function browseEndpointOf(endpoint) {
  const browse = get(endpoint, 'browseEndpoint');
  if (!isObject(browse) || typeof browse.browseId !== 'string') return undefined;
  const pageType = get(browse, 'browseEndpointContextSupportedConfigs', 'browseEndpointContextMusicConfig', 'pageType');
  return { browseId: browse.browseId, params: typeof browse.params === 'string' ? browse.params : undefined, pageType };
}

const PAGE_KIND = {
  MUSIC_PAGE_TYPE_ALBUM: 'album',
  MUSIC_PAGE_TYPE_AUDIOBOOK: 'album',
  MUSIC_PAGE_TYPE_ARTIST: 'artist',
  MUSIC_PAGE_TYPE_USER_CHANNEL: 'artist',
  MUSIC_PAGE_TYPE_LIBRARY_ARTIST: 'artist',
  MUSIC_PAGE_TYPE_PLAYLIST: 'playlist',
};
const VIDEO_TYPES = new Set(['MUSIC_VIDEO_TYPE_OMV', 'MUSIC_VIDEO_TYPE_UGC', 'MUSIC_VIDEO_TYPE_OFFICIAL_SOURCE_MUSIC']);

function watchEndpointOf(endpoint) {
  const watch = get(endpoint, 'watchEndpoint') || get(endpoint, 'watchPlaylistEndpoint');
  if (!isObject(watch)) return undefined;
  return {
    videoId: typeof watch.videoId === 'string' ? watch.videoId : undefined,
    playlistId: typeof watch.playlistId === 'string' ? watch.playlistId : undefined,
    params: typeof watch.params === 'string' ? watch.params : undefined,
    musicVideoType: get(watch, 'watchEndpointMusicSupportedConfigs', 'watchEndpointMusicConfig', 'musicVideoType'),
  };
}

function stripPlaylistPrefix(id) {
  return typeof id === 'string' && id.startsWith('VL') ? id.slice(2) : id;
}

const compact = (object) => {
  const result = {};
  for (const key of Object.keys(object)) if (object[key] !== undefined && object[key] !== null && object[key] !== '') result[key] = object[key];
  return result;
};

/** Splits a subtitle's runs into artists / album / duration / leading type label. */
function readSubtitle(runs) {
  const artists = [];
  let album;
  let durationMs;
  let typeLabel;
  const rest = [];
  runs.forEach((run, index) => {
    const value = (run.text || '').trim();
    if (!value || value === '•' || value === '&' || value === ',' || value === '-') return;
    const endpoint = browseEndpointOf(run.navigationEndpoint);
    const kind = endpoint && PAGE_KIND[endpoint.pageType];
    if (kind === 'artist') artists.push(compact({ id: endpoint.browseId, name: value }));
    else if (kind === 'album' && !album) album = compact({ id: endpoint.browseId, name: value });
    else if (isDuration(value)) durationMs = parseDurationMs(value);
    else if (!endpoint && index === 0 && runs.length > 1) typeLabel = value;
    else rest.push(value);
  });
  return { artists, album, durationMs, typeLabel, rest };
}

// ---- items -----------------------------------------------------------------------------------

function itemFromNavigation(title, subtitleRuns, endpoint, thumbnail, extra) {
  const subtitle = readSubtitle(subtitleRuns);
  const browse = browseEndpointOf(endpoint);
  const watch = watchEndpointOf(endpoint);
  const subtitleText = joinRuns(subtitleRuns);
  let kind = browse && PAGE_KIND[browse.pageType];
  if (!kind && browse) {
    if (browse.browseId.startsWith('MPRE')) kind = 'album';
    else if (browse.browseId.startsWith('UC')) kind = 'artist';
    else if (browse.browseId.startsWith('VL')) kind = 'playlist';
  }
  if (kind && browse) {
    return compact(Object.assign({
      kind,
      id: kind === 'playlist' ? stripPlaylistPrefix(browse.browseId) : browse.browseId,
      browseId: browse.browseId,
      title,
      subtitle: subtitleText,
      artworkUrl: thumbnail,
      artists: subtitle.artists.length ? subtitle.artists : undefined,
      year: subtitle.rest.find((value) => /^\d{4}$/.test(value)),
    }, extra));
  }
  if (watch && watch.videoId) {
    return compact(Object.assign({
      kind: VIDEO_TYPES.has(watch.musicVideoType) ? 'video' : 'track',
      id: watch.videoId,
      title,
      subtitle: subtitleText,
      artworkUrl: thumbnail,
      artists: subtitle.artists.length ? subtitle.artists : undefined,
      album: subtitle.album,
      durationMs: subtitle.durationMs,
      playlistId: watch.playlistId,
    }, extra));
  }
  if (watch && watch.playlistId) {
    return compact(Object.assign({ kind: 'playlist', id: watch.playlistId, title, subtitle: subtitleText, artworkUrl: thumbnail, playlistId: watch.playlistId }, extra));
  }
  return undefined;
}

function playEndpointOfOverlay(renderer) {
  const play = get(renderer, 'thumbnailOverlay', 'musicItemThumbnailOverlayRenderer', 'content', 'musicPlayButtonRenderer', 'playNavigationEndpoint');
  return watchEndpointOf(play);
}

const isExplicit = (badges) => asArray(badges).some((badge) => get(badge, 'musicInlineBadgeRenderer', 'icon', 'iconType') === 'MUSIC_EXPLICIT_BADGE') || undefined;

function parseTwoRow(wrapper) {
  const r = get(wrapper, 'musicTwoRowItemRenderer');
  if (!isObject(r)) return undefined;
  const title = text(r.title);
  if (!title) return undefined;
  const play = playEndpointOfOverlay(r);
  return itemFromNavigation(title, runsOf(r.subtitle), r.navigationEndpoint, thumbnailOf(r), compact({
    playlistId: play && play.playlistId,
    isExplicit: isExplicit(r.subtitleBadges),
  }));
}

function parseResponsive(wrapper) {
  const r = get(wrapper, 'musicResponsiveListItemRenderer');
  if (!isObject(r)) return undefined;
  const columns = asArray(r.flexColumns).map((column) => get(column, 'musicResponsiveListItemFlexColumnRenderer', 'text'));
  const titleRuns = runsOf(columns[0]);
  const title = text(columns[0]);
  if (!title) return undefined;
  const subtitleRuns = runsOf(columns[1]);
  const thumbnail = thumbnailOf(r);
  const fixed = text(get(first(r.fixedColumns), 'musicResponsiveListItemFixedColumnRenderer', 'text'));
  const videoId = get(r, 'playlistItemData', 'videoId') || get(titleRuns[0], 'navigationEndpoint', 'watchEndpoint', 'videoId');
  const endpoint = r.navigationEndpoint || get(titleRuns[0], 'navigationEndpoint');
  const subtitle = readSubtitle(subtitleRuns);
  const explicit = isExplicit(r.badges);
  if (typeof videoId === 'string' && videoId) {
    const watch = watchEndpointOf(endpoint) || watchEndpointOf(get(titleRuns[0], 'navigationEndpoint')) || {};
    const isVideo = VIDEO_TYPES.has(watch.musicVideoType) || subtitle.typeLabel === 'Video';
    return compact({
      kind: isVideo ? 'video' : 'track',
      id: videoId,
      title,
      subtitle: joinRuns(subtitleRuns),
      artworkUrl: thumbnail,
      artists: subtitle.artists.length ? subtitle.artists : undefined,
      album: subtitle.album,
      durationMs: subtitle.durationMs !== undefined ? subtitle.durationMs : parseDurationMs(fixed),
      playlistId: watch.playlistId,
      isExplicit: explicit,
    });
  }
  const play = playEndpointOfOverlay(r);
  return itemFromNavigation(title, subtitleRuns, endpoint, thumbnail, compact({ playlistId: play && play.playlistId, isExplicit: explicit }));
}

function parsePlaylistPanelItem(wrapper) {
  const r = get(wrapper, 'playlistPanelVideoRenderer');
  if (!isObject(r) || typeof r.videoId !== 'string') return undefined;
  const title = text(r.title);
  if (!title) return undefined;
  const bylineRuns = runsOf(r.longBylineText);
  const subtitle = readSubtitle(bylineRuns);
  const watch = watchEndpointOf(r.navigationEndpoint) || {};
  return compact({
    kind: VIDEO_TYPES.has(watch.musicVideoType) ? 'video' : 'track',
    id: r.videoId,
    title,
    artists: subtitle.artists.length ? subtitle.artists : undefined,
    album: subtitle.album,
    subtitle: joinRuns(bylineRuns),
    artworkUrl: bestThumbnail(get(r, 'thumbnail', 'thumbnails')),
    durationMs: parseDurationMs(text(r.lengthText)),
    playlistId: watch.playlistId,
    selected: r.selected === true ? true : undefined,
  });
}

function parseNavigationButton(wrapper) {
  const r = get(wrapper, 'musicNavigationButtonRenderer');
  if (!isObject(r)) return undefined;
  const title = text(r.buttonText);
  const endpoint = browseEndpointOf(r.clickCommand);
  if (!title || !endpoint) return undefined;
  const stripe = get(r, 'solid', 'leftStripeColor');
  return compact({
    kind: 'link',
    id: endpoint.browseId,
    browseId: endpoint.browseId,
    params: endpoint.params,
    title,
    color: typeof stripe === 'number' ? '#' + ((stripe >>> 0) & 0xffffff).toString(16).padStart(6, '0') : undefined,
  });
}

function parseAnyItem(wrapper) {
  if (!isObject(wrapper)) return undefined;
  if (wrapper.musicTwoRowItemRenderer) return parseTwoRow(wrapper);
  if (wrapper.musicResponsiveListItemRenderer) return parseResponsive(wrapper);
  if (wrapper.musicNavigationButtonRenderer) return parseNavigationButton(wrapper);
  if (wrapper.playlistPanelVideoRenderer) return parsePlaylistPanelItem(wrapper);
  return undefined;
}

function parseItems(list, stats) {
  const items = [];
  for (const wrapper of asArray(list)) {
    if (!isObject(wrapper) || wrapper.continuationItemRenderer || wrapper.automixPreviewVideoRenderer) continue;
    const item = parseAnyItem(wrapper);
    if (item) items.push(item);
    else if (stats) stats.skipped += 1;
  }
  return items;
}

// ---- continuations ---------------------------------------------------------------------------

function continuationIn(container) {
  const entry = first(get(container, 'continuations'));
  const next = get(entry, 'nextContinuationData', 'continuation') || get(entry, 'nextRadioContinuationData', 'continuation');
  if (typeof next === 'string') return next;
  const items = asArray(get(container, 'contents')).concat(asArray(get(container, 'continuationItems')));
  for (const item of items) {
    const token = get(item, 'continuationItemRenderer', 'continuationEndpoint', 'continuationCommand', 'token');
    if (typeof token === 'string') return token;
  }
  return undefined;
}

function encodeToken(endpoint, continuation, meta) {
  const payload = JSON.stringify({ v: 1, e: endpoint, c: continuation, m: meta || undefined });
  return Buffer.from(payload, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeToken(token) {
  const bad = () => new CatalogError('bad-request', 'Token lanjutan tidak valid.', 400);
  if (typeof token !== 'string' || token.length < 8 || token.length > 6000 || !/^[A-Za-z0-9_-]+$/.test(token)) throw bad();
  let payload;
  try {
    payload = JSON.parse(Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch (error) {
    throw bad();
  }
  if (!isObject(payload) || payload.v !== 1 || !['browse', 'search', 'next'].includes(payload.e)
    || typeof payload.c !== 'string' || payload.c.length > 4000 || !/^[\x21-\x7e]+$/.test(payload.c)) throw bad();
  return { endpoint: payload.e, continuation: payload.c, meta: isObject(payload.m) ? payload.m : undefined };
}

// ---- sections --------------------------------------------------------------------------------

function sectionKind(items) {
  if (!items.length) return 'empty';
  const kinds = new Set(items.map((item) => item.kind));
  return kinds.size === 1 ? items[0].kind : 'mixed';
}

function parseCarousel(renderer, id, stats) {
  const header = get(renderer, 'header', 'musicCarouselShelfBasicHeaderRenderer');
  const items = parseItems(renderer.contents, stats);
  if (!items.length) return undefined;
  const more = browseEndpointOf(get(header, 'moreContentButton', 'buttonRenderer', 'navigationEndpoint'));
  return compact({
    id,
    title: text(get(header, 'title')),
    strapline: text(get(header, 'strapline')),
    layout: 'carousel',
    contentKind: sectionKind(items),
    items,
    more: more ? compact({ browseId: more.browseId, params: more.params }) : undefined,
  });
}

function parseShelf(renderer, id, stats) {
  const items = parseItems(renderer.contents, stats);
  const bottom = browseEndpointOf(get(renderer, 'bottomEndpoint')) || browseEndpointOf(get(renderer, 'title', 'runs', 0, 'navigationEndpoint'));
  const continuation = continuationIn(renderer);
  if (!items.length && !continuation) return undefined;
  return compact({
    id,
    title: text(renderer.title),
    layout: 'list',
    contentKind: sectionKind(items),
    items,
    more: bottom ? compact({ browseId: bottom.browseId, params: bottom.params }) : undefined,
    continuation: continuation ? { endpoint: 'browse', token: continuation } : undefined,
  });
}

function parseGrid(renderer, id, stats) {
  const items = parseItems(renderer.items, stats);
  if (!items.length) return undefined;
  return compact({ id, title: text(get(renderer, 'header', 'gridHeaderRenderer', 'title')), layout: 'grid', contentKind: sectionKind(items), items });
}

function parseCard(renderer, id, stats) {
  const title = text(renderer.title);
  const top = itemFromNavigation(title || '', runsOf(renderer.subtitle), get(renderer, 'title', 'runs', 0, 'navigationEndpoint'), thumbnailOf(renderer), {});
  const items = [];
  if (top && top.title) items.push(top);
  items.push(...parseItems(renderer.contents, stats));
  if (!items.length) return undefined;
  return { id, title: 'Top result', layout: 'list', contentKind: 'mixed', items, topResult: true };
}

function parseDescription(renderer, id) {
  const description = text(renderer.description);
  if (!description) return undefined;
  return compact({ id, title: text(renderer.header) || text(renderer.title), layout: 'text', contentKind: 'text', items: [], text: description });
}

function parseSectionContents(contents, stats, prefix) {
  const sections = [];
  const loose = [];
  asArray(contents).forEach((wrapper, index) => {
    if (!isObject(wrapper)) return;
    const id = (prefix || 's') + index;
    let section;
    if (wrapper.musicCarouselShelfRenderer) section = parseCarousel(wrapper.musicCarouselShelfRenderer, id, stats);
    else if (wrapper.musicShelfRenderer) section = parseShelf(wrapper.musicShelfRenderer, id, stats);
    else if (wrapper.musicPlaylistShelfRenderer) section = parseShelf(wrapper.musicPlaylistShelfRenderer, id, stats);
    else if (wrapper.gridRenderer) section = parseGrid(wrapper.gridRenderer, id, stats);
    else if (wrapper.musicCardShelfRenderer) section = parseCard(wrapper.musicCardShelfRenderer, id, stats);
    else if (wrapper.musicDescriptionShelfRenderer) section = parseDescription(wrapper.musicDescriptionShelfRenderer, id);
    else if (wrapper.itemSectionRenderer) {
      // YouTube Music's search now answers with a flat run of single-row sections (one result each, songs, videos,
      // albums, artists mixed) instead of titled shelves; those rows are kept together as one list, in order.
      const inner = asArray(get(wrapper, 'itemSectionRenderer', 'contents'));
      const rows = inner.filter((entry) => isObject(entry) && (entry.musicResponsiveListItemRenderer || entry.musicTwoRowItemRenderer));
      loose.push(...rows);
      const rest = inner.filter((entry) => !rows.includes(entry));
      if (rest.length) sections.push(...parseSectionContents(rest, stats, id + '.'));
      return;
    }
    if (section) sections.push(section);
  });
  if (loose.length) {
    // One list per kind, in the phone's order: songs, videos, albums, artists, playlists (anything else after them).
    const groups = new Map();
    for (const item of parseItems(loose, stats)) {
      if (!groups.has(item.kind)) groups.set(item.kind, []);
      groups.get(item.kind).push(item);
    }
    for (const kind of ['track', 'video', 'album', 'artist', 'playlist']) if (groups.has(kind)) sections.push({ id: (prefix || 's') + '.rows.' + kind, layout: 'list', contentKind: kind, items: groups.get(kind) });
    for (const [kind, items] of groups) if (!['track', 'video', 'album', 'artist', 'playlist'].includes(kind)) sections.push({ id: (prefix || 's') + '.rows.' + kind, layout: 'list', contentKind: kind, items });
  }
  return sections;
}

// ---- pages -----------------------------------------------------------------------------------

function requireContainer(value, what) {
  if (!isObject(value)) throw new CatalogError('invalid-response', 'Format ' + what + ' dari YouTube Music tidak dikenali.', 502);
  return value;
}

const singleColumnSectionList = (payload) => get(payload, 'contents', 'singleColumnBrowseResultsRenderer', 'tabs', 0, 'tabRenderer', 'content', 'sectionListRenderer');

function parseChips(sectionList) {
  return asArray(get(sectionList, 'header', 'chipCloudRenderer', 'chips')).map((chip) => {
    const renderer = get(chip, 'chipCloudChipRenderer');
    const endpoint = browseEndpointOf(get(renderer, 'navigationEndpoint'));
    const title = text(get(renderer, 'text'));
    return title && endpoint ? compact({ title, browseId: endpoint.browseId, params: endpoint.params }) : undefined;
  }).filter(Boolean);
}

function parseHome(payload) {
  const list = requireContainer(singleColumnSectionList(payload), 'beranda');
  const stats = { skipped: 0 };
  const sections = parseSectionContents(list.contents, stats, 'home');
  const token = continuationIn(list);
  return {
    chips: parseChips(list),
    sections,
    continuation: token ? { endpoint: 'browse', token, kind: 'home' } : undefined,
    skipped: stats.skipped,
  };
}

function parseSearch(payload, filter) {
  const tabs = get(payload, 'contents', 'tabbedSearchResultsRenderer', 'tabs');
  const list = requireContainer(get(first(tabs), 'tabRenderer', 'content', 'sectionListRenderer'), 'hasil pencarian');
  const stats = { skipped: 0 };
  const sections = parseSectionContents(list.contents, stats, 'search');
  const items = [];
  let token;
  for (const section of sections) {
    if (section.continuation) token = section.continuation.token;
    if (!section.topResult) items.push(...section.items);
    delete section.continuation;
  }
  if (!token) token = continuationIn(list);
  return {
    filter,
    sections,
    items,
    continuation: token ? { endpoint: 'search', token, kind: 'search' } : undefined,
    skipped: stats.skipped,
  };
}

function parseSuggestions(payload) {
  const contents = asArray(get(payload, 'contents'));
  const queries = asArray(get(contents[0], 'searchSuggestionsSectionRenderer', 'contents'))
    .map((entry) => joinRuns(runsOf(get(entry, 'searchSuggestionRenderer', 'suggestion'))))
    .filter(Boolean);
  const items = parseItems(asArray(get(contents[1], 'searchSuggestionsSectionRenderer', 'contents')));
  return { queries, items };
}

function parseHeaderBasics(header) {
  if (!isObject(header)) return {};
  const subtitleRuns = runsOf(header.subtitle);
  const strapline = runsOf(header.straplineTextOne);
  const fromStrapline = readSubtitle(strapline);
  const fromSubtitle = readSubtitle(subtitleRuns);
  const artists = fromStrapline.artists.length ? fromStrapline.artists : fromSubtitle.artists;
  const endpoints = asArray(header.buttons)
    .map((button) => watchEndpointOf(get(button, 'musicPlayButtonRenderer', 'playNavigationEndpoint') || get(button, 'buttonRenderer', 'navigationEndpoint')))
    .filter(Boolean);
  const play = endpoints.find((endpoint) => endpoint.playlistId);
  return compact({
    title: text(header.title),
    subtitle: joinRuns(subtitleRuns),
    secondSubtitle: joinRuns(runsOf(header.secondSubtitle)),
    description: text(get(header, 'description', 'musicDescriptionShelfRenderer', 'description')) || text(header.description),
    artists: artists.length ? artists : undefined,
    year: fromSubtitle.rest.find((value) => /^\d{4}$/.test(value)),
    artworkUrl: thumbnailOf(header),
    playlistId: play && play.playlistId,
  });
}

function detailHeader(payload) {
  const header = get(payload, 'contents', 'twoColumnBrowseResultsRenderer', 'tabs', 0, 'tabRenderer', 'content', 'sectionListRenderer', 'contents', 0);
  return get(header, 'musicResponsiveHeaderRenderer')
    || get(header, 'musicEditablePlaylistDetailHeaderRenderer', 'header', 'musicResponsiveHeaderRenderer')
    || get(header, 'musicDetailHeaderRenderer')
    || get(payload, 'header', 'musicDetailHeaderRenderer')
    || get(payload, 'header', 'musicEditablePlaylistDetailHeaderRenderer', 'header', 'musicDetailHeaderRenderer');
}

function parseDetailPage(payload, kind) {
  const header = requireContainer(detailHeader(payload), kind === 'album' ? 'album' : 'playlist');
  const secondary = requireContainer(get(payload, 'contents', 'twoColumnBrowseResultsRenderer', 'secondaryContents', 'sectionListRenderer'), kind === 'album' ? 'daftar lagu album' : 'daftar lagu playlist');
  const stats = { skipped: 0 };
  const sections = parseSectionContents(secondary.contents, stats, kind);
  const tracks = [];
  const related = [];
  let token;
  for (const section of sections) {
    const isTrackList = section.layout === 'list' && ['track', 'video', 'mixed'].includes(section.contentKind);
    if (!tracks.length && isTrackList) {
      tracks.push(...section.items.filter((item) => item.kind === 'track' || item.kind === 'video'));
      if (section.continuation) token = section.continuation.token;
      delete section.continuation;
    } else related.push(section);
  }
  token = token || continuationIn(secondary);
  return {
    header: parseHeaderBasics(header),
    tracks,
    related,
    continuation: token ? { endpoint: 'browse', token, kind: 'tracks' } : undefined,
    skipped: stats.skipped,
  };
}

function parseArtist(payload) {
  const header = requireContainer(get(payload, 'header', 'musicImmersiveHeaderRenderer') || get(payload, 'header', 'musicVisualHeaderRenderer') || get(payload, 'header', 'musicHeaderRenderer'), 'artis');
  const list = requireContainer(singleColumnSectionList(payload), 'halaman artis');
  const stats = { skipped: 0 };
  const sections = parseSectionContents(list.contents, stats, 'artist');
  const play = watchEndpointOf(get(header, 'playButton', 'buttonRenderer', 'navigationEndpoint'));
  const radio = watchEndpointOf(get(header, 'startRadioButton', 'buttonRenderer', 'navigationEndpoint'));
  const shelf = sections.find((section) => section.layout === 'list' && ['track', 'mixed'].includes(section.contentKind));
  return {
    header: compact({
      title: text(header.title),
      description: text(header.description),
      artworkUrl: thumbnailOf(header) || bestThumbnail(get(header, 'foregroundThumbnail', 'musicThumbnailRenderer', 'thumbnail', 'thumbnails')),
      subscribers: text(get(header, 'subscriptionButton', 'subscribeButtonRenderer', 'subscriberCountText')),
      monthlyListeners: text(header.monthlyListenerCount),
      playlistId: play && play.playlistId,
      radioPlaylistId: radio && radio.playlistId,
      radioVideoId: radio && radio.videoId,
    }),
    songs: shelf ? shelf.items : [],
    songsMore: shelf ? shelf.more : undefined,
    sections: sections.filter((section) => section !== shelf),
    skipped: stats.skipped,
  };
}

function parseGenericBrowse(payload) {
  const list = singleColumnSectionList(payload) || get(payload, 'contents', 'sectionListRenderer');
  const stats = { skipped: 0 };
  const title = text(get(payload, 'header', 'musicHeaderRenderer', 'title')) || text(get(payload, 'header', 'musicImmersiveHeaderRenderer', 'title'));
  requireContainer(list, 'halaman');
  const token = continuationIn(list);
  return {
    title,
    sections: parseSectionContents(list.contents, stats, 'browse'),
    continuation: token ? { endpoint: 'browse', token, kind: 'sections' } : undefined,
    skipped: stats.skipped,
  };
}

function parseBrowse(payload, browseId) {
  if (/^MPRE/.test(browseId)) return Object.assign({ type: 'album' }, parseDetailPage(payload, 'album'));
  if (/^(VL|PL|RD|OLAK|MPSP|LM)/.test(browseId)) return Object.assign({ type: 'playlist' }, parseDetailPage(payload, 'playlist'));
  if (/^(UC|MPLA)/.test(browseId)) return Object.assign({ type: 'artist' }, parseArtist(payload));
  return Object.assign({ type: 'page' }, parseGenericBrowse(payload));
}

function parseNext(payload) {
  const tabs = asArray(get(payload, 'contents', 'singleColumnMusicWatchNextResultsRenderer', 'tabbedRenderer', 'watchNextTabbedResultsRenderer', 'tabs'));
  const queue = get(tabs[0], 'tabRenderer', 'content', 'musicQueueRenderer');
  const panel = requireContainer(get(payload, 'continuationContents', 'playlistPanelContinuation') || get(queue, 'content', 'playlistPanelRenderer'), 'antrean berikutnya');
  const contents = asArray(panel.contents);
  const parsed = parseItems(contents);
  const automix = watchEndpointOf(get(contents[contents.length - 1], 'automixPreviewVideoRenderer', 'content', 'automixPlaylistVideoRenderer', 'navigationEndpoint'));
  const token = continuationIn(panel);
  const lyricsTab = browseEndpointOf(get(tabs[1], 'tabRenderer', 'endpoint'));
  const relatedTab = browseEndpointOf(get(tabs[2], 'tabRenderer', 'endpoint'));
  const selected = parsed.findIndex((item) => item.selected);
  return {
    items: parsed.map((item) => { const copy = Object.assign({}, item); delete copy.selected; return copy; }),
    currentIndex: selected >= 0 ? selected : undefined,
    automix: automix && automix.playlistId ? compact({ playlistId: automix.playlistId, videoId: automix.videoId, params: automix.params }) : undefined,
    continuation: token ? { endpoint: 'next', token, kind: 'next' } : undefined,
    lyricsBrowseId: lyricsTab && lyricsTab.browseId,
    relatedBrowseId: relatedTab && relatedTab.browseId,
    title: text(get(queue, 'header', 'musicQueueHeaderRenderer', 'subtitle')),
  };
}

function parseRelated(payload) {
  const list = requireContainer(get(payload, 'contents', 'sectionListRenderer'), 'rekomendasi terkait');
  const stats = { skipped: 0 };
  return { sections: parseSectionContents(list.contents, stats, 'related'), skipped: stats.skipped };
}

function parseContinuation(payload, meta) {
  const kind = meta && meta.kind;
  const endpoint = (meta && meta.endpoint) || 'browse';
  const stats = { skipped: 0 };
  if (get(payload, 'continuationContents', 'playlistPanelContinuation')) {
    const next = parseNext(payload);
    return { items: next.items, sections: [], continuation: next.continuation, skipped: 0 };
  }
  const container = get(payload, 'continuationContents', 'sectionListContinuation')
    || get(payload, 'continuationContents', 'musicShelfContinuation')
    || get(payload, 'continuationContents', 'musicPlaylistShelfContinuation');
  const appended = get(payload, 'onResponseReceivedActions', 0, 'appendContinuationItemsAction');
  if (isObject(container)) {
    const token = continuationIn(container);
    const items = parseItems(container.contents, stats);
    return {
      items,
      sections: items.length ? [] : parseSectionContents(container.contents, stats, 'more'),
      continuation: token ? { endpoint, token, kind } : undefined,
      skipped: stats.skipped,
    };
  }
  if (isObject(appended)) {
    const token = continuationIn({ continuationItems: appended.continuationItems });
    return { items: parseItems(appended.continuationItems, stats), sections: [], continuation: token ? { endpoint, token, kind } : undefined, skipped: stats.skipped };
  }
  throw new CatalogError('invalid-response', 'Lanjutan dari YouTube Music tidak dikenali.', 502);
}

// ---- requests --------------------------------------------------------------------------------

function context(locale) {
  const hl = locale && typeof locale.hl === 'string' && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(locale.hl) ? locale.hl : 'en';
  const gl = locale && typeof locale.gl === 'string' && /^[A-Z]{2}$/.test(locale.gl) ? locale.gl : 'US';
  return {
    client: { clientName: 'WEB_REMIX', clientVersion: WEB_REMIX_VERSION, hl, gl, visitorData: null },
    request: { useSsl: true, internalExperimentFlags: [] },
    user: { lockedSafetyMode: false, onBehalfOfUser: null },
  };
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const BROWSE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const PARAMS_PATTERN = /^[A-Za-z0-9_%=+/-]{1,512}$/;

function requireString(value, pattern, what) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new CatalogError('bad-request', what + ' tidak valid.', 400);
  return value;
}
function optionalString(value, pattern, what) {
  return value === undefined || value === null || value === '' ? undefined : requireString(value, pattern, what);
}

/**
 * Validates one catalog operation and returns what to send upstream. Nothing here accepts a URL:
 * the upstream path is chosen from a fixed table.
 */
function buildOperation(operation, params) {
  const p = isObject(params) ? params : {};
  const base = { context: context(isObject(p.locale) ? p.locale : {}) };
  const token = isObject(p.continuation) ? p.continuation.token : p.continuation;
  const continuation = token !== undefined && token !== null ? decodeToken(token) : undefined;
  const resume = () => ({
    path: '/youtubei/v1/' + continuation.endpoint,
    body: Object.assign({}, base, { continuation: continuation.continuation }),
    continuation,
  });
  if (continuation && ['home', 'search', 'browse', 'next'].includes(operation)) return resume();
  switch (operation) {
    case 'home':
      return { path: '/youtubei/v1/browse', body: Object.assign({}, base, compact({ browseId: 'FEmusic_home', params: optionalString(p.params, PARAMS_PATTERN, 'Params') })) };
    case 'search': {
      const query = typeof p.query === 'string' ? p.query.trim() : '';
      if (!query || query.length > 200) throw new CatalogError('bad-request', 'Kata kunci pencarian tidak valid.', 400);
      const filter = p.filter === undefined || p.filter === 'all' ? 'all' : p.filter;
      if (filter !== 'all' && !SEARCH_FILTERS[filter]) throw new CatalogError('bad-request', 'Filter pencarian tidak valid.', 400);
      return { path: '/youtubei/v1/search', body: Object.assign({}, base, { query }, filter === 'all' ? {} : { params: SEARCH_FILTERS[filter] }), filter };
    }
    case 'suggest': {
      const input = typeof p.query === 'string' ? p.query.trim() : '';
      if (!input || input.length > 120) throw new CatalogError('bad-request', 'Kata kunci saran tidak valid.', 400);
      return { path: '/youtubei/v1/music/get_search_suggestions', body: Object.assign({}, base, { input }) };
    }
    case 'browse': {
      const browseId = requireString(p.browseId, BROWSE_ID_PATTERN, 'Browse ID');
      return { path: '/youtubei/v1/browse', body: Object.assign({}, base, compact({ browseId, params: optionalString(p.params, PARAMS_PATTERN, 'Params') })), browseId };
    }
    case 'next': {
      const videoId = optionalString(p.videoId, ID_PATTERN, 'Video ID');
      const playlistId = optionalString(p.playlistId, BROWSE_ID_PATTERN, 'Playlist ID');
      if (!videoId && !playlistId) throw new CatalogError('bad-request', 'videoId atau playlistId diperlukan.', 400);
      const index = p.index === undefined ? undefined : Number(p.index);
      if (index !== undefined && (!Number.isInteger(index) || index < 0 || index > 10000)) throw new CatalogError('bad-request', 'Index tidak valid.', 400);
      return {
        path: '/youtubei/v1/next',
        body: Object.assign({}, base, compact({ videoId, playlistId, index, params: optionalString(p.params, PARAMS_PATTERN, 'Params'), isAudioOnly: true, tunerSettingValue: 'AUTOMIX_SETTING_NORMAL' })),
      };
    }
    case 'related': {
      const browseId = requireString(p.browseId, BROWSE_ID_PATTERN, 'Browse ID');
      return { path: '/youtubei/v1/browse', body: Object.assign({}, base, { browseId }), browseId };
    }
    default:
      throw new CatalogError('not-found', 'Operasi katalog tidak dikenal.', 404);
  }
}

function sealContinuation(continuation) {
  if (!continuation || !continuation.token) return undefined;
  return { token: encodeToken(continuation.endpoint, continuation.token, { kind: continuation.kind, endpoint: continuation.endpoint }) };
}

function sealPage(page) {
  if (page.continuation) page.continuation = sealContinuation(page.continuation);
  for (const key of ['sections', 'related']) {
    for (const section of asArray(page[key])) if (section.continuation) section.continuation = sealContinuation(Object.assign({ kind: 'sections' }, section.continuation));
  }
  return page;
}

/** Turns an upstream payload into the normalised page for `operation`. */
function parseOperation(operation, request, payload) {
  if (!isObject(payload)) throw new CatalogError('invalid-response', 'YouTube Music mengirim respons yang tidak bisa dibaca.', 502);
  if (request.continuation) return sealPage(parseContinuation(payload, request.continuation.meta));
  switch (operation) {
    case 'home': return sealPage(parseHome(payload));
    case 'search': return sealPage(parseSearch(payload, request.filter));
    case 'suggest': return parseSuggestions(payload);
    case 'browse': return sealPage(parseBrowse(payload, request.browseId));
    case 'next': return sealPage(parseNext(payload));
    case 'related': return parseRelated(payload);
    default: throw new CatalogError('not-found', 'Operasi katalog tidak dikenal.', 404);
  }
}

module.exports = {
  API_ORIGIN, WEB_REMIX_VERSION, SEARCH_FILTERS, CatalogError,
  buildOperation, parseOperation, parseHome, parseSearch, parseSuggestions, parseBrowse, parseNext,
  parseRelated, parseContinuation, encodeToken, decodeToken, parseDurationMs,
};
