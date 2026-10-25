import type { StringKey } from '../../app/i18n';
import type { HomeItem } from '../home/model';
import { formatDuration } from '../../app/format';

export const BULLET = '  •  ';
type T = (key: StringKey) => string;

export const KIND_LABELS: Record<string, StringKey> = { track: 'search.kind.track', video: 'search.kind.video', album: 'search.kind.album', artist: 'search.kind.artist', playlist: 'search.kind.playlist' };

export const artistsOf = (item: HomeItem) => item.track?.artists?.map((artist) => artist.name).join(', ') || item.track?.artist || '';

/** The person or channel behind an album or playlist, read from the catalog's own subtitle ("Album • LANY • 2026"). */
export const ownerOf = (item: HomeItem) => (item.subtitle ?? '').split(' • ').slice(1).find((part) => part && !/\b(views?|plays?|monthly|subscribers?|songs?)\b/i.test(part)) ?? '';

/** A result row's second line, as on the phone: the artists and length for a song, the kind and owner for the rest. */
export function rowSubtitle(item: HomeItem, t: T): string {
  const duration = item.track && item.track.durationMs > 0 ? formatDuration(item.track.durationMs) : '';
  if (item.track) return [artistsOf(item), duration].filter(Boolean).join(BULLET);
  const kind = t(KIND_LABELS[item.kind] ?? 'search.kind.track');
  return item.kind === 'artist' ? kind : [kind, ownerOf(item)].filter(Boolean).join(BULLET);
}

/** A mood page card's second line: the artists of a song, the owner of an album or playlist, or just the kind. */
export function cardSubtitle(item: HomeItem, t: T): string {
  if (item.track) return artistsOf(item);
  if (item.kind === 'artist') return t('search.kind.artist');
  return ownerOf(item) || t(KIND_LABELS[item.kind] ?? 'search.kind.playlist');
}
