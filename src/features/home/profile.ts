import type { LibraryRepository } from '../../library/repository';
import type { Track } from '../../model';
import type { ListeningSignals } from './signals';

export type Random = () => number;

export interface ArtistRef { id: string; name: string; artworkUrl?: string; timeListenedMs?: number }

/** What the user has been listening to, read once per load and shared by every recommendation row. */
export interface TasteProfile {
  /** Provider ids of songs played in the last three months (or liked). */
  heard: ReadonlySet<string>;
  /** Songs skipped lately; they never come back as a recommendation. */
  avoidSongs: ReadonlySet<string>;
  /** Artists skipped three or more times, lowercased. */
  avoidArtists: ReadonlySet<string>;
  /** Songs to grow rows from, strongest first, one per artist. */
  songSeeds: Track[];
  topArtists: ArtistRef[];
  hasHistory: boolean;
}

const DAY = 86_400_000;
const isYouTubeArtistId = (id: string | undefined): id is string => !!id && (id.startsWith('UC') || id.startsWith('MPLA'));

/** Efraimidis–Spirakis: a stronger score is likelier to win but never certain to. */
export function weightedSample<T>(candidates: ReadonlyArray<readonly [T, number]>, count: number, rng: Random = Math.random): T[] {
  return candidates
    .map(([item, weight]) => [item, Math.log(Math.max(rng(), 1e-9)) / Math.max(weight, 1e-6)] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([item]) => item);
}

export async function buildProfile(
  repo: LibraryRepository,
  signals: Pick<ListeningSignals, 'recentSkips'>,
  options: { now?: number; rng?: Random } = {},
): Promise<TasteProfile> {
  const now = options.now ?? Date.now();
  const rng = options.rng ?? Math.random;
  const history = await repo.listHistory({ sinceMs: now - 90 * DAY });
  const liked = await repo.listLiked();

  // A play today counts 1, two weeks ago about a third, three months ago next to nothing.
  const scores = new Map<string, number>();
  const tracks = new Map<string, Track>();
  for (const play of history) {
    if (!play.track) continue;
    const ageDays = (now - play.startedAt) / DAY;
    scores.set(play.track.id, (scores.get(play.track.id) ?? 0) + Math.exp(-ageDays / 14));
    tracks.set(play.track.id, play.track);
  }
  // A like says more than a play; the newest likes count.
  for (const like of [...liked].sort((a, b) => a.likedAt - b.likedAt).slice(-50)) {
    if (!like.track) continue;
    scores.set(like.track.id, (scores.get(like.track.id) ?? 0) + 1.5);
    if (!tracks.has(like.track.id)) tracks.set(like.track.id, like.track);
  }

  const skips = signals.recentSkips(14);
  const avoidSongs = new Set(skips.map((skip) => skip.songId));
  const artistSkipCounts = new Map<string, number>();
  for (const skip of skips) for (const artist of skip.artists) artistSkipCounts.set(artist.toLowerCase(), (artistSkipCounts.get(artist.toLowerCase()) ?? 0) + 1);
  const avoidArtists = new Set([...artistSkipCounts].filter(([, count]) => count >= 3).map(([name]) => name));
  const isAvoided = (track: Track) =>
    avoidSongs.has(track.id) || (track.artists ?? [{ name: track.artist }]).some((artist) => avoidArtists.has(artist.name.toLowerCase()));

  const seen = new Set<string>();
  const candidates = [...scores]
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => [tracks.get(id)!, score] as const)
    .filter(([track]) => (track.provider ?? 'youtube') === 'youtube' && !isAvoided(track))
    .filter(([track]) => {
      const key = track.artists?.[0]?.name ?? track.artist ?? track.id;
      return seen.has(key) ? false : (seen.add(key), true);
    })
    .slice(0, 14);
  const songSeeds = weightedSample(candidates, 8, rng);

  // Artists by listening time this month; before any listening, the ones picked in onboarding.
  const listened = new Map<string, ArtistRef>();
  for (const play of history) {
    if (play.startedAt < now - 30 * DAY || !play.track) continue;
    const artist = play.track.artists?.find((candidate) => isYouTubeArtistId(candidate.id));
    if (!artist || !artist.id) continue;
    const entry = listened.get(artist.id) ?? { id: artist.id, name: artist.name, timeListenedMs: 0 };
    entry.timeListenedMs = (entry.timeListenedMs ?? 0) + play.listenedMs;
    listened.set(artist.id, entry);
  }
  let topArtists = [...listened.values()]
    .filter((artist) => !avoidArtists.has(artist.name.toLowerCase()))
    .sort((a, b) => (b.timeListenedMs ?? 0) - (a.timeListenedMs ?? 0))
    .slice(0, 14);
  if (topArtists.length === 0) {
    const saved = await repo.listSavedEntities('artist');
    topArtists = saved
      .filter((entity) => entity.ref.provider === 'youtube' && isYouTubeArtistId(entity.ref.id) && !avoidArtists.has(entity.title.toLowerCase()))
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(0, 14)
      .map((entity) => ({ id: entity.ref.id, name: entity.title, artworkUrl: entity.artworkUrl }));
  }

  return { heard: new Set(scores.keys()), avoidSongs, avoidArtists, songSeeds, topArtists, hasHistory: history.length > 0 };
}
