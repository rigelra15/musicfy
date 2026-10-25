import { CatalogRequestError, type CatalogGateway } from '../../catalog/gateway';
import type { CatalogErrorKind, CatalogItem, CatalogSection, ContinuationRef, HomeChip } from '../../catalog/types';
import type { LibraryRepository } from '../../library/repository';
import type { PreferencesStore } from '../../library/preferences';
import type { Track } from '../../model';
import { feedShelfKind, homeVideo, feedVideo, interleave, videoShelves, type HomeVideoCard } from './artistVideos';
import { composeRows, type OnlineRows } from './compose';
import { loadLocalRows, PREF_LIKED_PLAYED_AT, type LocalRows } from './local';
import {
  applyFilters, dedupe, homeItemFromCatalog, homeItemFromTrack, NO_FILTERS, type ContentFilters, type HomeItem, type HomeRow,
} from './model';
import { buildProfile, type ArtistRef, type Random, type TasteProfile } from './profile';
import {
  arrangeCategories, becauseYouLike, communityPlaylists, dailyDiscover, moreLike, newFromArtists, newGenres, shuffle, starterSongs,
  type DiscoverCard, type RecommendContext, type StarterCard,
} from './recommend';
import type { ListeningSignals } from './signals';

export const CACHE_KEY = 'homeFeedCache';
export const PREF_HIDE_EXPLICIT = 'content.hideExplicit';
export const PREF_HIDE_VIDEO_SONGS = 'content.hideVideoSongs';
const MINUTE = 60_000;

export interface HeroCard {
  kind: 'continue' | 'discover' | 'starter';
  item: HomeItem;
  /** Song or artist the card grew from. */
  reason?: string;
}

export type OnlineStatus = 'idle' | 'loading' | 'ready' | 'partial' | 'failed';

export interface HomeSnapshot {
  rows: HomeRow[];
  hero: HeroCard[];
  chips: HomeChip[];
  selectedChip?: HomeChip;
  /** Local rows are in. Home paints as soon as this is true. */
  localReady: boolean;
  hasHistory: boolean;
  likedCount: number;
  online: OnlineStatus;
  errorKind?: CatalogErrorKind;
  /** Rows currently shown came from the last successful load, not from this one. */
  fromCache: boolean;
  updatedAt?: number;
  canLoadMore: boolean;
  loadingMore: boolean;
}

interface CacheV1 {
  v: 1;
  savedAt: number;
  chips: HomeChip[];
  feed: HomeRow[];
  continuation?: ContinuationRef;
  categories: HomeRow[];
  community?: HomeRow;
  live?: HomeRow;
  videos?: HomeRow;
  charts?: HomeRow;
  newReleases?: HomeRow;
  artists?: HomeRow;
  discover?: DiscoverCard[];
  starter?: StarterCard[];
}

export type RefreshAction = 'none' | 'listening' | 'all';

/** Android's policy: a minute of quiet, 30 minutes means stale, a few skips or plays refresh the listening rows. */
export function refreshAction(input: { now: number; lastLoadAt: number | undefined; skips: number; plays: number }): RefreshAction {
  if (input.lastLoadAt === undefined) return 'all';
  const age = input.now - input.lastLoadAt;
  if (age < MINUTE) return 'none';
  if (age > 30 * MINUTE) return 'all';
  return input.skips >= 2 || input.plays >= 4 ? 'listening' : 'none';
}

export interface HomeFeedOptions {
  repo: LibraryRepository;
  prefs: PreferencesStore;
  gateway: CatalogGateway;
  signals: ListeningSignals;
  now?: () => number;
  rng?: Random;
}

const EMPTY: HomeSnapshot = {
  rows: [], hero: [], chips: [], localReady: false, hasHistory: false, likedCount: 0, online: 'idle', fromCache: false, canLoadMore: false, loadingMore: false,
};

const withTitle = (items: HomeItem[], cards: HomeVideoCard[]): HomeItem[] =>
  items.map((item, index) => ({ ...item, title: cards[index].title, subtitle: cards[index].subtitle || item.subtitle }));

/**
 * Loads Home in two phases. The local phase reads only the library, so the screen has content at
 * once and offline. The network phase runs each source on its own (one failing must not cancel the
 * others), publishing after each, and the last good result of every source is kept as the cache.
 */
