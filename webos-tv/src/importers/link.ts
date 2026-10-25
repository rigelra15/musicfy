import type { CatalogGateway } from '../catalog/gateway';
import { detailTracks } from '../features/detail/convert';
import type { Track } from '../model';
import { runtimeFetch } from '../platform/runtime';
import type { ImportedTrack } from './matcher';
import { tr } from '../app/i18n';

export type LinkProvider = 'spotify' | 'applemusic' | 'deezer' | 'youtube';
export interface LinkTrack extends ImportedTrack {
  /** Present when the source already names the exact YouTube song, so nothing has to be searched. */
  resolved?: Track;
}
export interface LinkPreview {
  provider: LinkProvider;
  kind: 'playlist' | 'album';
  remoteId: string;
  url: string;
  name: string;
  cover?: string;
  tracks: LinkTrack[];
  warnings: string[];
}

export class LinkImportError extends Error {
  constructor(readonly kind: 'badLink' | 'private' | 'rateLimited' | 'changed' | 'empty' | 'network' | 'upstream' | 'mix', message: string) {
    super(message);
    this.name = 'LinkImportError';
  }
}

const MAX_PAGES = 60;
const YT_HOST = /^(?:www\.|music\.|m\.)?youtube\.com$|^youtu\.be$/;

/** Playlist/album ids a YouTube address carries, or undefined when it is not one. */
export function parseYouTubeLink(text: string): { kind: 'playlist' | 'album'; id: string } | undefined {
  const found = /https?:\/\/\S+/.exec(text);
  if (!found) return undefined;
  let url: URL;
  try { url = new URL(found[0]); } catch { return undefined; }
  if (!YT_HOST.test(url.hostname)) return undefined;
  const list = url.searchParams.get('list');
  if (list && /^[A-Za-z0-9_-]{10,80}$/.test(list)) return { kind: 'playlist', id: list };
  const browse = /^\/browse\/(MPRE[A-Za-z0-9_-]+)$/.exec(url.pathname);
  if (browse) return { kind: 'album', id: browse[1] };
  return undefined;
}

/** Whether a pasted text is a YouTube address at all (so a wrong one gets a YouTube-specific answer). */
export const looksLikeYouTube = (text: string) => /https?:\/\/(?:[a-z]+\.)?(?:youtube\.com|youtu\.be)\b/i.test(text);

export async function readYouTube(link: { kind: 'playlist' | 'album'; id: string }, catalog: Pick<CatalogGateway, 'playlist' | 'album' | 'more'>, signal?: AbortSignal): Promise<LinkPreview> {
  // "Mix" lists (RD…) are generated radio, different every time: there is no list to copy.
  if (/^(?:RD|UL)/.test(link.id) && link.kind === 'playlist') throw new LinkImportError('mix', tr('err.link.mix'));
  let page;
  try { page = link.kind === 'album' ? await catalog.album(link.id, signal) : await catalog.playlist(link.id, signal); } catch (error) {
    const kind = (error as { kind?: string }).kind;
    if (kind === 'not-found' || kind === 'forbidden') throw new LinkImportError('private', tr('err.link.private'));
    if (kind === 'rate-limited') throw new LinkImportError('rateLimited', tr('err.link.limited'));
    if (kind === 'aborted') throw error;
    throw new LinkImportError('network', error instanceof Error ? error.message : tr('err.link.cannotRead'));
  }
  const tracks = detailTracks(page.tracks, page.header);
  const warnings: string[] = [];
  let continuation = page.continuation;
  for (let pageNo = 0; continuation && pageNo < MAX_PAGES; pageNo += 1) {
    try {
      const more = await catalog.more('browse', continuation, signal);
      tracks.push(...detailTracks(more.items, page.header));
      continuation = more.continuation;
    } catch (error) {
      if ((error as { kind?: string }).kind === 'aborted') throw error;
      warnings.push(tr('err.link.partial', { count: tracks.length }));
      break;
    }
  }
  if (!tracks.length) throw new LinkImportError('empty', tr('err.link.noSongs'));
  const id = page.header.playlistId ?? link.id.replace(/^VL/, '');
  return {
    provider: 'youtube', kind: link.kind, remoteId: id, url: link.kind === 'album' ? `https://music.youtube.com/browse/${link.id}` : `https://music.youtube.com/playlist?list=${id}`,
    name: page.header.title || 'YouTube Music', cover: page.header.artworkUrl, warnings,
    tracks: tracks.map((track) => ({ title: track.title, artist: track.artist, album: track.album, durationMs: track.durationMs || undefined, resolved: track })),
  };
}

