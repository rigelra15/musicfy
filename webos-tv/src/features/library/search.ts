import type { SavedEntity } from '../../library/types';
import type { LibrarySnapshot, LibrarySong, PlaylistPreview } from './data';

/** Lowercase, accents and width folded: "Éclair" finds "eclair", "ＡＢＣ" finds "abc". */
export function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().trim();
}

export interface LibraryResults {
  songs: LibrarySong[];
  artists: SavedEntity[];
  albums: SavedEntity[];
  playlists: PlaylistPreview[];
}

const has = (needle: string, ...fields: Array<string | undefined>) => fields.some((field) => field !== undefined && fold(field).includes(needle));

/** What the Library search box finds: songs by title, artist or album; artists, albums and playlists by name. */
export function searchLibrary(query: string, snapshot: Pick<LibrarySnapshot, 'songs' | 'artists' | 'albums' | 'playlists'>): LibraryResults {
  const needle = fold(query);
  if (!needle) return { songs: [], artists: [], albums: [], playlists: [] };
  return {
    songs: snapshot.songs.filter((song) => has(needle, song.track.title, song.track.artist, song.track.album)),
    artists: snapshot.artists.filter((artist) => has(needle, artist.title)),
    albums: snapshot.albums.filter((album) => has(needle, album.title, album.subtitle)),
    playlists: snapshot.playlists.filter((playlist) => has(needle, playlist.name)),
  };
}

export const resultCount = (results: LibraryResults) => results.songs.length + results.artists.length + results.albums.length + results.playlists.length;