export class HomeFeed {
  private snapshot: HomeSnapshot = EMPTY;
  private readonly listeners = new Set<() => void>();
  private local: LocalRows | undefined;
  private online: OnlineRows = { categories: [], feed: [] };
  private chipFeed: HomeRow[] | undefined;
  private discover: DiscoverCard[] = [];
  private starter: StarterCard[] = [];
  private lastTrack: Track | undefined;
  private continuation: ContinuationRef | undefined;
  private chipContinuation: ContinuationRef | undefined;
  private lastLoadAt: number | undefined;
  private generation = 0;
  private controller: AbortController | undefined;
  private readonly now: () => number;
  private readonly rng: Random;

  constructor(private readonly options: HomeFeedOptions) {
    this.now = options.now ?? (() => Date.now());
    this.rng = options.rng ?? Math.random;
  }

  /** True once a network load has finished; before that Home is still on its first load. */
  get hasLoaded(): boolean { return this.lastLoadAt !== undefined; }

  getSnapshot = (): HomeSnapshot => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  dispose() { this.generation += 1; this.controller?.abort(); this.listeners.clear(); }

  private filters(): ContentFilters {
    return { hideExplicit: this.options.prefs.get(PREF_HIDE_EXPLICIT, false), hideVideoSongs: this.options.prefs.get(PREF_HIDE_VIDEO_SONGS, false) };
  }

  private publish(patch: Partial<HomeSnapshot> = {}) {
    const local = this.local;
    const rows = this.snapshot.selectedChip && this.chipFeed
      ? this.chipFeed
      : local ? composeRows(local, this.online) : [];
    const hero: HeroCard[] = [];
    if (this.lastTrack) hero.push({ kind: 'continue', item: homeItemFromTrack(this.lastTrack) });
    for (const card of this.discover) hero.push({ kind: 'discover', item: card.item, reason: card.seed.title });
    if (!local?.hasHistory) for (const card of this.starter) hero.push({ kind: 'starter', item: card.item, reason: card.artist.name });
    this.snapshot = {
      ...this.snapshot, rows, hero: hero.slice(0, 8), hasHistory: local?.hasHistory ?? false, likedCount: local?.likedCount ?? 0,
      localReady: !!local, canLoadMore: !!(this.snapshot.selectedChip && this.chipFeed ? this.chipContinuation : this.continuation), ...patch,
    };
    this.listeners.forEach((listener) => listener());
  }

  /** First paint: last good network result (if any) with fresh local rows. */
  async start(): Promise<void> {
    const generation = ++this.generation;
    const cached = await this.options.repo.getMeta<CacheV1>(CACHE_KEY).catch(() => undefined);
    await this.refreshLocal();
    if (generation !== this.generation) return;
    if (cached && cached.v === 1) {
      this.online = {
        categories: cached.categories ?? [], feed: cached.feed ?? [], community: cached.community, live: cached.live, videos: cached.videos,
        charts: cached.charts, newReleases: cached.newReleases, artists: cached.artists,
      };
      this.discover = cached.discover ?? [];
      this.starter = cached.starter ?? [];
      this.continuation = cached.continuation;
      this.publish({ chips: cached.chips ?? [], fromCache: true, updatedAt: cached.savedAt });
    }
    await this.load('all');
  }

  /** Recompute only what the library says; called again after plays, likes and playlist changes. */
  async refreshLocal(): Promise<void> {
    const filters = this.filters();
    this.local = await loadLocalRows(this.options.repo, { now: this.now(), filters, likedPlayedAt: this.options.prefs.get<number | undefined>(PREF_LIKED_PLAYED_AT, undefined) });
    const latest = (await this.options.repo.listHistory({ limit: 1 }))[0];
    this.lastTrack = latest?.track;
    this.publish();
  }

  /** Called when Home becomes visible again. */
  async refreshIfNeeded(): Promise<RefreshAction> {
    const action = refreshAction({ now: this.now(), lastLoadAt: this.lastLoadAt, skips: this.options.signals.skipsSinceRefresh, plays: this.options.signals.playsSinceRefresh });
    if (action === 'none') { await this.refreshLocal(); return action; }
    await this.load(action);
    return action;
  }

  /** User asked for a refresh; always reloads everything. */
  async refresh(): Promise<void> { await this.load('all'); }

