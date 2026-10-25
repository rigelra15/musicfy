import type { CatalogGateway } from '../catalog/gateway';
import { trackFromCatalog } from '../features/home/model';
import type { PreferencesStore } from '../library/preferences';
import type { Track } from '../model';
import { PREF_HIDE_EXPLICIT, PREF_HIDE_VIDEO_SONGS } from '../features/home/feed';

/** Whether the queue refills itself when it runs out (Android's "Auto-play"); on unless switched off. */
export const PREF_AUTOPLAY = 'playback.autoplay';

/**
 * The songs that follow `song` (YouTube Music's radio for it), minus the song itself and whatever the
 * content filters hide. Playable tracks and videos only; albums or playlists in the panel are ignored.
 */
export async function radioFor(gateway: CatalogGateway, prefs: PreferencesStore, song: Track, signal?: AbortSignal): Promise<Track[]> {
  const next = await gateway.next({ videoId: song.id }, signal);
  const hideExplicit = prefs.get(PREF_HIDE_EXPLICIT, false);
  const hideVideos = prefs.get(PREF_HIDE_VIDEO_SONGS, false);
  return next.items
    .filter((item) => item.id !== song.id && (item.kind === 'track' || item.kind === 'video'))
    .map(trackFromCatalog)
    .filter((candidate) => !(hideExplicit && candidate.explicit) && !(hideVideos && candidate.isVideo));
}
