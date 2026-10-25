import { tr } from '../app/i18n';
import type { CatalogGateway } from '../catalog/gateway';
import type { CatalogItem } from '../catalog/types';
import type { Track } from '../model';
import { trackFromCatalog } from '../features/home/model';

/** A song as another service lists it: what is known about it, before it has a YouTube id. */
export interface ImportedTrack { title: string; artist: string; album?: string; durationMs?: number }

// Same rules and thresholds as the Android TrackMatcher, so a link gives the same result on both.
const SONG_ACCEPT = 0.62;
const VIDEO_ACCEPT = 0.7;
const SONG_FALLBACK_ACCEPT = 0.5;
const MIN_TITLE = 0.45;
const VERSION_WORDS = ['remix', 'live', 'instrumental', 'acoustic', 'karaoke', 'cover', 'sped up', 'slowed', 'nightcore'];
const NOISE_IN_BRACKETS = /[(\[][^)\]]*\b(feat|ft|with|remaster|remastered|version|edit|mono|stereo|deluxe|explicit|clean|bonus|from|official|audio|video|lyrics?|visuali[sz]er|hd|hq|4k)\b[^)\]]*[)\]]/gi;
const DASH_SUFFIX = /\s[-–—]\s.*(remaster|version|edit|mono|stereo|mix\b|from |live at|bonus).*$/i;
const FEAT_TAIL = /\s(feat\.?|ft\.?|featuring)\s.*$/i;
const ARTIST_SPLIT = /\s*(?:,|&|;|\/|\sx\s|\sand\s|\sfeat\.?\s|\sft\.?\s|\sfeaturing\s|\swith\s)\s*/i;
const NON_WORD = /[^\p{L}\p{N}]+/gu;
const MARKS = /\p{M}+/gu;

export const splitArtists = (artist: string): string[] => artist.replace(/ /g, ' ').split(ARTIST_SPLIT).map((part) => part.trim()).filter(Boolean);

export const cleanTitleForSearch = (title: string): string =>
  title.replace(NOISE_IN_BRACKETS, ' ').replace(DASH_SUFFIX, '').replace(FEAT_TAIL, '').replace(/\s+/g, ' ').trim() || title;

export const normalizeText = (text: string): string => text.toLowerCase().normalize('NFKD').replace(MARKS, '').replace(NON_WORD, ' ').trim();
export const normalizeTitle = (title: string): string => normalizeText(cleanTitleForSearch(title));