  async selectChip(chip: HomeChip | undefined): Promise<void> {
    if (!chip) {
      this.chipFeed = undefined;
      this.chipContinuation = undefined;
      this.publish({ selectedChip: undefined, errorKind: undefined, online: 'ready' });
      return;
    }
    const generation = ++this.generation;
    this.controller?.abort();
    const controller = this.controller = new AbortController();
    this.publish({ selectedChip: chip, online: 'loading', errorKind: undefined });
    this.chipFeed = [];
    try {
      const page = await this.options.gateway.home({ params: chip.params, signal: controller.signal });
      if (generation !== this.generation) return;
      this.chipFeed = this.feedRows(page.sections, `chip:${chip.title}`).rows;
      this.chipContinuation = page.continuation;
      this.publish({ online: 'ready' });
    } catch (error) {
      if (generation !== this.generation) return;
      this.publish({ online: 'failed', errorKind: errorKind(error) });
    }
  }

  /** The feed's next page, appended; rows that repeat an earlier one are dropped. */
  async loadMore(): Promise<void> {
    const inChip = !!this.snapshot.selectedChip && !!this.chipFeed;
    const continuation = inChip ? this.chipContinuation : this.continuation;
    if (!continuation || this.snapshot.loadingMore) return;
    const generation = this.generation;
    this.publish({ loadingMore: true });
    try {
      const page = await this.options.gateway.more('home', continuation);
      if (generation !== this.generation) return;
      if (inChip) this.chipContinuation = page.continuation; else this.continuation = page.continuation;
      const extra = this.feedRows(page.sections, 'more').rows;
      if (inChip && this.chipFeed) this.chipFeed = mergeRows(this.chipFeed, extra);
      else this.online = { ...this.online, feed: mergeRows(this.online.feed, extra) };
      this.publish({ loadingMore: false });
      await this.persist();
    } catch (error) {
      if (generation === this.generation) this.publish({ loadingMore: false, errorKind: errorKind(error) });
    }
  }

  // ---- network phase ------------------------------------------------------------------------

  private feedVideos = { live: [] as CatalogItem[], musicVideos: [] as CatalogItem[] };
  private artistVideoLists = { live: [] as HomeVideoCard[][], musicVideos: [] as HomeVideoCard[][] };

  private feedRows(sections: readonly CatalogSection[], prefix: string): { rows: HomeRow[]; live: CatalogItem[]; musicVideos: CatalogItem[] } {
    const filters = this.filters();
    const live: CatalogItem[] = [];
    const musicVideos: CatalogItem[] = [];
    const rows: HomeRow[] = [];
    sections.forEach((section, index) => {
      if (section.layout === 'text' || section.items.length === 0) return;
      const title = section.title ?? '';
      if (/trending|community|komunitas/i.test(title)) return;
      const kind = feedShelfKind(section.title, section.items);
      if (kind === 'live') { live.push(...section.items); return; }
      if (kind === 'musicVideos') { musicVideos.push(...section.items); return; }
      const items = applyFilters(dedupe(section.items.map(homeItemFromCatalog)), filters);
      if (items.length === 0) return;
      rows.push({ id: `feed:${prefix}:${section.id || index}`, kind: 'feed', title, subtitle: section.strapline, origin: 'online', items, more: section.more, detail: !!section.more });
    });
    return { rows, live, musicVideos };
  }

  private rebuildVideos() {
    const filters = this.filters();
    const build = (id: 'live' | 'videos', lists: HomeVideoCard[][], feed: CatalogItem[]): HomeRow | undefined => {
      const cards = interleave([...lists, feed.map(feedVideo)], 12);
      const items = cards.map((card) => ({ ...homeItemFromCatalog(card.item), title: card.title, subtitle: card.subtitle || undefined }));
      const kept = applyFilters(dedupe(items), { ...filters, hideVideoSongs: false });
      return kept.length >= 2 ? { id, kind: id, title: '', origin: 'online', items: kept } : undefined;
    };
    this.online = {
      ...this.online,
      live: build('live', this.artistVideoLists.live, this.feedVideos.live),
      videos: build('videos', this.artistVideoLists.musicVideos, this.feedVideos.musicVideos),
    };
  }

  private async persist() {
    const cache: CacheV1 = {
      v: 1, savedAt: this.now(), chips: this.snapshot.chips, feed: this.online.feed, continuation: this.continuation, categories: this.online.categories,
      community: this.online.community, live: this.online.live, videos: this.online.videos, charts: this.online.charts,
      newReleases: this.online.newReleases, artists: this.online.artists, discover: this.discover, starter: this.starter,
    };
    await this.options.repo.setMeta(CACHE_KEY, cache).catch(() => undefined);
  }

