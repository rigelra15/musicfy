import type { Track } from '../../model';

/** A play as the history keeps it: when it started, how long it was really listened to, and the song if it is still known. */
export interface PlayEvent {
  id: string;
  trackKey: string;
  startedAt: number;
  listenedMs: number;
  track?: Track;
}

export interface StatsRange { kind: 'month' | 'year'; year: number; /** 1-12; ignored for a year. */ month: number }

/** Recap unlocks from this day of the month; before it the previous month is shown (as on Android). */
export const RECAP_FIRST_DAY = 3;
/** Different songs a month needs before it has a recap. */
export const RECAP_MIN_SONGS = 10;
export const MAX_TOP_SONGS = 20;
export const MAX_TOP_ARTISTS = 25;

export const monthOf = (date: Date): StatsRange => ({ kind: 'month', year: date.getFullYear(), month: date.getMonth() + 1 });
export const yearOf = (date: Date): StatsRange => ({ kind: 'year', year: date.getFullYear(), month: 1 });

export function shiftRange(range: StatsRange, delta: number): StatsRange {
  if (range.kind === 'year') return { kind: 'year', year: range.year + delta, month: 1 };
  const index = range.year * 12 + (range.month - 1) + delta;
  return { kind: 'month', year: Math.floor(index / 12), month: (index % 12 + 12) % 12 + 1 };
}

export function rangeBounds(range: StatsRange): { startMs: number; endMs: number } {
  return range.kind === 'month'
    ? { startMs: new Date(range.year, range.month - 1, 1).getTime(), endMs: new Date(range.year, range.month, 1).getTime() }
    : { startMs: new Date(range.year, 0, 1).getTime(), endMs: new Date(range.year + 1, 0, 1).getTime() };
}

export interface RecapSong { track: Track; trackKey: string; playTimeMs: number; plays: number }
export interface RecapArtist { name: string; artworkUrl?: string; playTimeMs: number; plays: number; topSong?: RecapSong }

export interface ListeningStats {
  range: StatsRange;
  totalMs: number;
  plays: number;
  songCount: number;
  artistCount: number;
  albumCount: number;
  topSongs: RecapSong[];
  topArtists: RecapArtist[];
  /** Listening time per weekday, Monday first. */
  weekdayMs: number[];
  /** Listening time per hour of the day, 0-23. */
  hourMs: number[];
  /** Per day of the month, or per month of the year. */
  bucketMs: number[];
  /** The hour with the most listening, or undefined when nothing was played. */
  busiestHour: number | undefined;
  isEmpty: boolean;
}

const artistNames = (track: Track): string[] => (track.artists?.length ? track.artists.map((artist) => artist.name) : [track.artist]);

export function aggregate(range: StatsRange, events: readonly PlayEvent[]): ListeningStats {
  const { startMs, endMs } = rangeBounds(range);
  const weekdayMs = new Array<number>(7).fill(0);
  const hourMs = new Array<number>(24).fill(0);
  const bucketMs = new Array<number>(range.kind === 'month' ? new Date(range.year, range.month, 0).getDate() : 12).fill(0);
  const perSong = new Map<string, { track?: Track; ms: number; plays: number }>();
  let totalMs = 0;
  let plays = 0;
  for (const event of events) {
    if (event.startedAt < startMs || event.startedAt >= endMs) continue;
    const ms = Math.max(0, event.listenedMs);
    const when = new Date(event.startedAt);
    plays += 1;
    totalMs += ms;
    weekdayMs[(when.getDay() + 6) % 7] += ms;
    hourMs[when.getHours()] += ms;
    bucketMs[range.kind === 'month' ? when.getDate() - 1 : when.getMonth()] += ms;
    const song = perSong.get(event.trackKey) ?? { track: event.track, ms: 0, plays: 0 };
    song.track ??= event.track;
    song.ms += ms;
    song.plays += 1;
    perSong.set(event.trackKey, song);
  }

  const byPlays = (a: RecapSong, b: RecapSong) => b.plays - a.plays || b.playTimeMs - a.playTimeMs;
  const known: RecapSong[] = [];
  for (const [trackKey, song] of perSong) if (song.track) known.push({ track: song.track, trackKey, playTimeMs: song.ms, plays: song.plays });
  known.sort(byPlays);

  // One person can come back under a few spellings or channels: merge by name so they take one place.
  const perArtist = new Map<string, { name: string; artworkUrl?: string; ms: number; plays: number; songs: RecapSong[] }>();
  const albums = new Set<string>();
  for (const song of known) {
    const album = song.track.albumId ?? song.track.album?.trim().toLowerCase();
    if (album) albums.add(album);
    const seen = new Set<string>();
    for (const raw of artistNames(song.track)) {
      const key = raw.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const artist = perArtist.get(key) ?? { name: raw.trim(), artworkUrl: undefined, ms: 0, plays: 0, songs: [] };
      artist.artworkUrl ??= song.track.artworkUrl;
      artist.ms += song.playTimeMs;
      artist.plays += song.plays;
      artist.songs.push(song);
      perArtist.set(key, artist);
    }
  }
  const topArtists = [...perArtist.values()]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, MAX_TOP_ARTISTS)
    .map((artist): RecapArtist => ({ name: artist.name, artworkUrl: artist.artworkUrl, playTimeMs: artist.ms, plays: artist.plays, topSong: [...artist.songs].sort(byPlays)[0] }));

  const busiest = Math.max(...hourMs);
  return {
    range,
    totalMs,
    plays,
    songCount: perSong.size,
    artistCount: perArtist.size,
    albumCount: albums.size,
    topSongs: known.slice(0, MAX_TOP_SONGS),
    topArtists,
    weekdayMs,
    hourMs,
    bucketMs,
    busiestHour: busiest > 0 ? hourMs.indexOf(busiest) : undefined,
    isEmpty: plays === 0,
  };
}

