import { runtimeFetch } from '../platform/runtime';
import { apiBaseUrl } from './apiBase';
import { tr } from '../app/i18n';
export interface ResolvedStream {
  url: string;
  mimeType: string;
  expiresAtMs?: number;
  /** The song's description (YouTube's `videoDetails.shortDescription`), for "About song". */
  description?: string;
  /** `progressive` is one file the audio element opens; `hls` goes through the player library (and its DRM). */
  format?: 'progressive' | 'hls';
  drm?: { licenseUrl: string };
  /** Where the audio really came from and what it is, for the badge. */
  source?: StreamSource;
}

export interface StreamSource {
  provider: 'youtube' | 'monochrome' | 'applemusic';
  label: string;
  /** What the source sent ("AAC · 128 kbps", "FLAC", "AAC 256"): never a promise, only what was sent. */
  quality: string;
  codec?: string;
  sampleRateHz?: number;
  /** Sources tried first that did not play, and why: shown so a fallback is never silent. */
  skipped?: Array<{ provider: string; kind: string; reason: string }>;
}

export type YouTubePlaybackErrorKind =
  | 'network'
  | 'http'
  | 'unplayable'
  | 'unsupported-format'
  | 'expired'
  | 'invalid-response';

type JsonRecord = Record<string, unknown>;

const VISIONOS_VERSION = '0.1';

export class YouTubePlaybackError extends Error {
  readonly name = 'YouTubePlaybackError';

  constructor(
    readonly kind: YouTubePlaybackErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function parseVisitorData(rawBody: string): string {
  const body = rawBody.startsWith(")]}'") ? rawBody.slice(5).trim() : rawBody.trim();
  let payload: unknown;

  try {
    payload = JSON.parse(body);
  } catch {
    throw new YouTubePlaybackError(
      'invalid-response',
      tr('err.yt.guestUnreadable'),
    );
  }

  const nested = Array.isArray(payload) && Array.isArray(payload[0]) ? payload[0][2] : undefined;
  if (!Array.isArray(nested)) {
    throw new YouTubePlaybackError(
      'invalid-response',
      tr('err.yt.guestMissing'),
    );
  }

  const visitorData = nested.find(
    (candidate): candidate is string =>
      typeof candidate === 'string' && /^Cg[ts]/.test(candidate),
  );
  if (!visitorData) {
    throw new YouTubePlaybackError(
      'invalid-response',
      tr('err.yt.guestMissing'),
    );
  }

  return visitorData;
}

async function fetchVisitorData(fetcher: typeof fetch): Promise<string> {
  let response: Response;
  try {
    response = await fetcher(`${apiBaseUrl().replace(/\/+$/, '')}/sw.js_data`, {
      method: 'GET',
      credentials: 'omit',
      headers: { Accept: 'application/json, text/plain, */*' },
    });
  } catch {
    throw new YouTubePlaybackError(
      'network',
      tr('err.yt.guestNetwork'),
    );
  }

  if (!response.ok) {
    throw new YouTubePlaybackError(
      'http',
      'YouTube Music menolak permintaan sesi pemutar.',
      response.status,
    );
  }

  return parseVisitorData(await response.text());
}

function parseExpiresAtMs(streamUrl: string, expiresInSeconds: unknown, nowMs: number): number | undefined {
  let responseExpiry: number | undefined;
  if (typeof expiresInSeconds === 'number' && Number.isFinite(expiresInSeconds)) {
    responseExpiry = nowMs + expiresInSeconds * 1000;
  } else if (typeof expiresInSeconds === 'string' && /^\d+$/.test(expiresInSeconds)) {
    responseExpiry = nowMs + Number(expiresInSeconds) * 1000;
  }

  let urlExpiry: number | undefined;
  try {
    const seconds = new URL(streamUrl).searchParams.get('expire');
    if (seconds && /^\d+$/.test(seconds)) urlExpiry = Number(seconds) * 1000;
  } catch {
    throw new YouTubePlaybackError(
      'unsupported-format',
      tr('err.yt.badAudioUrl'),
    );
  }

  if (responseExpiry === undefined) return urlExpiry;
  return urlExpiry === undefined ? responseExpiry : Math.min(responseExpiry, urlExpiry);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export async function resolveAudioStream(
  videoId: string,
  fetcher: typeof fetch = runtimeFetch,
  nowMs = Date.now(),
): Promise<ResolvedStream> {
  const visitorData = await fetchVisitorData(fetcher);
  const base = apiBaseUrl().replace(/\/+$/, '');
  const playerUrl = `${base}/youtubei/v1/player?prettyPrint=false`;

  let response: Response;
  try {
    response = await fetcher(playerUrl, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Format-Version': '1',
        'X-Goog-Visitor-Id': visitorData,
        'X-YouTube-Client-Name': '101',
        'X-YouTube-Client-Version': VISIONOS_VERSION,
        'X-Origin': 'https://music.youtube.com',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'VISIONOS',
            clientVersion: VISIONOS_VERSION,
            osName: 'visionOS',
            osVersion: '1.3.21O771',
            deviceMake: 'Apple',
            deviceModel: 'RealityDevice14,1',
            gl: 'ID',
            hl: 'id',
            visitorData,
          },
          request: { useSsl: true, internalExperimentFlags: [] },
          user: { lockedSafetyMode: false, onBehalfOfUser: null },
        },
        videoId,
        playlistId: null,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    });
  } catch {
    throw new YouTubePlaybackError(
      'network',
      tr('err.yt.audioNetwork'),
    );
  }