  private async discoverSeeds(): Promise<Track[]> {
    const { repo } = this.options;
    const liked = (await repo.listLiked()).map((like) => like.track).filter((track): track is Track => !!track);
    const history = await repo.listHistory({ sinceMs: 0 });
    const counts = new Map<string, { track: Track; plays: number }>();
    for (const play of history) if (play.track) counts.set(play.trackKey, { track: play.track, plays: (counts.get(play.trackKey)?.plays ?? 0) + 1 });
    const recent = [...new Map(history.filter((play) => play.track).map((play) => [play.trackKey, play.track!])).values()];
    const mostPlayed = [...counts.values()].sort((a, b) => b.plays - a.plays).slice(0, 20).map((entry) => entry.track);
    const chosen: Track[] = [];
    const take = (pool: Track[], count: number) => {
      for (const track of shuffle(pool, this.rng)) {
        if (count <= 0) break;
        const artist = track.artists?.[0]?.id ?? track.artist;
        if (track.provider && track.provider !== 'youtube') continue;
        if (chosen.some((other) => other.id === track.id || (other.artists?.[0]?.id ?? other.artist) === artist)) continue;
        chosen.push(track); count -= 1;
      }
    };
    take(liked, 2); take(mostPlayed, 2); take(recent.slice(0, 15), 2);
    if (chosen.length < 5) take(recent, 5 - chosen.length);
    return chosen;
  }

