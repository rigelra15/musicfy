import type { LyricsDocument, LyricsLine, Track } from '../model';
import { parseLrc } from './lrcParser';
import { tr } from '../app/i18n';

export type LyricsLookupErrorKind = 'network' | 'http' | 'invalid-response';

type JsonRecord = Record<string, unknown>;

const DEFAULT_BASE_URL = 'https://lrclib.net';
const DURATION_MATCH_TOLERANCE_SECONDS = 3;

export class LyricsLookupError extends Error {
  readonly name = 'LyricsLookupError';

  constructor(
    readonly kind: LyricsLookupErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function matchesArtist(recordArtist: string, requestedArtist: string): boolean {
  const actual = normalizedText(recordArtist);
  const normalizedRequestedArtist = normalizedText(requestedArtist);
  if (!actual || !normalizedRequestedArtist) return false;

  const requested = requestedArtist
    .split(/[,;&]|\bfeat(?:uring)?\.?/i)
    .map(normalizedText)
    .filter(Boolean);
  return requested.some((artist) => artist === actual) || actual === normalizedRequestedArtist;
}

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

interface Candidate {
  lines: LyricsLine[];
  plainLyrics?: string;
  durationDifference: number;
}

function candidateFromRecord(value: unknown, track: Track): Candidate | undefined {
  if (!isRecord(value)) return undefined;
  const trackName = nonEmptyText(value.trackName);
  const artistName = nonEmptyText(value.artistName);
  const normalizedTrackName = trackName ? normalizedText(trackName) : '';
  const normalizedRequestedTitle = normalizedText(track.title);
  if (
    !trackName ||
    !artistName ||
    !normalizedTrackName ||
    !normalizedRequestedTitle ||
    normalizedTrackName !== normalizedRequestedTitle ||
    !matchesArtist(artistName, track.artist)
  ) {
    return undefined;
  }

  const duration = typeof value.duration === 'number' ? value.duration : Number(value.duration);
  const durationDifference = Number.isFinite(duration) && duration > 0
    ? Math.abs(duration - track.durationMs / 1000)
    : Number.POSITIVE_INFINITY;

  return {
    lines: parseLrc(nonEmptyText(value.syncedLyrics) ?? ''),
    plainLyrics: nonEmptyText(value.plainLyrics),
    durationDifference,
  };
}

function closest(candidates: Candidate[]): Candidate | undefined {
  return candidates.sort((left, right) => left.durationDifference - right.durationDifference)[0];
}

function selectLyrics(candidates: Candidate[]): LyricsDocument {
  const timedMatches = candidates
    .filter(
      ({ lines, durationDifference }) =>
        lines.length > 0 && durationDifference <= DURATION_MATCH_TOLERANCE_SECONDS,
    );
  const timedMatch = closest(timedMatches);
  if (timedMatch) return { type: 'synced', lines: timedMatch.lines };

  const plainMatch = closest(candidates.filter((candidate) => candidate.plainLyrics));
  if (plainMatch?.plainLyrics) return { type: 'plain', text: plainMatch.plainLyrics };

  return { type: 'missing' };
}

function searchUrl(track: Track): string {
  const query = new URLSearchParams({
    track_name: track.title,
    artist_name: track.artist,
  });
  if (track.album?.trim()) query.set('album_name', track.album.trim());
  const baseUrl = import.meta.env.VITE_LRCLIB_API_BASE_URL?.trim() || DEFAULT_BASE_URL;
  return `${baseUrl.replace(/\/+$/, '')}/api/search?${query.toString()}`;
}

export async function loadLyrics(track: Track, fetcher: typeof fetch = fetch): Promise<LyricsDocument> {
  let response: Response;
  try {
    response = await fetcher(searchUrl(track), {
      method: 'GET',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new LyricsLookupError(
      'network',
      tr('err.lrclib.network'),
    );
  }

  if (!response.ok) {
    throw new LyricsLookupError(
      'http',
      response.status === 429
        ? tr('err.lrclib.limited')
        : tr('err.lrclib.failed'),
      response.status,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new LyricsLookupError(
      'invalid-response',
      tr('err.lrclib.unreadable'),
    );
  }

  if (!Array.isArray(payload)) {
    throw new LyricsLookupError(
      'invalid-response',
      tr('err.lrclib.format'),
    );
  }

  const candidates = payload
    .map((record) => candidateFromRecord(record, track))
    .filter((candidate): candidate is Candidate => candidate !== undefined);
  return selectLyrics(candidates);
}
