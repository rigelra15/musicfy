import type { CatalogItem, CatalogSection } from '../../catalog/types';

// Ported from Android's ArtistVideos: artist pages carry a "Videos" and a "Live performances" shelf
// straight from the artist's channel, which is steadier than searching. Shelf titles come in the
// user's language, so shelves are found by what is in them: rows of videos.
const LIVE_TITLE = /\b(live|langsung|en vivo|ao vivo|en directo|en direct|dal vivo|konser|concerts?)\b|라이브|ライブ|现场|現場/i;
const MUSIC_VIDEO_TITLE = /\b(music videos?|videos?|vídeos?|vidéos?|videoclips?|clipes|musikvideos?|mvs?)\b|뮤직\s?비디오|ミュージックビデオ|音乐视频|音樂影片/i;
const NOT_A_MUSIC_VIDEO = /\b(lyrics?|lirik|audio|visuali[sz]er|teaser|trailer|behind the scenes|making of|shorts|dance practice)\b/i;
const VIDEO_TAGS = /\s*[(\[][^)\]]*\b(official|mv|m\/v|music video|video|4k|hd)\b[^)\]]*[)\]]/gi;

const isVideo = (item: CatalogItem) => item.kind === 'video';
const distinctByTitle = (items: CatalogItem[]) => {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.title.toLowerCase()) ? false : (seen.add(item.title.toLowerCase()), true)));
};

export interface HomeVideoCard { item: CatalogItem; title: string; subtitle: string }

export function videoShelves(sections: readonly CatalogSection[]): { musicVideos: CatalogItem[]; liveShows: CatalogItem[] } {
  const shelves = sections.filter((section) => {
    const videos = section.items.filter((item) => isVideo(item) && !item.album).length;
    return videos > 0 && videos * 4 >= section.items.length * 3;
  });
  const live = shelves.find((section) => LIVE_TITLE.test(section.title ?? '')) ?? shelves[1];
  const videos = shelves.find((section) => section !== live);
  const liveShows = distinctByTitle((live?.items ?? []).filter(isVideo));
  const liveIds = new Set(liveShows.map((item) => item.id));
  const musicVideos = distinctByTitle((videos?.items ?? []).filter((item) => isVideo(item) && !liveIds.has(item.id) && !NOT_A_MUSIC_VIDEO.test(item.title)));
  return { musicVideos, liveShows };
}

/** What kind of video row a feed shelf is, or undefined when it is not all videos. */
export function feedShelfKind(title: string | undefined, items: readonly CatalogItem[]): 'live' | 'musicVideos' | 'other' | undefined {
  const videos = items.filter(isVideo).length;
  if (videos === 0 || videos * 4 < items.length * 3) return undefined;
  if (LIVE_TITLE.test(title ?? '')) return 'live';
  if (MUSIC_VIDEO_TITLE.test(title ?? '')) return 'musicVideos';
  return 'other';
}

export function cleanTitle(title: string, artist: string): string {
  const escaped = artist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const leading = new RegExp(`^\\s*${escaped}(\\s*[(\\[][^)\\]]*[)\\]])?\\s*[-–—|:]\\s*`, 'i');
  const cleaned = title.replace(leading, '').replace(VIDEO_TAGS, '').replace(/\s{2,}/g, ' ').replace(/^[\s\-–—|:]+|[\s\-–—|:]+$/g, '');
  return cleaned || title;
}

export const homeVideo = (item: CatalogItem, artist: string): HomeVideoCard => ({ item, title: cleanTitle(item.title, artist), subtitle: artist });
export const feedVideo = (item: CatalogItem): HomeVideoCard => {
  const first = item.artists?.[0]?.name;
  return { item, title: first ? cleanTitle(item.title, first) : item.title, subtitle: (item.artists ?? []).map((artist) => artist.name).join(', ') };
};

/** One from each list in turn, so a single artist cannot fill the whole row. */
export function interleave<T>(lists: ReadonlyArray<readonly T[]>, limit: number): T[] {
  const result: T[] = [];
  for (let round = 0; result.length < limit && lists.some((list) => round < list.length); round += 1) {
    for (const list of lists) if (round < list.length && result.length < limit) result.push(list[round]);
  }
  return result;
}
