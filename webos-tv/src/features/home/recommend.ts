import type { CatalogGateway } from '../../catalog/gateway';
import type { CatalogItem, CatalogSection } from '../../catalog/types';
import type { Track } from '../../model';
import { genreScore, isGenre } from './genres';
import { applyFilters, dedupe, homeItemFromCatalog, type ContentFilters, type HomeItem, type HomeRow } from './model';
import type { ArtistRef, Random, TasteProfile } from './profile';

const flat = (sections: readonly CatalogSection[]): CatalogItem[] => sections.flatMap((section) => section.items);
const isSong = (item: CatalogItem) => item.kind === 'track';
const firstArtist = (item: CatalogItem) => item.artists?.[0]?.name?.toLowerCase();

export function shuffle<T>(items: readonly T[], rng: Random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Mostly songs the user has not heard, plus a few they have so the row still feels like theirs.
 * Nothing skipped, no videos (these are song rows), and at most `perArtist` songs per artist.
 */
export function pickSongs(
  songs: readonly CatalogItem[],
  profile: Pick<TasteProfile, 'heard' | 'avoidSongs' | 'avoidArtists'>,
  filters: ContentFilters,
  options: { limit: number; perArtist: number; rng: Random },
): CatalogItem[] {
  const usable = dedupeById(songs.filter((song) =>
    song.kind === 'track'
    && !(filters.hideExplicit && song.isExplicit)
    && !profile.avoidSongs.has(song.id)
    && !(song.artists ?? []).some((artist) => profile.avoidArtists.has(artist.name.toLowerCase()))));
  const heard = usable.filter((song) => profile.heard.has(song.id));
  const unheard = usable.filter((song) => !profile.heard.has(song.id));
  const familiar = Math.max(1, Math.floor(options.limit / 4));
  const chosen = [
    ...shuffle(unheard.slice(0, options.limit * 2), options.rng).slice(0, options.limit - Math.min(familiar, heard.length)),
    ...shuffle(heard, options.rng).slice(0, familiar),
  ];
  const perArtist = new Map<string, number>();
  return shuffle(chosen, options.rng).filter((song) => {
    const artist = firstArtist(song);
    if (!artist) return true;
    const count = (perArtist.get(artist) ?? 0) + 1;
    perArtist.set(artist, count);
    return count <= options.perArtist;
  });
}

const dedupeById = (items: readonly CatalogItem[]) => {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
};

/** A playlist after every three songs, the rest of the playlists at the end. */
export function mix<T>(songs: readonly T[], playlists: readonly T[]): T[] {
  const result: T[] = [];
  let next = 0;
  songs.forEach((song, index) => {
    result.push(song);
    if (index % 3 === 2 && next < playlists.length) result.push(playlists[next++]);
  });
  return result.concat(playlists.slice(next));
}

export type CategoryKind = 'because' | 'moreLike' | 'newGenre' | 'newFromArtists';

/**
 * Orders recommendation rows the way Home shows them: a song row, an artist row and a genre row in
 * turn, new releases after the first round, new genres last. A song shows up only in the first row
 * that has it, and a row left with fewer than four cards is dropped.
 */
export function arrangeCategories(parts: Partial<Record<CategoryKind, HomeRow[]>>): HomeRow[] {
  const rounds = (['because', 'moreLike'] as const).map((kind) => [...(parts[kind] ?? [])]);
  const ordered: HomeRow[] = [];
  let first = true;
  while (rounds.some((queue) => queue.length > 0)) {
    for (const queue of rounds) {
      const row = queue.shift();
      if (row) ordered.push(row);
    }
    if (first) ordered.push(...(parts.newFromArtists ?? []));
    first = false;
  }
  if (first) ordered.push(...(parts.newFromArtists ?? []));
  ordered.push(...(parts.newGenre ?? []));
  const seen = new Set<string>();
  return ordered
    .map((row) => ({ ...row, items: row.items.filter((item) => (seen.has(item.key) ? false : (seen.add(item.key), true))) }))
    .filter((row) => row.items.length >= 4);
}

export interface RecommendContext {
  gateway: CatalogGateway;
  profile: TasteProfile;
  filters: ContentFilters;
  rng: Random;
  signal?: AbortSignal;
  /** One artist page per load, shared by every row that reads one. */
  artistPage: (id: string) => Promise<Awaited<ReturnType<CatalogGateway['artist']>> | undefined>;
}

const toItems = (items: CatalogItem[]): HomeItem[] => items.map(homeItemFromCatalog);

/** "Because you like <song>": the song's related page, mostly new to the user. */
export async function becauseYouLike(context: RecommendContext, seeds: readonly Track[]): Promise<HomeRow[]> {
  const rows = await Promise.all(seeds.map(async (seed): Promise<HomeRow | undefined> => {
    try {
      const next = await context.gateway.next({ videoId: seed.id }, context.signal);
      if (!next.relatedBrowseId) return undefined;
      const related = await context.gateway.related(next.relatedBrowseId, context.signal);
      const items = flat(related.sections);
      const songs = pickSongs(items.filter((item) => isSong(item) && item.id !== seed.id), context.profile, context.filters, { limit: 10, perArtist: 2, rng: context.rng });
      const playlists = items.filter((item) => item.kind === 'playlist' && !(context.filters.hideExplicit && item.isExplicit)).slice(0, 3);
      return { id: `because:${seed.id}`, kind: 'because', title: seed.title, subtitle: seed.artist, origin: 'online', items: toItems(mix(songs, playlists)) };
    } catch {
      return undefined;
    }
  }));
  return rows.filter((row): row is HomeRow => !!row);
}

/** "More like <artist>": the artist's radio minus the artist, one song per artist, plus playlists. */
export async function moreLike(context: RecommendContext, seeds: readonly ArtistRef[]): Promise<HomeRow[]> {
  const rows = await Promise.all(seeds.map(async (seed): Promise<HomeRow | undefined> => {
    try {
      const page = await context.artistPage(seed.id);
      const radio = page?.header.radioPlaylistId;
      if (!page || !radio) return undefined;
      const queue = await context.gateway.next({ playlistId: radio }, context.signal);
      const name = seed.name.toLowerCase();
      const others = queue.items.filter((song) => !(song.artists ?? []).some((artist) => artist.id === seed.id || artist.name.toLowerCase() === name));
      const songs = pickSongs(others, context.profile, context.filters, { limit: 12, perArtist: 1, rng: context.rng });
      // "Featured on" comes before "Playlists by", and both are all playlists.
      const playlistSection = page.sections.find((section) => section.items.length > 0 && section.items.every((item) => item.kind === 'playlist'));
      const playlists = (playlistSection?.items ?? []).filter((item) => !(context.filters.hideExplicit && item.isExplicit)).slice(0, 2);
      return {
        id: `moreLike:${seed.id}`, kind: 'moreLike', title: seed.name, origin: 'online', items: toItems(mix(songs, playlists)),
        more: { browseId: seed.id },
      };
    } catch {
      return undefined;
    }
  }));
  return rows.filter((row): row is HomeRow => !!row);
}

/** The newest singles and albums of the artists the user plays most, this year and last. */
export async function newFromArtists(context: RecommendContext, now = new Date()): Promise<HomeRow | undefined> {
  const pages = (await Promise.all(context.profile.topArtists.slice(0, 8).map((artist) => context.artistPage(artist.id).catch(() => undefined)))).filter(Boolean);
  const since = now.getFullYear() - 1;
  const releases = pages
    .flatMap((page) => page!.sections
      .filter((section) => section.items.length > 0 && section.items.every((item) => item.kind === 'album'))
      .flatMap((section) => section.items.slice(0, 2)))
    .filter((item) => Number(item.year ?? 0) >= since && !(context.filters.hideExplicit && item.isExplicit));
  const unique = dedupeById(releases).sort((a, b) => Number(b.year ?? 0) - Number(a.year ?? 0)).slice(0, 12);
  if (unique.length < 3) return undefined;
  return { id: 'newFromArtists', kind: 'newFromArtists', title: '', origin: 'online', items: toItems(unique) };
}

/**
 * Genres the user does not play yet, so Home is not only more of the same. Android also fills up to
 * three "your genre" rows by looking each top artist up on iTunes; that host is not reachable from
 * the TV service, so only the discovery rows are produced here.
 */
export async function newGenres(context: RecommendContext, count = 5): Promise<HomeRow[]> {
  const grid = await context.gateway.page('FEmusic_moods_and_genres', undefined, context.signal);
  const best = [...grid.sections].sort((a, b) => genreScore(b.items.map((item) => item.title)) - genreScore(a.items.map((item) => item.title)))[0];
  const tiles = (best?.items ?? []).filter((item) => item.kind === 'link' && item.browseId && isGenre(item.title));
  const chosen = shuffle(tiles, context.rng).slice(0, count);
  const rows = await Promise.all(chosen.map(async (tile): Promise<HomeRow | undefined> => {
    try {
      const page = await context.gateway.page(tile.browseId!, tile.params, context.signal);
      const shelves = page.sections.map((section) => section.items);
      const songs = pickSongs(shuffle(shelves.flat().filter(isSong).slice(0, 40), context.rng), context.profile, context.filters, { limit: 9, perArtist: 2, rng: context.rng });
      const playlistShelf = shelves.find((shelf) => shelf.length > 0 && shelf.every((item) => item.kind === 'playlist')) ?? [];
      const playlists = shuffle(playlistShelf.filter((item) => !(context.filters.hideExplicit && item.isExplicit)), context.rng).slice(0, 3);
      return {
        id: `genre:${tile.browseId}:${tile.params ?? ''}`, kind: 'newGenre', title: tile.title, origin: 'online', items: toItems(mix(songs, playlists)),
        more: { browseId: tile.browseId!, params: tile.params },
      };
    } catch {
      return undefined;
    }
  }));
  return rows.filter((row): row is HomeRow => !!row);
}

export { applyFilters };

export interface DiscoverCard { item: HomeItem; seed: { id: string; title: string; artist: string } }

/**
 * Hero "Temuan hari ini": one new song per seed, each seed from a different direction (a like, an
 * often-played song, a recent one) and one card per artist so a single act cannot take the hero.
 */
export async function dailyDiscover(context: RecommendContext, seeds: readonly Track[]): Promise<DiscoverCard[]> {
  const cards = (await Promise.all(seeds.map(async (seed): Promise<DiscoverCard | undefined> => {
    try {
      const next = await context.gateway.next({ videoId: seed.id }, context.signal);
      if (!next.relatedBrowseId) return undefined;
      const related = await context.gateway.related(next.relatedBrowseId, context.signal);
      const candidates = flat(related.sections).filter((item) =>
        item.kind === 'track' && item.id !== seed.id
        && !(context.filters.hideVideoSongs && item.kind !== 'track') && !(context.filters.hideExplicit && item.isExplicit));
      const fresh = shuffle(candidates.filter((item) => !context.profile.heard.has(item.id)), context.rng)[0];
      const pick = fresh ?? shuffle(candidates, context.rng)[0];
      return pick ? { item: homeItemFromCatalog(pick), seed: { id: seed.id, title: seed.title, artist: seed.artist } } : undefined;
    } catch {
      return undefined;
    }
  }))).filter((card): card is DiscoverCard => !!card);
  const seenSong = new Set<string>();
  const seenArtist = new Set<string>();
  const unique = cards.filter((card) => {
    const artist = card.item.track?.artists?.[0]?.name?.toLowerCase() ?? card.item.id;
    if (seenSong.has(card.item.id) || seenArtist.has(artist)) return false;
    seenSong.add(card.item.id); seenArtist.add(artist);
    return true;
  });
  return shuffle(unique, context.rng);
}

const OWN_PLAYLISTS = new Set(['youtube music', 'youtube', 'playlist']);

/** Playlists made by listeners (not YouTube's own mixes and album playlists), for "Dari komunitas". */
export async function communityPlaylists(context: RecommendContext, artists: readonly ArtistRef[], songs: readonly Track[]): Promise<HomeRow | undefined> {
  const candidates: CatalogItem[] = [];
  const keep = (item: CatalogItem, ownArtist?: string) => {
    const id = (item.playlistId ?? item.id).replace(/^VL/, '');
    // "Playlist • Author • 12 songs": the author is the second part; a lone "Playlist" has none.
    const parts = (item.subtitle ?? '').split('•').map((part) => part.trim().toLowerCase());
    const author = parts.length >= 2 ? parts[1] : parts[0];
    return item.kind === 'playlist' && !id.startsWith('RD') && !id.startsWith('OLAK') && !OWN_PLAYLISTS.has(author) && author !== ownArtist;
  };
  await Promise.all([
    ...shuffle(artists, context.rng).slice(0, 3).map(async (artist) => {
      const page = await context.artistPage(artist.id).catch(() => undefined);
      if (page) candidates.push(...flat(page.sections).filter((item) => keep(item, artist.name.toLowerCase())));
    }),
    ...shuffle(songs, context.rng).slice(0, 2).map(async (song) => {
      try {
        const next = await context.gateway.next({ videoId: song.id }, context.signal);
        if (!next.relatedBrowseId) return;
        candidates.push(...flat((await context.gateway.related(next.relatedBrowseId, context.signal)).sections).filter((item) => keep(item)));
      } catch { /* one seed failing leaves the others */ }
    }),
  ]);
  const picked = shuffle(dedupeById(candidates), context.rng).slice(0, 5).filter((item) => !(context.filters.hideExplicit && item.isExplicit));
  // A playlist that opens empty is worse than none, so each is confirmed before it is offered.
  const confirmed = (await Promise.all(picked.map(async (item) => {
    try {
      const page = await context.gateway.playlist(item.playlistId ?? item.id, context.signal);
      return page.tracks.length > 0 ? item : undefined;
    } catch { return undefined; }
  }))).filter((item): item is CatalogItem => !!item);
  return confirmed.length > 0 ? { id: 'community', kind: 'community', title: '', origin: 'online', items: toItems(confirmed) } : undefined;
}

export interface StarterCard { item: HomeItem; artist: { id: string; name: string; artworkUrl?: string } }

/** First-run hero: one song from each artist picked in onboarding, so Home is not empty before any listening. */
export async function starterSongs(context: RecommendContext, artists: readonly ArtistRef[]): Promise<StarterCard[]> {
  const cards = await Promise.all(artists.slice(0, 5).map(async (artist): Promise<StarterCard | undefined> => {
    try {
      const page = await context.artistPage(artist.id);
      const top = page?.songs.filter((song) => song.kind === 'track' && !(context.filters.hideExplicit && song.isExplicit)).slice(0, 3);
      const song = top && top.length ? top[Math.floor(context.rng() * top.length)] : undefined;
      return song ? { item: homeItemFromCatalog(song), artist: { id: artist.id, name: artist.name, artworkUrl: artist.artworkUrl } } : undefined;
    } catch { return undefined; }
  }));
  return cards.filter((card): card is StarterCard => !!card);
}
