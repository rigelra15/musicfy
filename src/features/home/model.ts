import type { CatalogItem } from '../../catalog/types';
import type { Track } from '../../model';

export type HomeItemKind = 'track' | 'video' | 'album' | 'artist' | 'playlist' | 'link' | 'liked' | 'localPlaylist';

/** One card on Home. Online cards carry ids only; nothing here is invented. */
export interface HomeItem {
  /** Unique within its row. */
  key: string;
  kind: HomeItemKind;
  id: string;
  title: string;
  subtitle?: string;
  artworkUrl?: string;
  /** Playable item (track or video). */
  track?: Track;
  browseId?: string;
  playlistId?: string;
  params?: string;
  color?: string;
  /** Songs inside a local playlist or the liked card; shown by the UI in the user's language. */
  count?: number;
}

export type HomeRowKind =
  | 'recent' | 'quick' | 'mostPlayed' | 'history' | 'forgotten' | 'keepListening' | 'localPlaylists'
  | 'feed' | 'newReleases' | 'charts' | 'community' | 'live' | 'videos'
  | 'because' | 'moreLike' | 'newGenre' | 'newFromArtists' | 'similar' | 'artists';

export interface HomeRow {
  id: string;
  kind: HomeRowKind;
  title: string;
  /** Seed such as the song or artist a recommendation grew from. */
  subtitle?: string;
  origin: 'local' | 'online';
  items: HomeItem[];
  more?: { browseId: string; params?: string };
  /** Opens this row as its own page (Home section detail). */
  detail?: boolean;
}

export interface ContentFilters {
  hideExplicit: boolean;
  hideVideoSongs: boolean;
}
export const NO_FILTERS: ContentFilters = { hideExplicit: false, hideVideoSongs: false };

export const artistNames = (artists: ReadonlyArray<{ name: string }> | undefined, fallback = '') =>
  artists && artists.length ? artists.map((artist) => artist.name).join(', ') : fallback;

const SUBTITLE_TYPE = /^(song|lagu|video|episode|episod|single|album|ep|playlist|artist|artis|podcast)$/i;
const SUBTITLE_DURATION = /^\d+[.:]\d{2}(?:[.:]\d{2})?$/;
const SUBTITLE_COUNT = /\b(views?|ditonton|plays?|diputar|monthly|bulanan|subscribers?|pelanggan|songs?|lagu)\b/i;

/**
 * Who made a song, read from a catalog subtitle when its row names no artist: the parts that are not a type label
 * ("Lagu"), a length ("4.02") or a count ("327 rb x ditonton") are the artist. An album or playlist page leaves the
 * artist out of its rows (it is the page's), so this may well be empty, and the caller then fills it from the page.
 */
export function artistFromSubtitle(subtitle: string): string {
  const parts = subtitle.split(' • ').map((part) => part.trim()).filter(Boolean);
  return parts.filter((part, index) => !(index === 0 && parts.length > 1 && SUBTITLE_TYPE.test(part)) && !SUBTITLE_DURATION.test(part) && !SUBTITLE_COUNT.test(part)).join(', ');
}

/** An artist field that is really a whole subtitle ("Lagu • 4.02", from rows saved before this was understood) turned back into an artist. */
export function sanitizeArtist(artist: string): string {
  if (!artist.includes(' • ')) return artist;
  const first = artist.split(' • ')[0].trim();
  return SUBTITLE_TYPE.test(first) || SUBTITLE_DURATION.test(artist.split(' • ').pop() ?? '') ? artistFromSubtitle(artist) : artist;
}

export function trackFromCatalog(item: CatalogItem): Track {
  return {
    id: item.id,
    title: item.title,
    artist: artistNames(item.artists, artistFromSubtitle(item.subtitle ?? '')),
    album: item.album?.name,
    albumId: item.album?.id,
    artworkUrl: item.artworkUrl,
    durationMs: item.durationMs ?? 0,
    provider: 'youtube',
    artists: item.artists?.map((artist) => ({ id: artist.id, name: artist.name })),
    explicit: item.isExplicit,
    isVideo: item.kind === 'video' ? true : undefined,
  };
}

export function homeItemFromCatalog(item: CatalogItem): HomeItem {
  const playable = item.kind === 'track' || item.kind === 'video';
  return {
    key: `${item.kind}:${item.id}`,
    kind: item.kind,
    id: item.id,
    title: item.title,
    subtitle: playable ? artistNames(item.artists, item.subtitle) : item.subtitle,
    artworkUrl: item.artworkUrl,
    track: playable ? trackFromCatalog(item) : undefined,
    browseId: item.browseId,
    playlistId: item.playlistId,
    params: item.params,
    color: item.color,
  };
}

export function homeItemFromTrack(track: Track): HomeItem {
  return {
    key: `track:${track.id}`,
    kind: track.isVideo ? 'video' : 'track',
    id: track.id,
    title: track.title,
    subtitle: track.artist,
    artworkUrl: track.artworkUrl,
    track,
  };
}

export function applyFilters(items: HomeItem[], filters: ContentFilters): HomeItem[] {
  return items.filter((item) => {
    if (filters.hideVideoSongs && (item.kind === 'video' || item.track?.isVideo)) return false;
    if (filters.hideExplicit && item.track?.explicit) return false;
    return true;
  });
}

export function dedupe(items: HomeItem[]): HomeItem[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.key) ? false : (seen.add(item.key), true)));
}
