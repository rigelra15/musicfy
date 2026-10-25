import type { CatalogGateway } from '../../catalog/gateway';
import type { CatalogSection } from '../../catalog/types';

/** A community playlist as the phone shows it on a mood page: its name, its song count and the covers of its first songs. */
export interface CommunityCard { id: string; title: string; songCount?: string; covers: string[] }

const MAX_PLAYLISTS = 3;
const MAX_COVERS = 6;

/**
 * "From the community": the first three playlists found on the mood page, each opened to read its first songs (the
 * phone does the same). A playlist that cannot be opened is left out; nothing here fails the page.
 */
export async function loadCommunity(gateway: Pick<CatalogGateway, 'playlist'>, sections: readonly CatalogSection[], signal?: AbortSignal): Promise<CommunityCard[]> {
  const seen = new Set<string>();
  const candidates = sections.flatMap((section) => section.items).filter((item) => item.kind === 'playlist').filter((item) => {
    const id = item.playlistId ?? item.id;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, MAX_PLAYLISTS);
  const opened = await Promise.all(candidates.map(async (item): Promise<CommunityCard | undefined> => {
    const id = item.playlistId ?? item.id;
    try {
      const page = await gateway.playlist(id, signal);
      const covers = page.tracks.map((track) => track.artworkUrl).filter((url): url is string => !!url).slice(0, MAX_COVERS);
      if (covers.length === 0) return undefined;
      const count = (page.header.secondSubtitle ?? '').split(' • ')[0].trim();
      return { id, title: page.header.title || item.title, ...(count ? { songCount: count } : {}), covers };
    } catch (error) {
      if ((error as { kind?: string })?.kind === 'aborted') throw error;
      return undefined;
    }
  }));
  return opened.filter((card): card is CommunityCard => !!card);
}