  private async load(action: 'all' | 'listening'): Promise<void> {
    const generation = ++this.generation;
    this.controller?.abort();
    const controller = this.controller = new AbortController();
    const { repo, signals } = this.options;
    // Many sources swallow their own errors so one bad seed does not hide a row; counting at the
    // gateway keeps "the network is down" honest regardless.
    const calls = { ok: 0, failed: [] as CatalogErrorKind[] };
    const gateway = trackGateway(this.options.gateway, calls);
    const filters = this.filters();
    if (action === 'all') { this.chipFeed = undefined; this.snapshot = { ...this.snapshot, selectedChip: undefined }; }
    await this.refreshLocal();
    if (generation !== this.generation) return;
    this.publish({ online: 'loading', errorKind: undefined });

    const profile: TasteProfile = await buildProfile(repo, signals, { now: this.now(), rng: this.rng });
    const pages = new Map<string, Promise<Awaited<ReturnType<CatalogGateway['artist']>> | undefined>>();
    const context: RecommendContext = {
      gateway, profile, filters, rng: this.rng, signal: controller.signal,
      artistPage: (id) => {
        let page = pages.get(id);
        if (!page) { page = gateway.artist(id, controller.signal).catch(() => undefined); pages.set(id, page); }
        return page;
      },
    };
    // Top artists are known without the network, so that row is there immediately.
    this.online = {
      ...this.online,
      artists: profile.topArtists.length > 0
        ? { id: 'artists', kind: 'artists', title: '', origin: 'local', items: profile.topArtists.map((artist): HomeItem => ({ key: `artist:${artist.id}`, kind: 'artist', id: artist.id, browseId: artist.id, title: artist.name, artworkUrl: artist.artworkUrl })) }
        : undefined,
    };
    this.publish();

    const run = async (task: () => Promise<void>) => {
      try {
        await task();
      } catch {
        // already counted at the gateway
      }
      if (generation !== this.generation) return;
      this.publish();
      await this.persist();
    };
    const live = (value: () => void) => { if (generation === this.generation) value(); };

    const tasks: Array<() => Promise<void>> = [];
    if (action === 'all') {
      tasks.push(async () => {
        const page = await gateway.home({ signal: controller.signal });
        const built = this.feedRows(page.sections, 'home');
        live(() => {
          this.feedVideos = { live: built.live, musicVideos: built.musicVideos };
          this.online = { ...this.online, feed: built.rows };
          this.continuation = page.continuation;
          this.snapshot = { ...this.snapshot, chips: page.chips };
          this.rebuildVideos();
        });
      });
      tasks.push(async () => {
        const page = await gateway.page('FEmusic_new_releases_albums', undefined, controller.signal);
        const section = page.sections.find((candidate) => candidate.items.some((item) => item.kind === 'album'));
        const items = applyFilters(dedupe((section?.items ?? []).map(homeItemFromCatalog)), filters);
        live(() => { this.online = { ...this.online, newReleases: items.length > 0 ? { id: 'newReleases', kind: 'newReleases', title: '', origin: 'online', items, more: { browseId: 'FEmusic_new_releases_albums' }, detail: true } : undefined }; });
      });
      tasks.push(async () => {
        const page = await gateway.page('FEmusic_charts', undefined, controller.signal);
        // UNVERIFIED live: the chart shelf is picked by title, then by being the first with songs.
        const section = page.sections.find((candidate) => /top|teratas|chart/i.test(candidate.title ?? '') && candidate.items.length > 0)
          ?? page.sections.find((candidate) => candidate.items.length > 0);
        const items = applyFilters(dedupe((section?.items ?? []).map(homeItemFromCatalog)), filters).slice(0, 20);
        live(() => { this.online = { ...this.online, charts: items.length > 0 ? { id: 'charts', kind: 'charts', title: section?.title ?? '', origin: 'online', items, more: section?.more ?? { browseId: 'FEmusic_charts' }, detail: true } : undefined }; });
      });
      tasks.push(async () => {
        const lists = await Promise.all(profile.topArtists.slice(0, 5).map(async (artist) => {
          const page = await context.artistPage(artist.id);
          const shelves = page ? videoShelves(page.sections) : { musicVideos: [], liveShows: [] };
          return {
            live: shelves.liveShows.map((item) => homeVideo(item, artist.name)),
            musicVideos: shelves.musicVideos.map((item) => homeVideo(item, artist.name)),
          };
        }));
        live(() => {
          this.artistVideoLists = { live: lists.map((list) => list.live), musicVideos: lists.map((list) => list.musicVideos) };
          this.rebuildVideos();
        });
      });
    }
    if (profile.hasHistory) {
      tasks.push(async () => {
        const cards = await dailyDiscover(context, await this.discoverSeeds());
        live(() => { if (cards.length > 0) this.discover = cards; });
      });
    } else if (profile.topArtists.length > 0) {
      tasks.push(async () => {
        const cards = await starterSongs(context, profile.topArtists);
        live(() => { if (cards.length > 0) this.starter = cards; });
      });
    }
    if (profile.hasHistory) {
      tasks.push(async () => {
        const community = await communityPlaylists(context, profile.topArtists, profile.songSeeds);
        live(() => { if (community) this.online = { ...this.online, community }; });
      });
    }
    tasks.push(async () => {
      let genreError: unknown;
      const [because, more, fresh, genres] = await Promise.all([
        becauseYouLike(context, profile.songSeeds.slice(0, 3)),
        moreLike(context, profile.topArtists.slice(0, 3)),
        newFromArtists(context, new Date(this.now())),
        newGenres(context, 3).catch((error) => { genreError = error; return [] as HomeRow[]; }),
      ]);
      const categories = arrangeCategories({ because, moreLike: more, newFromArtists: fresh ? [fresh] : [], newGenre: genres });
      if (categories.length === 0 && genreError) throw genreError;
      live(() => { this.online = { ...this.online, categories }; });
    });

    await Promise.allSettled(tasks.map(run));
    if (generation !== this.generation) return;
    signals.markRefreshed();
    this.lastLoadAt = this.now();
    const status: OnlineStatus = calls.failed.length === 0 ? 'ready' : calls.ok === 0 ? 'failed' : 'partial';
    this.publish({
      online: status, errorKind: calls.failed[0],
      fromCache: status === 'ready' || status === 'partial' ? this.snapshot.fromCache && status === 'partial' : this.snapshot.fromCache,
      updatedAt: status === 'failed' ? this.snapshot.updatedAt : this.now(),
    });
  }
}

const errorKind = (error: unknown): CatalogErrorKind => (error instanceof CatalogRequestError ? error.kind : 'network');

function mergeRows(existing: HomeRow[], extra: HomeRow[]): HomeRow[] {
  const seen = new Set(existing.map((row) => row.id));
  return [...existing, ...extra.filter((row) => !seen.has(row.id))];
}

function trackGateway(gateway: CatalogGateway, calls: { ok: number; failed: CatalogErrorKind[] }): CatalogGateway {
  const wrapped: Record<string, unknown> = {};
  for (const key of Object.keys(gateway) as Array<keyof CatalogGateway>) {
    const fn = gateway[key] as (...args: unknown[]) => Promise<unknown>;
    wrapped[key] = (...args: unknown[]) => fn.apply(gateway, args).then(
      (value) => { calls.ok += 1; return value; },
      (error) => { if (errorKind(error) !== 'aborted') calls.failed.push(errorKind(error)); throw error; },
    );
  }
  return wrapped as unknown as CatalogGateway;
}
