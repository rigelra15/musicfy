import { runtimeFetch } from '../platform/runtime';
import { apiBaseUrl } from './apiBase';
import type { Track } from '../model';
import { tr } from '../app/i18n';

const SONG_FILTER = 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D';
const WEB_REMIX_VERSION = '1.20260707.12.00';

type JsonRecord = Record<string, unknown>;
export type YouTubeSearchErrorKind = 'network' | 'http' | 'invalid-response';

export class YouTubeSearchError extends Error {
  readonly name = 'YouTubeSearchError';

  constructor(
    readonly kind: YouTubeSearchErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.text !== 'string') return undefined;
  const normalized = value.text.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function record(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseDurationMs(value: string | undefined): number {
  if (!value) return 0;
  const match = /^(?:(\d+)[:.])?(\d+)[:.](\d{2})$/.exec(value.trim());
  if (!match) return 0;

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  return ((hours * 60 + minutes) * 60 + seconds) * 1000;
}

function splitMetadataRuns(runs: unknown[]): JsonRecord[][] {
  const groups: JsonRecord[][] = [[]];

  for (const value of runs) {
    const run = record(value);
    if (!run) continue;

    if (run.text === ' • ') groups.push([]);
    else groups[groups.length - 1].push(run);
  }

  return groups;
}

function parseSongRow(value: unknown): Track | undefined {
  const renderer = record(record(value)?.musicResponsiveListItemRenderer);
  if (!renderer) return undefined;

  const endpoint = record(renderer.navigationEndpoint);
  const isSong =
    endpoint === undefined ||
    record(endpoint.watchEndpoint) !== undefined ||
    record(endpoint.watchPlaylistEndpoint) !== undefined;
  if (!isSong) return undefined;

  const playlistItem = record(renderer.playlistItemData);
  const id = typeof playlistItem?.videoId === 'string' ? playlistItem.videoId.trim() : '';
  const flexColumns = array(renderer.flexColumns).map(record);
  const titleColumn = record(flexColumns[0]?.musicResponsiveListItemFlexColumnRenderer);
  const titleRuns = array(record(titleColumn?.text)?.runs);
  const title = text(titleRuns[0]);
  if (!id || !title) return undefined;

  const metadataColumn = record(flexColumns[1]?.musicResponsiveListItemFlexColumnRenderer);
  const metadataRuns = array(record(metadataColumn?.text)?.runs);
  const groups = splitMetadataRuns(metadataRuns);
  const artistNames = (groups[0] ?? [])
    .filter((_, index) => index % 2 === 0)
    .map(text)
    .filter((name): name is string => name !== undefined);
  const albumRun = (groups[1] ?? []).find((run) =>
    record(record(run.navigationEndpoint)?.browseEndpoint),
  );
  const durationText = text(groups[groups.length - 1]?.[0]);

  const thumbnail = record(record(renderer.thumbnail)?.musicThumbnailRenderer);
  const thumbnails = array(record(thumbnail?.thumbnail)?.thumbnails);
  const lastThumbnail = record(thumbnails[thumbnails.length - 1]);
  const artworkUrl =
    typeof lastThumbnail?.url === 'string' && lastThumbnail.url.trim().length > 0
      ? lastThumbnail.url.trim()
      : undefined;

  return {
    id,
    title,
    artist: artistNames.join(', ') || tr('track.unknownArtist'),
    ...(text(albumRun) ? { album: text(albumRun) } : {}),
    ...(artworkUrl ? { artworkUrl } : {}),
    durationMs: parseDurationMs(durationText),
  };
}

export function parseSearchResponse(payload: unknown): Track[] {
  const contents = record(record(payload)?.contents);
  const tabbedResults = record(contents?.tabbedSearchResultsRenderer);
  const tabs = array(tabbedResults?.tabs);
  const firstTab = record(record(tabs[0])?.tabRenderer);
  const content = record(firstTab?.content);
  const sectionList = record(content?.sectionListRenderer);
  const sections = sectionList?.contents;

  if (!Array.isArray(sections)) {
    throw new YouTubeSearchError(
      'invalid-response',
      tr('err.ytm.format'),
    );
  }

  const musicShelf = sections
    .map((section) => record(record(section)?.musicShelfRenderer))
    .find((shelf): shelf is JsonRecord => shelf !== undefined);
  if (!musicShelf) return [];

  return array(musicShelf.contents)
    .map(parseSongRow)
    .filter((track): track is Track => track !== undefined);
}

function searchUrl(): string {
  const configuredBase = apiBaseUrl();
  return `${configuredBase.replace(/\/+$/, '')}/youtubei/v1/search?prettyPrint=false`;
}

export async function searchSongs(query: string, fetcher: typeof fetch = runtimeFetch): Promise<Track[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  let response: Response;
  try {
    response = await fetcher(searchUrl(), {
      method: 'POST',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Format-Version': '1',
        'X-YouTube-Client-Name': '67',
        'X-YouTube-Client-Version': WEB_REMIX_VERSION,
        'X-Origin': 'https://music.youtube.com',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: WEB_REMIX_VERSION,
            gl: 'ID',
            hl: 'id',
            visitorData: null,
          },
          request: { useSsl: true, internalExperimentFlags: [] },
          user: { lockedSafetyMode: false, onBehalfOfUser: null },
        },
        query: normalizedQuery,
        params: SONG_FILTER,
      }),
    });
  } catch {
    throw new YouTubeSearchError(
      'network',
      tr('err.ytm.network'),
    );
  }

  if (!response.ok) {
    const message = response.status === 429
      ? tr('err.ytm.limited')
      : tr('err.ytm.failed');
    throw new YouTubeSearchError('http', message, response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new YouTubeSearchError(
      'invalid-response',
      tr('err.ytm.unreadable'),
    );
  }

  return parseSearchResponse(payload);
}