  if (!response.ok) {
    throw new YouTubePlaybackError(
      'http',
      'YouTube Music menolak permintaan audio.',
      response.status,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new YouTubePlaybackError(
      'invalid-response',
      tr('err.yt.audioUnreadable'),
    );
  }

  const playerResponse = isRecord(payload) ? payload : undefined;
  const playabilityStatus = isRecord(playerResponse?.playabilityStatus)
    ? playerResponse.playabilityStatus.status
    : undefined;
  if (playabilityStatus !== 'OK') {
    throw new YouTubePlaybackError(
      'unplayable',
      tr('err.yt.notPlayable'),
    );
  }

  const streamingData = isRecord(playerResponse?.streamingData)
    ? playerResponse.streamingData
    : undefined;
  const formats = Array.isArray(streamingData?.adaptiveFormats)
    ? streamingData.adaptiveFormats.filter(isRecord)
    : [];
  const directAudioFormats = formats
    .filter((format) => {
      const mimeType = asString(format.mimeType);
      const url = asString(format.url);
      return mimeType?.startsWith('audio/') === true && url !== undefined;
    })
    .sort((left, right) => {
      const leftIsAac = asString(left.mimeType)?.startsWith('audio/mp4') ? 1 : 0;
      const rightIsAac = asString(right.mimeType)?.startsWith('audio/mp4') ? 1 : 0;
      if (leftIsAac !== rightIsAac) return rightIsAac - leftIsAac;
      const leftBitrate = typeof left.bitrate === 'number' ? left.bitrate : 0;
      const rightBitrate = typeof right.bitrate === 'number' ? right.bitrate : 0;
      return rightBitrate - leftBitrate;
    });

  const format = directAudioFormats[0];
  if (!format) {
    const hasCipheredAudio = formats.some(
      (candidate) =>
        asString(candidate.mimeType)?.startsWith('audio/') === true &&
        (asString(candidate.signatureCipher) !== undefined || asString(candidate.cipher) !== undefined),
    );
    throw new YouTubePlaybackError(
      'unsupported-format',
      hasCipheredAudio
        ? tr('err.yt.encrypted')
        : tr('err.yt.noFormat'),
    );
  }

  const url = asString(format.url);
  const mimeType = asString(format.mimeType);
  if (!url || !mimeType) {
    throw new YouTubePlaybackError(
      'invalid-response',
      tr('err.yt.incomplete'),
    );
  }

  let streamUrl: URL;
  try {
    streamUrl = new URL(url);
  } catch {
    throw new YouTubePlaybackError(
      'unsupported-format',
      tr('err.yt.badAudioUrl'),
    );
  }
  if (streamUrl.protocol !== 'https:') {
    throw new YouTubePlaybackError(
      'unsupported-format',
      tr('err.yt.unsafeUrl'),
    );
  }

  const expiresAtMs = parseExpiresAtMs(url, streamingData?.expiresInSeconds, nowMs);
  if (expiresAtMs !== undefined && expiresAtMs <= nowMs) {
    throw new YouTubePlaybackError(
      'expired',
      tr('err.audio.expired'),
    );
  }

  const relayToken = asString(format.relayToken);
  const playbackUrl = relayToken && /^[a-f0-9-]{36}$/.test(relayToken) ? `${base}/media/${relayToken}` : url;
  const description = isRecord(playerResponse?.videoDetails) ? asString(playerResponse.videoDetails.shortDescription)?.slice(0, 8000) : undefined;
  const codec = mimeType.startsWith('audio/mp4') ? 'AAC' : mimeType.startsWith('audio/webm') ? 'Opus' : undefined;
  const bitrate = typeof format.averageBitrate === 'number' ? format.averageBitrate : typeof format.bitrate === 'number' ? format.bitrate : undefined;
  const source: StreamSource = { provider: 'youtube', label: 'YouTube Music', quality: [codec, bitrate ? `${Math.round(bitrate / 1000)} kbps` : undefined].filter(Boolean).join(' · ') || 'Audio', ...(codec ? { codec } : {}) };
  return { url: playbackUrl, mimeType, ...(expiresAtMs === undefined ? {} : { expiresAtMs }), ...(description === undefined ? {} : { description }), source };
}