/** What went wrong reading a link, in the language on screen. The service's own words are never shown. */
function linkMessage(kind: string, status: number): string {
  if (kind === 'private') return tr('err.link.private');
  if (kind === 'empty') return tr('err.link.noSongs');
  if (kind === 'rateLimited') return tr('err.link.limited');
  if (kind === 'changed') return tr('err.service.unrecognized');
  if (kind === 'network') return tr('err.service.unreachable');
  return tr('err.service.status', { status });
}

const MESSAGES: Record<string, LinkImportError['kind']> = { badLink: 'badLink', private: 'private', rateLimited: 'rateLimited', changed: 'changed', empty: 'empty', network: 'network' };

/** Asks the service to read a Spotify, Apple Music or Deezer share link. */
export async function readServiceLink(link: string, fetcher: typeof runtimeFetch = runtimeFetch, signal?: AbortSignal): Promise<LinkPreview> {
  let response: Response;
  try {
    response = await fetcher('/api/import/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ link }), signal });
  } catch (error) {
    if (signal?.aborted || (error as { name?: string })?.name === 'AbortError') throw error;
    throw new LinkImportError('network', tr('err.service.unreachable'));
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = undefined; }
  const data = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (!response.ok) throw new LinkImportError(MESSAGES[String(data.kind)] ?? 'upstream', linkMessage(String(data.kind), response.status));
  const tracks = Array.isArray(data.tracks) ? data.tracks.flatMap((item): LinkTrack[] => {
    const t = item as Record<string, unknown>;
    return typeof t?.title === 'string' && t.title ? [{ title: t.title, artist: typeof t.artist === 'string' ? t.artist : '', ...(typeof t.album === 'string' ? { album: t.album } : {}), ...(typeof t.durationMs === 'number' && t.durationMs > 0 ? { durationMs: t.durationMs } : {}) }] : [];
  }) : [];
  if (!tracks.length || typeof data.source !== 'string' || typeof data.remoteId !== 'string') throw new LinkImportError('upstream', tr('err.service.unrecognized'));
  return {
    provider: data.source as LinkProvider, kind: data.kind === 'album' ? 'album' : 'playlist', remoteId: data.remoteId, url: String(data.url ?? ''),
    name: typeof data.name === 'string' && data.name ? data.name : 'Playlist', ...(typeof data.cover === 'string' ? { cover: data.cover } : {}),
    tracks, warnings: Array.isArray(data.warnings) ? data.warnings.filter((w): w is string => typeof w === 'string') : [],
  };
}

export async function readLink(text: string, deps: { catalog: Pick<CatalogGateway, 'playlist' | 'album' | 'more'>; fetcher?: typeof runtimeFetch; signal?: AbortSignal }): Promise<LinkPreview> {
  const trimmed = text.trim();
  if (!trimmed) throw new LinkImportError('badLink', tr('err.link.paste'));
  const youtube = parseYouTubeLink(trimmed);
  if (youtube) return readYouTube(youtube, deps.catalog, deps.signal);
  if (looksLikeYouTube(trimmed)) throw new LinkImportError('badLink', tr('err.link.notPlaylist'));
  return readServiceLink(trimmed, deps.fetcher, deps.signal);
}
