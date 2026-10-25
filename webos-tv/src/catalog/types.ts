// Shapes returned by `POST /api/catalog/{operation}` (service/innertube.cjs). Optional fields are
// genuinely optional upstream; the UI must not invent values for them.
export type CatalogKind = 'track' | 'video' | 'album' | 'artist' | 'playlist' | 'link';
export type SearchFilter = 'all' | 'songs' | 'videos' | 'albums' | 'artists' | 'playlists' | 'community';
export type CatalogErrorKind = 'bad-request' | 'not-found' | 'rate-limited' | 'forbidden' | 'upstream-http' | 'invalid-response' | 'timeout' | 'network' | 'aborted' | 'stale';

export interface CatalogArtistRef { id?: string; name: string }
export interface CatalogAlbumRef { id?: string; name: string }

export interface CatalogItem {
  kind: CatalogKind;
  id: string;
  browseId?: string;
  params?: string;
  title: string;
  subtitle?: string;
  artworkUrl?: string;
  artists?: CatalogArtistRef[];
  album?: CatalogAlbumRef;
  durationMs?: number;
  year?: string;
  playlistId?: string;
  isExplicit?: boolean;
  color?: string;
}

export interface ContinuationRef { token: string }

export interface CatalogSection {
  id: string;
  title?: string;
  strapline?: string;
  layout: 'carousel' | 'list' | 'grid' | 'text';
  contentKind: CatalogKind | 'mixed' | 'empty' | 'text';
  items: CatalogItem[];
  more?: { browseId: string; params?: string };
  text?: string;
  topResult?: boolean;
}

export interface HomeChip { title: string; browseId: string; params?: string }
export interface HomePage { chips: HomeChip[]; sections: CatalogSection[]; continuation?: ContinuationRef; skipped: number }
export interface SearchPage { filter: SearchFilter; sections: CatalogSection[]; items: CatalogItem[]; continuation?: ContinuationRef; skipped: number }
export interface SuggestionsPage { queries: string[]; items: CatalogItem[] }

export interface DetailHeader {
  title?: string; subtitle?: string; secondSubtitle?: string; description?: string; artists?: CatalogArtistRef[]; year?: string; artworkUrl?: string; playlistId?: string;
}
export interface DetailPage { type: 'album' | 'playlist'; header: DetailHeader; tracks: CatalogItem[]; related: CatalogSection[]; continuation?: ContinuationRef; skipped: number }
export interface ArtistPage {
  type: 'artist';
  header: { title?: string; description?: string; artworkUrl?: string; subscribers?: string; monthlyListeners?: string; playlistId?: string; radioPlaylistId?: string; radioVideoId?: string };
  songs: CatalogItem[]; songsMore?: { browseId: string; params?: string }; sections: CatalogSection[]; skipped: number;
}
export interface GenericPage { type: 'page'; title?: string; sections: CatalogSection[]; continuation?: ContinuationRef; skipped: number }
export type BrowsePage = DetailPage | ArtistPage | GenericPage;

export interface NextPage {
  items: CatalogItem[]; currentIndex?: number; continuation?: ContinuationRef;
  lyricsBrowseId?: string; relatedBrowseId?: string; title?: string;
  /** Present when the radio (automix) part was merged in. */
  radioPlaylistId?: string;
  /** True when the radio follow-up failed; the queue is only the first panel. */
  radioUnavailable?: boolean;
}
export interface RelatedPage { sections: CatalogSection[]; skipped: number }
/** Result of following any continuation token. */
export interface MorePage { items: CatalogItem[]; sections: CatalogSection[]; continuation?: ContinuationRef; skipped: number }

export interface CatalogLocale { hl?: string; gl?: string }
