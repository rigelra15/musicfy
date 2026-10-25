import { runtimeFetch } from '../platform/runtime';
import type {
  ArtistPage, BrowsePage, CatalogErrorKind, CatalogLocale, ContinuationRef, DetailPage, GenericPage, HomePage, MorePage, NextPage,
  RelatedPage, SearchFilter, SearchPage, SuggestionsPage,
} from './types';
import { tr } from '../app/i18n';

/** What went wrong with a catalog request, in the language on screen. The service's own words are never shown. */
function catalogMessage(kind: string, status: number): string {
  if (kind === 'rate-limited') return tr('err.catalog.limited');
  if (kind === 'timeout' || kind === 'network') return tr('err.service.unreachable');
  if (kind === 'not-found') return tr('err.catalog.notFound');
  return tr('err.catalog.unavailable', { status });
}

export class CatalogRequestError extends Error {
  constructor(readonly kind: CatalogErrorKind, message: string, readonly status = 0) {
    super(message);
    this.name = 'CatalogRequestError';
  }
  /** Worth offering "coba lagi"; false for programming errors such as bad-request. */
  get retryable() { return ['rate-limited', 'timeout', 'network', 'upstream-http', 'invalid-response', 'forbidden'].includes(this.kind); }
}

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
const KINDS: ReadonlySet<string> = new Set(['bad-request', 'not-found', 'rate-limited', 'forbidden', 'upstream-http', 'invalid-response', 'timeout', 'network']);

export interface CatalogGateway {
  home(options?: { params?: string; signal?: AbortSignal }): Promise<HomePage>;
  search(query: string, filter?: SearchFilter, signal?: AbortSignal): Promise<SearchPage>;
  suggest(query: string, signal?: AbortSignal): Promise<SuggestionsPage>;
  browse(browseId: string, params?: string, signal?: AbortSignal): Promise<BrowsePage>;
  album(browseId: string, signal?: AbortSignal): Promise<DetailPage>;
  playlist(playlistId: string, signal?: AbortSignal): Promise<DetailPage>;
  artist(browseId: string, signal?: AbortSignal): Promise<ArtistPage>;
  page(browseId: string, params?: string, signal?: AbortSignal): Promise<GenericPage>;
  next(options: { videoId?: string; playlistId?: string; index?: number; params?: string }, signal?: AbortSignal): Promise<NextPage>;
  related(browseId: string, signal?: AbortSignal): Promise<RelatedPage>;
  /** Follow a continuation returned by any earlier page. */
  more(operation: 'home' | 'search' | 'browse' | 'next', continuation: ContinuationRef, signal?: AbortSignal): Promise<MorePage>;
}

export function createCatalogGateway(options: { fetch?: Fetcher; locale?: CatalogLocale } = {}): CatalogGateway {
  const fetcher: Fetcher = options.fetch ?? ((input, init) => runtimeFetch(input, init));
  async function call<T>(operation: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await fetcher('/api/catalog/' + operation, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options.locale ? { ...params, locale: options.locale } : params),
        signal,
      });
    } catch (error) {
      if (signal?.aborted || (error as { name?: string })?.name === 'AbortError') throw new CatalogRequestError('aborted', tr('err.request.aborted'));
      throw new CatalogRequestError('network', tr('err.service.unreachable'));
    }
    let body: unknown;
    try { body = await response.json(); } catch { body = undefined; }
    if (!response.ok) {
      const payload = (body && typeof body === 'object' ? body : {}) as { error?: string; kind?: string };
      const kind = (payload.kind && KINDS.has(payload.kind) ? payload.kind : response.status === 429 ? 'rate-limited' : 'upstream-http') as CatalogErrorKind;
      throw new CatalogRequestError(kind, catalogMessage(kind, response.status), response.status);
    }
    if (!body || typeof body !== 'object') throw new CatalogRequestError('invalid-response', tr('err.catalog.unrecognized'), response.status);
    return body as T;
  }
  const expectType = <T extends BrowsePage>(page: BrowsePage, type: T['type']): T => {
    if (page.type !== type) throw new CatalogRequestError('invalid-response', tr('err.catalog.wrongType', { type: String(page.type) }));
    return page as T;
  };
  return {
    home: (o = {}) => call<HomePage>('home', o.params ? { params: o.params } : {}, o.signal),
    search: (query, filter = 'all', signal) => call<SearchPage>('search', { query, filter }, signal),
    suggest: (query, signal) => call<SuggestionsPage>('suggest', { query }, signal),
    browse: (browseId, params, signal) => call<BrowsePage>('browse', params ? { browseId, params } : { browseId }, signal),
    album: async (browseId, signal) => expectType<DetailPage>(await call<BrowsePage>('browse', { browseId }, signal), 'album'),
    playlist: async (playlistId, signal) => expectType<DetailPage>(await call<BrowsePage>('browse', { browseId: playlistId.startsWith('VL') ? playlistId : 'VL' + playlistId }, signal), 'playlist'),
    artist: async (browseId, signal) => expectType<ArtistPage>(await call<BrowsePage>('browse', { browseId }, signal), 'artist'),
    page: async (browseId, params, signal) => expectType<GenericPage>(await call<BrowsePage>('browse', params ? { browseId, params } : { browseId }, signal), 'page'),
    next: (o, signal) => call<NextPage>('next', o, signal),
    related: (browseId, signal) => call<RelatedPage>('related', { browseId }, signal),
    more: (operation, continuation, signal) => call<MorePage>(operation, { continuation }, signal),
  };
}

/**
 * Keeps only the newest request per scope. `begin` returns a ticket; after awaiting, check
 * `ticket.current()` before applying the result so a slow older answer never overwrites a newer one.
 */
export function createLatestGuard() {
  const latest = new Map<string, number>();
  let counter = 0;
  return {
    begin(scope: string) {
      const id = ++counter;
      latest.set(scope, id);
      return { id, current: () => latest.get(scope) === id };
    },
    /** Run `task` and reject with kind 'stale' when a newer request for the scope started meanwhile. */
    async run<T>(scope: string, task: () => Promise<T>): Promise<T> {
      const ticket = this.begin(scope);
      const result = await task();
      if (!ticket.current()) throw new CatalogRequestError('stale', tr('err.catalog.stale'));
      return result;
    },
  };
}
