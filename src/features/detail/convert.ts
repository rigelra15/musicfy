import { tr } from '../../app/i18n';
import type { CatalogItem, DetailHeader } from '../../catalog/types';
import type { Track } from '../../model';
import { trackFromCatalog } from '../home/model';

/** Tracks of an album or playlist page: whatever the row lacks is filled in from the page header. */
export function detailTracks(items: readonly CatalogItem[], header: DetailHeader, album?: { id?: string; name: string }): Track[] {
  return items
    .filter((item) => item.kind === 'track' || item.kind === 'video')
    .map((item) => {
      const track = trackFromCatalog(item);
      return {
        ...track,
        artist: track.artist || (header.artists ?? []).map((artist) => artist.name).join(', '),
        artists: track.artists && track.artists.length > 0 ? track.artists : header.artists?.map((artist) => ({ id: artist.id, name: artist.name })),
        album: track.album ?? album?.name,
        albumId: track.albumId ?? album?.id,
        artworkUrl: track.artworkUrl ?? header.artworkUrl,
      };
    });
}

export function totalDurationMs(tracks: readonly Track[]): number {
  return tracks.reduce((sum, track) => sum + (track.durationMs > 0 ? track.durationMs : 0), 0);
}

/** "1 j 12 mnt" / "42 mnt"; empty when no track has a duration. */
export function formatTotal(ms: number): string {
  if (ms <= 0) return '';
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? tr('time.hm', { h: hours, m: minutes % 60 }) : tr('time.m', { m: Math.max(1, minutes) });
}
