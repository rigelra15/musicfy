import type { LibraryRepository } from '../../library/repository';
import type { Track } from '../../model';
import { trackKeyOf } from '../../domain/entity';
import { applyFilters, dedupe, homeItemFromTrack, type ContentFilters, type HomeItem, type HomeRow } from './model';

const DAY = 86_400_000;
export const PREF_LIKED_PLAYED_AT = 'home.lastPlayedLikedAt';

const likedCard = (count: number): HomeItem => ({ key: 'liked', kind: 'liked', id: 'liked', title: '', count });

/** Local rows only read the user's own library and history, so they are ready before any network. */
export interface LocalRows {
  recent?: HomeRow;
  quick?: HomeRow;
  mostPlayed?: HomeRow;
  history?: HomeRow;
  forgotten?: HomeRow;
  keepListening?: HomeRow;
  localPlaylists?: HomeRow;
  hasHistory: boolean;
  likedCount: number;
}

const row = (id: string, kind: HomeRow['kind'], items: HomeItem[]): HomeRow | undefined =>
  items.length > 0 ? { id, kind, title: '', origin: 'local', items } : undefined;

export async function loadLocalRows(
  repo: LibraryRepository,
  options: { now: number; filters: ContentFilters; likedPlayedAt?: number },
): Promise<LocalRows> {
  const { now, filters } = options;
  const history = await repo.listHistory({ sinceMs: 0 });
  const liked = await repo.listLiked();
  const playlists = await repo.listPlaylists();

  // newest first, one entry per track
  const lastPlays: Track[] = [];
  const seen = new Set<string>();
  for (const play of history) {
    if (!play.track || seen.has(play.trackKey)) continue;
    seen.add(play.trackKey);
    lastPlays.push(play.track);
  }
  const toItems = (tracks: Track[]) => applyFilters(dedupe(tracks.map(homeItemFromTrack)), filters);

  const likedRecently = options.likedPlayedAt !== undefined && now - options.likedPlayedAt < 7 * DAY && liked.length > 0;
  const recentItems = toItems(lastPlays.slice(0, 20));
  if (likedRecently) recentItems.unshift(likedCard(liked.length));

  const resolve = async (keys: string[]) => {
    const tracks = await repo.getTracks(keys);
    return keys.map((key) => tracks.get(key)).filter((track): track is Track => !!track);
  };
  const quickCounts = await repo.playCounts({ sinceMs: now - 30 * DAY });
  const quick = toItems(await resolve(quickCounts.slice(0, 30).map((count) => count.trackKey))).slice(0, 20);
  const allCounts = await repo.playCounts();
  const mostPlayed = toItems(await resolve(allCounts.slice(0, 30).map((count) => count.trackKey))).slice(0, 20);

  // Forgotten favourites: heard a lot before the last month, hardly at all since.
  const perTrack = new Map<string, { older: number; recent: number; plays: number }>();
  for (const play of history) {
    const entry = perTrack.get(play.trackKey) ?? { older: 0, recent: 0, plays: 0 };
    if (play.startedAt >= now - 30 * DAY) entry.recent += play.listenedMs;
    else { entry.older += play.listenedMs; entry.plays += 1; }
    perTrack.set(play.trackKey, entry);
  }
  const forgottenKeys = [...perTrack]
    .filter(([, value]) => value.plays >= 2 && value.older * 0.2 > value.recent)
    .sort((a, b) => b[1].older - a[1].older)
    .slice(0, 20)
    .map(([key]) => key);
  const forgotten = toItems(await resolve(forgottenKeys));

  // Keep listening: the last songs, the playlists they sit in, and Liked when they are liked songs.
  const lastTen = lastPlays.slice(0, 10);
  const lastKeys = new Set(lastTen.map((track) => trackKeyOf(track)));
  const keepItems: HomeItem[] = toItems(lastTen.slice(0, 6));
  const keepPlaylists: HomeItem[] = [];
  for (const playlist of playlists) {
    if (keepPlaylists.length >= 3) break;
    const full = await repo.getPlaylist(playlist.id);
    if (full?.entries.some((entry) => lastKeys.has(entry.trackKey))) {
      keepPlaylists.push({ key: `localPlaylist:${playlist.id}`, kind: 'localPlaylist', id: playlist.id, title: playlist.name, count: playlist.trackCount, artworkUrl: full.entries.find((entry) => entry.track?.artworkUrl)?.track?.artworkUrl });
    }
  }
  const likedKeys = new Set(liked.map((like) => like.trackKey));
  const hasLikedAmongLast = [...lastKeys].some((key) => likedKeys.has(key));
  const keepListening = [...keepItems, ...keepPlaylists, ...(hasLikedAmongLast ? [likedCard(liked.length)] : [])];

  const playlistItems: HomeItem[] = [];
  for (const playlist of playlists.slice(0, 20)) {
    const full = await repo.getPlaylist(playlist.id);
    playlistItems.push({
      key: `localPlaylist:${playlist.id}`, kind: 'localPlaylist', id: playlist.id, title: playlist.name, count: playlist.trackCount,
      artworkUrl: full?.entries.find((entry) => entry.track?.artworkUrl)?.track?.artworkUrl,
    });
  }

  return {
    recent: row('recent', 'recent', recentItems),
    quick: row('quick', 'quick', quick),
    mostPlayed: row('mostPlayed', 'mostPlayed', mostPlayed),
    history: row('history', 'history', toItems(lastPlays.slice(0, 15))),
    forgotten: row('forgotten', 'forgotten', forgotten),
    keepListening: keepListening.length >= 3 ? row('keepListening', 'keepListening', keepListening) : undefined,
    localPlaylists: row('localPlaylists', 'localPlaylists', playlistItems),
    hasHistory: history.length > 0,
    likedCount: liked.length,
  };
}