// ---- history grouping ---------------------------------------------------------------------

export type HistoryGroupKey = 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | string;
export interface HistoryGroup { key: HistoryGroupKey; /** First of the month for month groups. */ month?: { year: number; month: number }; events: PlayEvent[] }

const dayNumber = (date: Date) => Math.round(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 86_400_000);

/** Today, Yesterday, This week, Last week (Monday-based), then one group per month; newest first, each song once per group. */
export function groupHistory(events: readonly PlayEvent[], nowMs: number, options: { hideVideos?: boolean } = {}): HistoryGroup[] {
  const now = new Date(nowMs);
  const today = dayNumber(now);
  const thisMonday = today - ((now.getDay() + 6) % 7);
  const lastMonday = thisMonday - 7;
  const order = new Map<string, number>();
  const groups = new Map<string, HistoryGroup>();
  const sorted = [...events].sort((a, b) => b.startedAt - a.startedAt);
  for (const event of sorted) {
    if (options.hideVideos && event.track?.isVideo) continue;
    const when = new Date(event.startedAt);
    const day = dayNumber(when);
    let key: string;
    let month: { year: number; month: number } | undefined;
    let rank: number;
    if (day === today) { key = 'today'; rank = 0; }
    else if (day === today - 1) { key = 'yesterday'; rank = 1; }
    else if (day >= thisMonday) { key = 'thisWeek'; rank = 2; }
    else if (day >= lastMonday) { key = 'lastWeek'; rank = 3; }
    else {
      month = { year: when.getFullYear(), month: when.getMonth() + 1 };
      key = `${month.year}-${String(month.month).padStart(2, '0')}`;
      rank = today - dayNumber(new Date(month.year, month.month - 1, 1));
      rank = Math.max(rank, 4);
    }
    const group = groups.get(key) ?? { key, month, events: [] };
    if (!groups.has(key)) { groups.set(key, group); order.set(key, rank); }
    if (!group.events.some((other) => other.trackKey === event.trackKey)) group.events.push(event);
  }
  return [...groups.values()].sort((a, b) => order.get(a.key)! - order.get(b.key)!);
}

// ---- recap --------------------------------------------------------------------------------

export type RecapAvailability =
  | { status: 'ready'; range: StatsRange; stats: ListeningStats; progressPercent: number }
  | { status: 'notYet'; missingSongs: number; /** Day of this month on which the recap unlocks, when it is waiting for that. */ unlockDay: number | undefined };

/** The month the recap is about today, or what is still missing (Android's rules). */
export function recapAvailability(events: readonly PlayEvent[], today: Date): RecapAvailability {
  const progress = (percent: number) => Math.min(100, Math.max(1, percent));
  if (today.getDate() < RECAP_FIRST_DAY) {
    const previous = shiftRange(monthOf(today), -1);
    const stats = aggregate(previous, events);
    if (stats.songCount >= RECAP_MIN_SONGS) return { status: 'ready', range: previous, stats, progressPercent: 100 };
    return { status: 'notYet', missingSongs: RECAP_MIN_SONGS - stats.songCount, unlockDay: RECAP_FIRST_DAY };
  }
  const range = monthOf(today);
  const stats = aggregate(range, events);
  if (stats.songCount >= RECAP_MIN_SONGS) {
    const days = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    return { status: 'ready', range, stats, progressPercent: progress(Math.round((today.getDate() * 100) / days)) };
  }
  return { status: 'notYet', missingSongs: RECAP_MIN_SONGS - stats.songCount, unlockDay: undefined };
}
