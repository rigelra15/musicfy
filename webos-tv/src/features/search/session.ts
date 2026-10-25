import { CatalogRequestError, type CatalogGateway } from '../../catalog/gateway';
import type { CatalogErrorKind, CatalogSection, ContinuationRef, SearchFilter } from '../../catalog/types';
import type { PreferencesStore } from '../../library/preferences';
import type { LibraryRepository } from '../../library/repository';
import { PREF_HIDE_EXPLICIT, PREF_HIDE_VIDEO_SONGS } from '../home/feed';
import { applyFilters, dedupe, homeItemFromCatalog, type ContentFilters, type HomeItem } from '../home/model';
import { parseYouTubeUrl } from './url';

/** Chips in Android's order: Music, Artist, Video, Album, Playlist (community), Featured. */
export const SEARCH_FILTERS: readonly SearchFilter[] = ['all', 'songs', 'artists', 'videos', 'albums', 'community', 'playlists'];

const sameSong = (a: HomeItem, b: HomeItem) => {
  const norm = (value: string | undefined) => (value ?? '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return !!a.track && !!b.track && norm(a.track.title) === norm(b.track.title) && norm(a.track.artist) === norm(b.track.artist);
};

/**
 * YouTube often puts the music video of a song first. When the same song (same title and artist) is also in the
 * results as a song, that audio version leads, as it does on the phone; it then leaves its own list so it shows once.
 */
export function preferSongAsTop(sections: ResultSection[]): ResultSection[] {
  const top = sections.find((section) => section.topResult);
  const lead = top?.items[0];
  if (!top || !lead || lead.kind !== 'video') return sections;
  const song = sections.filter((section) => !section.topResult).flatMap((section) => section.items).find((item) => item.kind === 'track' && sameSong(item, lead));
  if (!song) return sections;
  return sections.map((section) => section.topResult
    ? { ...section, items: [song, ...section.items.slice(1)] }
    : { ...section, items: section.items.filter((item) => item.key !== song.key) }).filter((section) => section.topResult || section.items.length > 0);
}

const normalizeTitle = (value: string | undefined) => (value ?? '').toLowerCase().normalize('NFKD').replace(/['’`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * "Exact matches": the songs whose title is the query itself (apostrophes and punctuation aside), in a short list of
 * their own right after the top result, as the phone shows YouTube's first shelf. Nothing is invented: they are taken
 * out of the songs list, so each shows once.
 */
export function withExactMatches(sections: ResultSection[], query: string): ResultSection[] {
  const wanted = normalizeTitle(query);
  const top = sections.find((section) => section.topResult)?.items[0];
  if (!wanted) return sections;
  const songs = sections.find((section) => !section.topResult && section.contentKind === 'track');
  const exact = songs?.items.filter((item) => item.id !== top?.id && normalizeTitle(item.track?.title ?? item.title) === wanted).slice(0, 5) ?? [];
  if (!songs || exact.length === 0) return sections;
  const result: ResultSection[] = [];
  for (const section of sections) {
    if (section === songs) {
      result.push({ id: 'exact', contentKind: 'exact', topResult: false, items: exact });
      const rest = section.items.filter((item) => !exact.includes(item));
      if (rest.length > 0) result.push({ ...section, items: rest });
    } else result.push(section);
  }
  // the exact matches belong right under the top result, ahead of everything else
  const at = result.findIndex((section) => section.id === 'exact');
  const [moved] = result.splice(at, 1);
  result.splice(result.findIndex((section) => section.topResult) + 1, 0, moved);
  return result;
}

export interface ResultSection { id: string; title?: string; /** What the section holds (`track`, `video`, `album`...), used to name a section YouTube sent untitled. */ contentKind?: string; topResult: boolean; items: HomeItem[] }
export interface Bucket {
  status: 'loading' | 'ready' | 'failed';
  sections: ResultSection[];
  items: HomeItem[];
  continuation?: ContinuationRef;
  loadingMore: boolean;
  errorKind?: CatalogErrorKind;
}
export interface SuggestState {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  queries: string[];
  items: HomeItem[];
  /** Metadata of a pasted link, shown first. */
  linkItem?: HomeItem;
}
export interface GenreTile { key: string; title: string; browseId: string; params?: string; color?: string }
export interface GenreGroup { id: string; title?: string; tiles: GenreTile[] }

export interface SearchSnapshot {
  draft: string;
  history: string[];
  suggest: SuggestState;
  /** Submitted query whose results are showing; undefined while typing or idle. */
  query?: string;
  filter: SearchFilter;
  bucket?: Bucket;
  genres: { status: 'idle' | 'loading' | 'ready' | 'failed'; groups: GenreGroup[] };
  /** Up to two cover images per mood tile (key `browseId|params`), filled in as the tiles ask. */
  covers: Readonly<Record<string, readonly string[]>>;
}

export interface SearchSessionOptions {
  gateway: CatalogGateway;
  repo: LibraryRepository;
  prefs: PreferencesStore;
  debounceMs?: number;
}

const errorKind = (error: unknown): CatalogErrorKind => (error instanceof CatalogRequestError ? error.kind : 'network');
const isAbort = (error: unknown) => errorKind(error) === 'aborted';
const HISTORY_SHOWN_WHILE_TYPING = 3;

/**
 * Everything the Search tab remembers between visits: the draft, the submitted query, the filter,
 * and each filter's results with its continuation, so coming back from an album or an artist
 * shows the same results without asking again. Typing is debounced and every request that a newer
 * one replaces is aborted, so a slow answer can never overwrite what is on screen now.
 */
export class SearchSession {
  private snapshot: SearchSnapshot = {
    draft: '', history: [], suggest: { status: 'idle', queries: [], items: [] }, filter: 'all', genres: { status: 'idle', groups: [] }, covers: {},
  };
  private readonly listeners = new Set<() => void>();
  private readonly buckets = new Map<string, Bucket>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private suggestController: AbortController | undefined;
  private readonly fetches = new Map<string, AbortController>();
  private genreController: AbortController | undefined;
  private readonly coverAsked = new Set<string>();
  private readonly coverQueue: GenreTile[] = [];
  private coverRunning = 0;
  private coverController = new AbortController();
  private suggestSeq = 0;

  constructor(private readonly options: SearchSessionOptions) {}

  getSnapshot = (): SearchSnapshot => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  dispose() { clearTimeout(this.timer); this.suggestController?.abort(); this.genreController?.abort(); this.coverController.abort(); this.fetches.forEach((c) => c.abort()); this.listeners.clear(); }

  private set(patch: Partial<SearchSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private filters(): ContentFilters {
    return { hideExplicit: this.options.prefs.get(PREF_HIDE_EXPLICIT, false), hideVideoSongs: this.options.prefs.get(PREF_HIDE_VIDEO_SONGS, false) };
  }
  private key(query: string, filter: SearchFilter) { return `${query}\u0000${filter}`; }

  // ---- history ------------------------------------------------------------------------------

  async loadHistory(): Promise<void> {
    const history = await this.options.repo.listSearches().catch(() => [] as string[]);
    this.set({ history });
  }
  async forgetHistory(query: string): Promise<void> {
    await this.options.repo.forgetSearch(query).catch(() => undefined);
    await this.loadHistory();
  }
  async clearHistory(): Promise<void> {
    await this.options.repo.clearSearches().catch(() => undefined);
    await this.loadHistory();
  }

  // ---- typing and suggestions ---------------------------------------------------------------

  /** The visible history while typing: entries that contain the draft, at most three. */
  matchingHistory(draft = this.snapshot.draft): string[] {
    const needle = draft.trim().toLowerCase();
    return needle ? this.snapshot.history.filter((entry) => entry.toLowerCase().includes(needle)).slice(0, HISTORY_SHOWN_WHILE_TYPING) : this.snapshot.history;
  }

  setDraft(text: string): void {
    clearTimeout(this.timer);
    this.suggestController?.abort();
    this.suggestSeq += 1;
    const trimmed = text.trim();
    this.set({ draft: text, suggest: trimmed ? { ...this.snapshot.suggest, status: 'loading' } : { status: 'idle', queries: [], items: [] } });
    if (!trimmed) return;
    const seq = this.suggestSeq;
    this.timer = setTimeout(() => { void this.fetchSuggestions(trimmed, seq); }, this.options.debounceMs ?? 250);
  }

  private async fetchSuggestions(query: string, seq: number): Promise<void> {
    const controller = this.suggestController = new AbortController();
    const link = parseYouTubeUrl(query);
    try {
      if (link) {
        const linkItem = await this.fetchLink(link, controller.signal);
        if (seq !== this.suggestSeq) return;
        this.set({ suggest: { status: 'ready', queries: [], items: [], linkItem } });
        return;
      }
      const page = await this.options.gateway.suggest(query, controller.signal);
      if (seq !== this.suggestSeq) return;
      const history = new Set(this.snapshot.history);
      this.set({
        suggest: {
          status: 'ready',
          queries: page.queries.filter((candidate) => !history.has(candidate)),
          items: applyFilters(dedupe(page.items.map(homeItemFromCatalog)), this.filters()),
        },
      });
    } catch (error) {
      if (seq !== this.suggestSeq || isAbort(error)) return;
      this.set({ suggest: { status: 'failed', queries: [], items: [] } });
    }
  }

  private async fetchLink(link: NonNullable<ReturnType<typeof parseYouTubeUrl>>, signal: AbortSignal): Promise<HomeItem | undefined> {
    if (link.kind === 'video') {
      const next = await this.options.gateway.next({ videoId: link.id }, signal);
      const item = next.items.find((candidate) => candidate.id === link.id) ?? next.items[0];
      return item ? homeItemFromCatalog(item) : undefined;
    }
    const page = await this.options.gateway.artist(link.id, signal);
    return page.header.title
      ? { key: `artist:${link.id}`, kind: 'artist', id: link.id, browseId: link.id, title: page.header.title, artworkUrl: page.header.artworkUrl }
      : undefined;
  }

  // ---- results ------------------------------------------------------------------------------

  /** Search for `text`: remembered in history, results start loading for the All filter. */
  async submit(text: string): Promise<boolean> {
    const query = text.trim();
    if (!query) return false;
    clearTimeout(this.timer);
    this.suggestController?.abort();
    this.suggestSeq += 1;
    this.set({ suggest: { status: 'idle', queries: [], items: [] } });   // an abandoned request must not leave "loading" behind
    void this.options.repo.rememberSearch(query).then(() => this.loadHistory()).catch(() => undefined);
    this.set({ draft: text });
    await this.open(query, 'all', true);
    return true;
  }

  /**
   * Show results for `query`. Re-opening the query already showing (coming back from a detail
   * page) keeps its filter and results; a new query resets to All unless a filter is given.
   */
  async open(query: string, filter?: SearchFilter, fresh = false): Promise<void> {
    const same = this.snapshot.query === query && !fresh;
    const next = filter ?? (same ? this.snapshot.filter : 'all');
    if (!same) this.abortFetches();
    if (this.snapshot.query !== query) this.buckets.clear();
    this.set({ query, filter: next, bucket: same ? this.snapshot.bucket : undefined, draft: this.snapshot.draft || query });
    await this.ensure(query, next);
  }

  closeResults(): void { if (this.snapshot.query !== undefined) this.set({ query: undefined, bucket: undefined }); }

  async setFilter(filter: SearchFilter): Promise<void> {
    const query = this.snapshot.query;
    if (!query || filter === this.snapshot.filter) return;
    this.set({ filter });
    await this.ensure(query, filter);
  }

  async retry(): Promise<void> {
    const { query, filter } = this.snapshot;
    if (!query) return;
    this.buckets.delete(this.key(query, filter));
    await this.ensure(query, filter);
  }

  private abortFetches() { this.fetches.forEach((controller) => controller.abort()); this.fetches.clear(); }

  private publishBucket(query: string, filter: SearchFilter, bucket: Bucket) {
    this.buckets.set(this.key(query, filter), bucket);
    if (this.snapshot.query === query && this.snapshot.filter === filter) this.set({ bucket });
  }

  private async ensure(query: string, filter: SearchFilter): Promise<void> {
    const key = this.key(query, filter);
    const cached = this.buckets.get(key);
    if (cached && cached.status !== 'failed') { this.set({ bucket: cached }); return; }
    if (this.fetches.has(key)) { this.set({ bucket: this.buckets.get(key) }); return; }
    const controller = new AbortController();
    this.fetches.set(key, controller);
    this.publishBucket(query, filter, { status: 'loading', sections: [], items: [], loadingMore: false });
    try {
      const page = await this.options.gateway.search(query, filter, controller.signal);
      const filters = this.filters();
      const toItems = (items: typeof page.items) => applyFilters(dedupe(items.map(homeItemFromCatalog)), filters);
      const toSections = (sections: CatalogSection[]): ResultSection[] => sections
        .map((section) => ({ id: section.id, title: section.title, contentKind: section.contentKind, topResult: !!section.topResult, items: toItems(section.items) }))
        .filter((section) => section.items.length > 0);
      const sections = filter === 'all' ? withExactMatches(preferSongAsTop(toSections(page.sections)), query) : [];
      this.publishBucket(query, filter, {
        status: 'ready', sections, items: filter === 'all' ? [] : toItems(page.items), continuation: page.continuation, loadingMore: false,
      });
    } catch (error) {
      if (isAbort(error) || this.fetches.get(key) !== controller) return;
      this.publishBucket(query, filter, { status: 'failed', sections: [], items: [], loadingMore: false, errorKind: errorKind(error) });
    } finally {
      if (this.fetches.get(key) === controller) this.fetches.delete(key);
    }
  }

  async loadMore(): Promise<void> {
    const { query, filter, bucket } = this.snapshot;
    if (!query || !bucket || bucket.status !== 'ready' || !bucket.continuation || bucket.loadingMore) return;
    const key = this.key(query, filter);
    const controller = new AbortController();
    this.fetches.set(key, controller);
    this.publishBucket(query, filter, { ...bucket, loadingMore: true });
    try {
      const page = await this.options.gateway.more('search', bucket.continuation, controller.signal);
      const filters = this.filters();
      const extra = applyFilters(dedupe([...page.items, ...page.sections.flatMap((section) => section.items)].map(homeItemFromCatalog)), filters);
      const current = this.buckets.get(key) ?? bucket;
      this.publishBucket(query, filter, { ...current, items: dedupe([...current.items, ...extra]), continuation: page.continuation, loadingMore: false });
    } catch (error) {
      if (isAbort(error)) return;
      const current = this.buckets.get(key) ?? bucket;
      this.publishBucket(query, filter, { ...current, loadingMore: false });
    } finally {
      if (this.fetches.get(key) === controller) this.fetches.delete(key);
    }
  }

  // ---- mood and genres ----------------------------------------------------------------------

  /** The key a tile's covers are filed under. */
  static coverKey(tile: Pick<GenreTile, 'browseId' | 'params'>): string { return `${tile.browseId}|${tile.params ?? ''}`; }

  /**
   * Asks for the pictures a mood tile shows (the first two distinct covers of what is behind it), as the phone does:
   * once per tile, three at a time, and a failed one may be asked for again.
   */
  requestCovers(tile: GenreTile): void {
    const key = SearchSession.coverKey(tile);
    if (this.coverAsked.has(key) || this.snapshot.covers[key]) return;
    this.coverAsked.add(key);
    this.coverQueue.push(tile);
    this.pumpCovers();
  }

  private pumpCovers() {
    while (this.coverRunning < 3 && this.coverQueue.length > 0) {
      const tile = this.coverQueue.shift()!;
      const key = SearchSession.coverKey(tile);
      this.coverRunning += 1;
      this.options.gateway.browse(tile.browseId, tile.params, this.coverController.signal).then((page) => {
        const items = 'sections' in page ? page.sections.flatMap((section) => section.items) : 'tracks' in page ? page.tracks : [];
        const urls = [...new Set(items.map((item) => item.artworkUrl).filter((url): url is string => !!url))].slice(0, 2);
        if (urls.length > 0) this.set({ covers: { ...this.snapshot.covers, [key]: urls } });
      }, (error) => { if (!isAbort(error)) this.coverAsked.delete(key); }).then(() => { this.coverRunning -= 1; this.pumpCovers(); });
    }
  }

  async loadGenres(force = false): Promise<void> {
    const { genres } = this.snapshot;
    if (!force && (genres.status === 'ready' || genres.status === 'loading')) return;
    this.genreController?.abort();
    const controller = this.genreController = new AbortController();
    this.set({ genres: { status: 'loading', groups: genres.groups } });
    try {
      const page = await this.options.gateway.page('FEmusic_moods_and_genres', undefined, controller.signal);
      const groups = page.sections
        .map((section): GenreGroup => ({
          id: section.id, title: section.title,
          tiles: section.items
            .filter((item) => item.kind === 'link' && item.browseId)
            .map((item) => ({ key: `${item.browseId}:${item.params ?? ''}`, title: item.title, browseId: item.browseId!, params: item.params, color: item.color })),
        }))
        .filter((group) => group.tiles.length > 0);
      this.set({ genres: { status: 'ready', groups } });
    } catch (error) {
      if (isAbort(error)) return;
      this.set({ genres: { status: 'failed', groups: [] } });
    }
  }
}
