import { entityKey, trackKeyOf, type EntityRef } from '../../domain/entity';
import { useApp } from '../../app/AppContext';
import type { ActionItem } from '../../app/OverlayHost';
import type { Track } from '../../model';
import type { Route } from '../../app/router';

export const MAX_PINS = 9;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export interface EntityDetails { title: string; subtitle?: string; artworkUrl?: string }

/**
 * What a person can do with a song, album, artist or playlist from the Library and from lists
 * (the menu behind ⋮ or a long press of OK). Every action reports the result in a toast, and a
 * failed write says so instead of looking like it worked.
 */
export function useLibraryActions() {
  const { library, services, openOverlay, toast, t, enqueue, navigate } = useApp();
  const repo = services.repo;

  const attempt = async (work: () => Promise<unknown>, done: string) => {
    try { await work(); toast(done); } catch (error) { toast(t('toast.failed', { message: errorText(error) })); }
  };

  const pinnedKeys = () => new Set(library.getSnapshot().pins.map((pin) => pin.key));

  async function pinRef(ref: EntityRef, details?: EntityDetails) {
    if (pinnedKeys().has(entityKey(ref))) return;
    if (library.getSnapshot().pins.length >= MAX_PINS) { toast(t('toast.pinFull')); return; }
    // A pinned album, artist or online playlist needs something to show, so it is kept in the library too.
    if (details && ref.kind !== 'track' && ref.provider !== 'local') await repo.saveEntity({ ref, ...details });
    await attempt(() => repo.pin(ref), t('toast.pinned'));
  }
  const unpinRef = (ref: EntityRef) => attempt(() => repo.unpin(ref), t('toast.unpinned'));

  const trackRef = (track: Track): EntityRef => ({ provider: track.provider ?? 'youtube', kind: 'track', id: track.id });

  function songActions(track: Track, options: { extra?: ActionItem[]; without?: Array<'next' | 'queue' | 'playlist' | 'like' | 'library' | 'pin' | 'artist' | 'album'> } = {}): ActionItem[] {
    const snap = library.getSnapshot();
    const key = trackKeyOf(track);
    const liked = snap.likedKeys.has(key);
    const inLibrary = snap.libraryKeys.has(key);
    const pinned = pinnedKeys().has(entityKey(trackRef(track)));
    const skip = new Set(options.without ?? []);
    const artist = track.artists?.find((candidate) => candidate.id);
    const actions: Array<ActionItem | false> = [
      !skip.has('next') && { id: 'next', label: t('act.playNext'), onSelect: () => { enqueue([track], 'next'); toast(t('toast.playNext')); } },
      !skip.has('queue') && { id: 'queue', label: t('act.addQueue'), onSelect: () => { enqueue([track], 'end'); toast(t('toast.queued')); } },
      !skip.has('playlist') && { id: 'playlist', label: t('act.addPlaylist'), onSelect: () => openOverlay('addToPlaylist', { props: { tracks: [track] } }) },
      !skip.has('like') && { id: 'like', label: liked ? t('act.unlike') : t('act.like'), onSelect: () => void attempt(() => repo.setLiked(track, !liked), liked ? t('toast.unliked') : t('toast.liked')) },
      !skip.has('library') && (inLibrary
        ? { id: 'library', label: t('act.removeLibrary'), onSelect: () => void attempt(() => repo.removeFromLibrary(key), t('toast.removedLibrary')) }
        : { id: 'library', label: t('act.saveLibrary'), onSelect: () => void attempt(() => repo.addToLibrary(track), t('toast.savedLibrary')) }),
      !skip.has('pin') && (pinned
        ? { id: 'pin', label: t('act.unpin'), onSelect: () => void unpinRef(trackRef(track)) }
        : { id: 'pin', label: t('act.pin'), onSelect: () => void (async () => { await repo.upsertTracks([track]); await pinRef(trackRef(track)); })() }),
      !skip.has('artist') && artist !== undefined && { id: 'artist', label: t('act.openArtist'), onSelect: () => navigate({ name: 'artist', id: artist.id!, title: artist.name }) },
      !skip.has('album') && Boolean(track.albumId) && { id: 'album', label: t('act.openAlbum'), onSelect: () => navigate({ name: 'album', id: track.albumId! }) },
    ];
    return [...actions.filter((action): action is ActionItem => action !== false), ...(options.extra ?? [])];
  }

  /** Album, artist or online playlist: keep it in the library or not, pin it or not, open it. */
  function entityActions(ref: EntityRef, details: EntityDetails, options: { open?: Route; extra?: ActionItem[] } = {}): ActionItem[] {
    const snap = library.getSnapshot();
    const key = entityKey(ref);
    const saved = [...snap.albums, ...snap.artists, ...snap.onlinePlaylists].some((entity) => entity.key === key);
    const pinned = pinnedKeys().has(key);
    return [
      ...(options.open ? [{ id: 'open', label: t('common.open'), onSelect: () => navigate(options.open!) }] : []),
      saved
        ? { id: 'save', label: t('act.removeLibrary'), onSelect: () => void attempt(() => repo.unsaveEntity(ref), t('toast.removedLibrary')) }
        : { id: 'save', label: t('act.saveLibrary'), onSelect: () => void attempt(() => repo.saveEntity({ ref, ...details }), t('toast.savedLibrary')) },
      pinned
        ? { id: 'pin', label: t('act.unpin'), onSelect: () => void unpinRef(ref) }
        : { id: 'pin', label: t('act.pin'), onSelect: () => void pinRef(ref, details) },
      ...(options.extra ?? []),
    ];
  }

  function playlistActions(playlist: { id: string; name: string; covers?: string[] }, options: { open?: boolean; onDeleted?: () => void } = {}): ActionItem[] {
    const ref: EntityRef = { provider: 'local', kind: 'playlist', id: playlist.id };
    const pinned = pinnedKeys().has(entityKey(ref));
    return [
      ...(options.open ? [{ id: 'open', label: t('common.open'), onSelect: () => navigate({ name: 'playlist', id: playlist.id, origin: 'local' }) }] : []),
      { id: 'rename', label: t('act.rename'), onSelect: () => openOverlay('createPlaylist', { props: { mode: 'rename', playlistId: playlist.id, initialName: playlist.name } }) },
      pinned
        ? { id: 'pin', label: t('act.unpin'), onSelect: () => void unpinRef(ref) }
        : { id: 'pin', label: t('act.pin'), onSelect: () => void pinRef(ref) },
      {
        id: 'delete', label: t('act.deletePlaylist'),
        onSelect: () => openOverlay('confirm', { props: {
          title: t('pl.deleteTitle', { name: playlist.name }), body: t('pl.deleteBody'), confirmLabel: t('act.deletePlaylist'),
          onConfirm: () => {
            void (async () => {
              try {
                await repo.unpin(ref);
                await repo.deletePlaylist(playlist.id);
                toast(t('pl.deleted'));
                options.onDeleted?.();
              } catch (error) { toast(t('toast.failed', { message: errorText(error) })); }
            })();
          },
        } }),
      },
    ];
  }

  /** Open the actions overlay for a list item. */
  function showActions(title: string, actions: ActionItem[], openerFocusId?: string) {
    if (actions.length === 0) return;
    openOverlay('actions', { openerFocusId, props: { title, actions } });
  }

  return { songActions, entityActions, playlistActions, showActions, pinRef, unpinRef, trackRef };
}
