import { tr, type StringKey } from '../app/i18n';
/**
 * Why a song did not play, in the terms a person can act on. These are told apart on purpose:
 * "sign in again" (auth), "this service does not have it" (matching), "the stream could not be
 * opened" (stream), "the license was refused" (license), "this TV cannot decode it" (decode) and
 * "no connection" (network). A success on one step never stands in for the next.
 */
export type FailureKind = 'auth' | 'network' | 'matching' | 'stream' | 'license' | 'decode' | 'disabled';

export const kindLabel = (kind: FailureKind): string => tr(`failure.${kind}` as StringKey);

export class SourceFailure extends Error {
  readonly name = 'SourceFailure';
  constructor(readonly kind: FailureKind, message: string, readonly provider?: string, readonly attempts: Attempt[] = []) { super(message); }
}

export interface Attempt { provider: string; kind: FailureKind; reason: string }

interface ShakaLike { category?: number; code?: number; data?: unknown[]; message?: string }
const CATEGORY = { NETWORK: 1, MEDIA: 3, MANIFEST: 4, STREAMING: 5, DRM: 6 } as const;
const CODE = { BAD_HTTP_STATUS: 1001, HTTP_ERROR: 1002, TIMEOUT: 1003, LICENSE_REQUEST_FAILED: 6007, LICENSE_RESPONSE_REJECTED: 6008, REQUESTED_KEY_SYSTEM_CONFIG_UNAVAILABLE: 6001 } as const;

/** The HTTP status buried in a player error (a failed license request wraps the network error that has it). */
function statusOf(error: ShakaLike | undefined, depth = 0): number | undefined {
  if (!error || depth > 3 || !Array.isArray(error.data)) return undefined;
  if (error.code === CODE.BAD_HTTP_STATUS && typeof error.data[1] === 'number') return error.data[1];
  for (const item of error.data) {
    if (item && typeof item === 'object' && 'code' in item) { const found = statusOf(item as ShakaLike, depth + 1); if (found !== undefined) return found; }
  }
  return undefined;
}

/** Maps an error from the player library (Shaka) to a failure kind. No library code is needed to call it. */
export function classifyPlayerError(error: ShakaLike, provider?: string): SourceFailure {
  const status = statusOf(error);
  if (error.category === CATEGORY.DRM) {
    if (status === 401 || status === 403) return new SourceFailure('auth', tr('err.drm.auth'), provider);
    if (error.code === CODE.REQUESTED_KEY_SYSTEM_CONFIG_UNAVAILABLE) return new SourceFailure('license', tr('err.drm.widevine'), provider);
    if (error.code === CODE.LICENSE_REQUEST_FAILED || error.code === CODE.LICENSE_RESPONSE_REJECTED) return new SourceFailure('license', tr(status ? 'err.drm.refusedStatus' : 'err.drm.refused', { status: status ?? '' }), provider);
    return new SourceFailure('license', tr('err.drm.failed', { code: String(error.code) }), provider);
  }
  if (error.category === CATEGORY.MEDIA) return new SourceFailure('decode', tr('err.player.media', { code: String(error.code) }), provider);
  if (error.category === CATEGORY.NETWORK) {
    if (status === 401 || status === 403) return new SourceFailure('auth', tr('err.source.auth', { status }), provider);
    if (status !== undefined) return new SourceFailure('stream', tr('err.source.status', { status }), provider);
    return new SourceFailure('network', tr('err.source.network'), provider);
  }
  if (error.category === CATEGORY.MANIFEST || error.category === CATEGORY.STREAMING) return new SourceFailure('stream', tr('err.stream.open', { code: String(error.code) }), provider);
  return new SourceFailure('stream', tr('err.player.failed', { code: String(error.code) }), provider);
}

/** One line for the screen: what happened and at which step, with the source that was tried. */
export function describeFailure(failure: SourceFailure): string {
  const head = kindLabel(failure.kind) + (failure.provider ? ` · ${failure.provider}` : '');
  if (failure.attempts.length > 1) return failure.attempts.map((a) => `${a.provider}: ${kindLabel(a.kind).toLowerCase()} (${a.reason})`).join(' → ');
  return `${head}: ${failure.message}`;
}
