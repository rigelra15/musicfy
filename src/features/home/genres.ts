// Ported from Android's ListeningGenres/GenreFamily: YouTube Music's genre tiles come in the
// user's language, so they are recognised by stems that read the same in most languages.
const FAMILIES: ReadonlyArray<readonly string[]> = [
  ['k-pop', 'kpop'], ['j-pop', 'jpop'], ['mandopop', 'cantopop'], ['hip-hop', 'hip hop', 'hiphop', 'rap'], ['r&b', 'soul'],
  ['dance', 'electr', 'elektr', 'dansa', 'électr', 'eletr'], ['metal'], ['latin'], ['indie', 'altern'], ['rock'], ['jazz'],
  ['classical', 'klasik', 'clásic', 'classiq', 'klassik', 'clássic', 'classic'], ['country'], ['reggae'], ['blues'],
  ['folk', 'akustik', 'acoustic', 'acústic'], ['christian', 'gospel', 'kristen', 'rohani', 'cristian', 'chrétien'],
  ['soundtrack', 'musical'], ['afric', 'afrika', 'afro'], ['arab'], ['india'], ['brazil', 'brasil'], ['dangdut'], ['pop'],
];

/** False for the grid's odd ones out, like "Decades" or "Family". */
export function isGenre(title: string): boolean {
  const lower = title.toLowerCase();
  return FAMILIES.some((stems) => stems.some((stem) => lower.includes(stem)));
}

/** How many titles read as genres, to tell the genre grid from the moods grid. */
export function genreScore(titles: readonly string[]): number {
  return titles.filter(isGenre).length;
}
