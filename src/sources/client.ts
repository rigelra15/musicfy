import type { StreamSource } from '../data/youtubePlayback';
import { isPackagedTV, runtimeFetch, serviceBaseUrl } from '../platform/runtime';
import { SourceFailure, type FailureKind } from './errors';
import type { Picks, SourceId } from './config';
import { tr } from '../app/i18n';

export interface TrackQuery { title: string; artists: string[]; album?: string; durationMs?: number; isrc?: string }

export interface ServiceStream {
  format: 'progressive' | 'hls';
  path: string;
  mimeType: string;
  codec?: string;
  qualityLabel: string;
  sourceLabel: string;
  sampleRateHz?: number;
  drm?: { system: string; licensePath: string };
  matched: { id: string; title: string; artist: string; album?: string; durationMs?: number; confidence: number };
}
export type ServiceResolve =
  | { result: 'found'; stream: ServiceStream }
  | { result: 'notFound' | 'unavailable'; kind: FailureKind; reason: string };

export type AccountState = 'ready' | 'signedIn' | 'signedOut' | 'expired' | 'unreachable';
export interface ModuleStatus {
  id: SourceId;
  name: string;
  description: string;
  needsAccount: boolean;
  account: { state: AccountState; label: string };
  choices: Array<{ id: string; label: string; options: Array<{ id: string; label: string; description: string }> }>;
}
/** One check of a source test. `id` names it for the screen; `name` and `detail` are the service's own words and are only logged. */
export interface DiagnosticStep { id: string; name: string; ok: boolean | null; detail: string }

/** The TV service's source API. Nothing it returns is a credential or an upstream address. */
export interface SourcesClient {
  status(signal?: AbortSignal): Promise<ModuleStatus[]>;
  resolve(provider: SourceId, track: TrackQuery, picks: Picks | undefined, signal?: AbortSignal): Promise<ServiceResolve>;
  diagnose(provider: SourceId, track: TrackQuery, picks: Picks | undefined): Promise<ServiceResolve & { steps: DiagnosticStep[] }>;
  verify(provider: SourceId): Promise<ModuleStatus['account']>;
  signOut(provider: SourceId): Promise<ModuleStatus['account']>;
}

async function call<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await runtimeFetch(path, { credentials: 'omit', signal, ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') throw error;
    throw new SourceFailure('network', tr('err.service.noReply'));
  }
  const data = await response.json().catch(() => undefined);
  if (!response.ok) throw new SourceFailure('stream', tr('err.source.refused'));
  return data as T;
}

export const serviceSources: SourcesClient = {
  status: async (signal) => (await call<{ modules: ModuleStatus[] }>('/api/sources/status', undefined, signal)).modules,
  resolve: (provider, track, picks, signal) => call('/api/sources/resolve', { provider, track, picks }, signal),
  diagnose: (provider, track, picks) => call('/api/sources/diagnose', { provider, track, picks }),
  verify: (provider) => call('/api/sources/verify', { provider }),
  signOut: (provider) => call('/api/sources/signout', { provider }),
};

/** A path on the service as an address the audio element and the player library can open. */
export const serviceUrl = (path: string): string => (isPackagedTV() ? serviceBaseUrl() + path : path);

export type { StreamSource };
