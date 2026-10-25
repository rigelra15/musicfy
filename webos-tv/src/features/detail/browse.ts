import type { BrowsePage, CatalogItem, CatalogSection, ContinuationRef } from '../../catalog/types';
import type { ContentFilters } from '../home/model';
import { NO_FILTERS } from '../home/model';
import { PREF_HIDE_EXPLICIT, PREF_HIDE_VIDEO_SONGS } from '../home/feed';
import type { PreferencesStore } from '../../library/preferences';

/** Flat items of whatever a browse call returned (album/playlist tracks, or every shelf item of a page). */
export function browseItems(page: BrowsePage): { items: CatalogItem[]; continuation?: ContinuationRef } {
  if (page.type === 'page') return { items: page.sections.flatMap((section) => section.items), continuation: page.continuation };
  if (page.type === 'artist') return { items: [...page.songs, ...page.sections.flatMap((section) => section.items)] };
  return { items: page.tracks, continuation: page.continuation };
}

export const isPlayable = (item: CatalogItem) => item.kind === 'track' || item.kind === 'video';

export function contentFilters(prefs: Pick<PreferencesStore, 'get'> | undefined): ContentFilters {
  if (!prefs) return NO_FILTERS;
  return { hideExplicit: prefs.get(PREF_HIDE_EXPLICIT, false), hideVideoSongs: prefs.get(PREF_HIDE_VIDEO_SONGS, false) };
}

/** Sections worth showing as rows: titled, with items. */
export const usableSections = (sections: readonly CatalogSection[]) => sections.filter((section) => section.items.length > 0 && section.layout !== 'text');
