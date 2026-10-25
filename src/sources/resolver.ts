import type { ResolvedStream, StreamSource } from '../data/youtubePlayback';
import { YouTubePlaybackError } from '../data/youtubePlayback';
import type { Track } from '../model';
import { activeSources, SOURCE_NAMES, type SourceId, type SourceSettings } from './config';
import { serviceUrl, type SourcesClient, type TrackQuery } from './client';
import { SourceFailure, describeFailure, type Attempt, type FailureKind } from './errors';
import { tr, type StringKey } from '../app/i18n';

export interface ResolverDeps {
  settings(): SourceSettings;
  youtube(track: Track, signal?: AbortSignal): Promise<ResolvedStream>;
  service: SourcesClient;
  now?: () => number;
}

export function queryOf(track: Track): TrackQuery {
  const artists = track.artists?.length ? track.artists.map((a) => a.name) : track.artist.split(/\s*,\s*|\s+&\s+/).filter(Boolean);
  return { title: track.title, artists, ...(track.album ? { album: track.album } : {}), ...(track.durationMs > 0 ? { durationMs: track.durationMs } : {}), ...(track.isrc ? { isrc: track.isrc } : {}) };
}

function youtubeKind(error: unknown): { kind: FailureKind; reason: string } {
  if (error instanceof YouTubePlaybackError) {
    const kind: FailureKind = error.kind === 'network' ? 'network' : error.kind === 'unsupported-format' ? 'decode' : 'stream';
    return { kind, reason: error.message };
  }
  return { kind: 'stream', reason: error instanceof Error ? error.message : tr('err.stream.cannotOpen') };
}

/**
 * Chooses the audio for a song: the sources the person turned on, in their order, first one that
 * opens wins. A source that is off is never tried (turning YouTube off means it is not a quiet
 * fallback), and when a higher source did not play the stream says which and why, so the screen can
 * show it. If none plays, the failure names every step that failed, not a generic "cannot play".
 */
export function createStreamResolver(deps: ResolverDeps): (track: Track) => Promise<ResolvedStream> {
  const now = deps.now ?? (() => Date.now());
  return async (track) => {
    const settings = deps.settings();
    const order = activeSources(settings);
    if (order.length === 0) throw new SourceFailure('disabled', tr('err.sources.allOff'));
    const attempts: Attempt[] = [];
    for (const id of order) {
      const name = SOURCE_NAMES[id];
      try {
        const stream = id === 'youtube' ? await tryYouTube(deps, track) : await tryService(deps, id, track, settings, now());
        if (attempts.length) console.debug('[sources] skipped before', name, attempts);
        return attempts.length ? { ...stream, source: { ...(stream.source as StreamSource), skipped: attempts } } : stream;
      } catch (error) {
        if (error instanceof SourceFailure && error.attempts.length === 0) attempts.push({ provider: name, kind: error.kind, reason: error.message });
        else if (id === 'youtube') { const { kind, reason } = youtubeKind(error); attempts.push({ provider: name, kind, reason }); }
        else attempts.push({ provider: name, kind: 'network', reason: error instanceof Error ? error.message : tr('err.source.unreachable') });
      }
    }
    const last = attempts[attempts.length - 1];
    const failure = new SourceFailure(last.kind, last.reason, last.provider, attempts);
    failure.message = describeFailure(failure);
    throw failure;
  };
}

async function tryYouTube(deps: ResolverDeps, track: Track): Promise<ResolvedStream> {
  if (track.provider && track.provider !== 'youtube') throw new SourceFailure('matching', tr('err.track.notYoutube'));
  return deps.youtube(track);
}

async function tryService(deps: ResolverDeps, id: SourceId, track: Track, settings: SourceSettings, at: number): Promise<ResolvedStream> {
  if (track.provider && track.provider !== 'youtube') throw new SourceFailure('matching', tr('err.track.notCatalog'));
  const out = await deps.service.resolve(id, queryOf(track), settings.picks[id]);
  if (out.result !== 'found') { console.debug('[source]', id, out.kind, out.reason); throw new SourceFailure(out.kind, tr(`err.kind.${out.kind}` as StringKey)); }
  const stream = out.stream;
  const source: StreamSource = { provider: id as StreamSource['provider'], label: stream.sourceLabel, quality: stream.qualityLabel, ...(stream.codec ? { codec: stream.codec } : {}), ...(stream.sampleRateHz ? { sampleRateHz: stream.sampleRateHz } : {}) };
  return {
    url: serviceUrl(stream.path),
    mimeType: stream.mimeType,
    format: stream.format,
    expiresAtMs: at + 50 * 60 * 1000,
    ...(stream.drm ? { drm: { licenseUrl: serviceUrl(stream.drm.licensePath) } } : {}),
    source,
  };
}