function levenshtein(a: string, b: string): number {
  if (a.length > 200 || b.length > 200) return Math.abs(a.length - b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Best of word overlap and character distance, so reordered words and scripts without spaces both score fairly. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const tokensA = new Set(a.split(' '));
  const tokensB = new Set(b.split(' '));
  let shared = 0;
  tokensA.forEach((token) => { if (tokensB.has(token)) shared += 1; });
  const jaccard = shared / (tokensA.size + tokensB.size - shared);
  const compactA = a.replace(/ /g, '');
  const compactB = b.replace(/ /g, '');
  const edit = 1 - levenshtein(compactA, compactB) / Math.max(compactA.length, compactB.length);
  const containment = compactA.length >= 3 && compactB.length >= 3 && (compactA.includes(compactB) || compactB.includes(compactA)) ? 0.8 : 0;
  return Math.max(jaccard, edit, containment);
}

function durationScore(sourceMs: number | undefined, candidateMs: number | undefined): number {
  if (!sourceMs || sourceMs <= 0 || !candidateMs || candidateMs <= 0) return 0.5;
  const diff = Math.abs(sourceMs - candidateMs) / 1000;
  return diff <= 3 ? 1 : diff <= 8 ? 0.7 : diff <= 20 ? 0.3 : diff <= 60 ? 0 : -1;
}

/** How well a search result is the wanted song, 0 when the title is too different to be it. */
export function score(wanted: ImportedTrack, candidate: Pick<Track, 'title' | 'durationMs' | 'artist' | 'artists'>): number {
  const targetTitle = normalizeTitle(wanted.title);
  const candidateTitle = normalizeTitle(candidate.title);
  let titleScore = similarity(targetTitle, candidateTitle);
  const targetArtists = splitArtists(wanted.artist).map(normalizeText).filter(Boolean);
  const names = candidate.artists?.length ? candidate.artists.map((artist) => artist.name) : splitArtists(candidate.artist);
  const candidateArtists = names.map(normalizeText).filter(Boolean);
  let artistScore = targetArtists.length === 0 ? 0.5 : Math.max(...targetArtists.map((target) => Math.max(0, ...candidateArtists.map((other) => similarity(target, other)))));
  // Videos are often titled "Artist - Title (Official Video)".
  if (artistScore < 0.6 && targetArtists.some((artist) => artist && candidateTitle.includes(artist))) {
    artistScore = 0.8;
    const stripped = targetArtists.reduce((acc, artist) => acc.split(artist).join(' '), candidateTitle).trim();
    titleScore = Math.max(titleScore, similarity(targetTitle, stripped));
  }
  // A remix, live or instrumental the source did not ask for is a different song (whole words, on the raw titles).
  const rawTarget = ` ${normalizeText(wanted.title)} `;
  const rawCandidate = ` ${normalizeText(candidate.title)} `;
  const penalty = VERSION_WORDS.filter((word) => rawCandidate.includes(` ${word} `) !== rawTarget.includes(` ${word} `)).length * 0.15;
  if (titleScore < MIN_TITLE) return 0;
  return titleScore * 0.55 + artistScore * 0.3 + durationScore(wanted.durationMs, candidate.durationMs) * 0.15 - penalty;
}

/** The search itself failed (network, rate limit), which is not the same as "no such song". */
export class MatchSearchError extends Error {
  constructor(message: string) { super(message); this.name = 'MatchSearchError'; }
}

export type MatchOutcome = { track: Track; score: number; via: 'song' | 'video' | 'fallback' } | undefined;

/**
 * Finds the YouTube song for a track from another service: songs first, a music video only when no
 * song is close. One matcher serves one import run, so a song in two playlists is searched once.
 */
export class TrackMatcher {
  private readonly cache = new Map<string, Promise<MatchOutcome>>();
  constructor(private readonly catalog: Pick<CatalogGateway, 'search'>, private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {}

  match(wanted: ImportedTrack, signal?: AbortSignal): Promise<MatchOutcome> {
    const key = `${normalizeTitle(wanted.title)}|${normalizeText(wanted.artist)}|${wanted.durationMs ? Math.floor(wanted.durationMs / 5000) : ''}`;
    let hit = this.cache.get(key);
    if (!hit) {
      hit = this.findBest(wanted, signal);
      this.cache.set(key, hit);
      // A cancelled or failed search must not be remembered as "no match".
      hit.catch(() => this.cache.delete(key));
    }
    return hit;
  }

  private async search(query: string, filter: 'songs' | 'videos', signal?: AbortSignal): Promise<Track[]> {
    let failure = tr('err.search.failedShort');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        const page = await this.catalog.search(query, filter, signal);
        const items: CatalogItem[] = page.items.length ? page.items : page.sections.flatMap((section) => section.items);
        return items.filter((item) => item.kind === 'track' || item.kind === 'video').slice(0, 10).map(trackFromCatalog);
      } catch (error) {
        if (signal?.aborted || (error as { kind?: string })?.kind === 'aborted') throw new DOMException('Aborted', 'AbortError');
        failure = error instanceof Error && error.message ? error.message : failure;
        if (attempt === 0) await this.sleep(800);
      }
    }
    throw new MatchSearchError(failure);
  }

  private async findBest(wanted: ImportedTrack, signal?: AbortSignal): Promise<MatchOutcome> {
    const query = `${cleanTitleForSearch(wanted.title)} ${splitArtists(wanted.artist)[0] ?? ''}`.trim();
    const best = (tracks: Track[]) => tracks.map((track) => ({ track, score: score(wanted, track) })).sort((a, b) => b.score - a.score)[0];
    const bestSong = best(await this.search(query, 'songs', signal));
    if (bestSong && bestSong.score >= SONG_ACCEPT) return { ...bestSong, via: 'song' };
    // Some songs exist on YouTube only as uploads.
    const bestVideo = best(await this.search(query, 'videos', signal));
    if (bestVideo && bestVideo.score >= VIDEO_ACCEPT) return { ...bestVideo, via: 'video' };
    return bestSong && bestSong.score >= SONG_FALLBACK_ACCEPT ? { ...bestSong, via: 'fallback' } : undefined;
  }
}
