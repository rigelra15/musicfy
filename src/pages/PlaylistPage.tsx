import { useEffect, useMemo, useState } from 'preact/hooks';
import { useApp } from '../app/AppContext';
import { focusProps } from '../app/format';
import { useResource } from '../app/useResource';
import type { DetailPage } from '../catalog/types';
import { applyFilters, dedupe, homeItemFromCatalog, homeItemFromTrack } from '../features/home/model';
import { useActivate } from '../features/home/ui/HomeCard';
import { contentFilters, usableSections } from '../features/detail/browse';
import { detailTracks, formatTotal, totalDurationMs } from '../features/detail/convert';
import { useSaved } from '../features/detail/useSaved';
import { useLibraryActions } from '../features/library/actions';
import { sortItems } from '../features/library/sort';
import { useSort } from '../features/library/useSort';
import { useSnapshot } from '../app/useSnapshot';
import { ActionRow, CardRow, DetailHero, ResourceGate, TrackList } from '../features/detail/ui';
import { providerLabel } from '../importers/overlays';
import type { PlaylistEntry, PlaylistRecord } from '../library/types';
import type { Track } from '../model';

export function PlaylistPage({ id, origin }: { id: string; origin: 'online' | 'local' | 'auto' }) {
  if (origin === 'local') return <LocalPlaylist id={id} />;
  if (origin === 'auto') return <AutoPlaylist />;
  return <OnlinePlaylist id={id} />;
}

function OnlinePlaylist({ id }: { id: string }) {
  const { catalog } = useApp();
  const resource = useResource<DetailPage>(`playlist:${id}`, (signal) => catalog.playlist(id, signal));
  return <ResourceGate resource={resource} reload={resource.reload}>{(page) => <OnlineContent id={id} page={page} update={resource.set} />}</ResourceGate>;
}

function OnlineContent({ id, page, update }: { id: string; page: DetailPage; update(page: DetailPage): void }) {
  const { t, services, catalog, playTracks, navigate, pageCache } = useApp();
  const activate = useActivate();
  const filters = contentFilters(services.prefs);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const header = page.header;
  const title = header.title ?? t('detail.untitledPlaylist');
  const bareId = id.replace(/^VL/, '');
  const saved = useSaved({ provider: 'youtube', kind: 'playlist', id: bareId }, { title, subtitle: header.subtitle, artworkUrl: header.artworkUrl });
  const tracks = useMemo(
    () => applyFilters(dedupe(detailTracks(page.tracks, header).map(homeItemFromTrack)), filters).map((item) => item.track!),
    [page],
  );
  const total = formatTotal(totalDurationMs(tracks));
  const related = usableSections(page.related);
  const play = (index = 0, shuffle = false) => playTracks(tracks, index, 'playlist', shuffle ? { shuffle } : undefined);

  async function loadMore() {
    if (!page.continuation || loadingMore) return;
    setLoadingMore(true); setMoreFailed(false);
    try {
      const next = await catalog.more('browse', page.continuation);
      update({ ...page, tracks: [...page.tracks, ...next.items], continuation: next.continuation, skipped: page.skipped + next.skipped });
    } catch { setMoreFailed(true); }
    setLoadingMore(false);
  }

  return (
    <section class="detail-view" aria-labelledby="detail-heading">
      <DetailHero
        title={title}
        artworkUrl={header.artworkUrl}
        description={header.description}
        meta={<div class="detail-meta"><p class="detail-sub">{[header.subtitle, header.year, header.secondSubtitle ?? (tracks.length > 0 ? `${t('home.songsCount', { count: tracks.length })}${total ? ` · ${total}` : ''}` : undefined)].filter(Boolean).join(' · ')}</p></div>}
      >
        <ActionRow actions={[
          { id: 'play', label: t('common.play'), icon: 'play', onClick: () => play(), disabled: tracks.length === 0 },
          { id: 'shuffle', label: t('detail.shuffle'), icon: 'shuffle', onClick: () => play(0, true), disabled: tracks.length === 0 },
          { id: 'save', label: saved.saved ? t('detail.saved') : t('detail.save'), icon: saved.saved ? 'check' : 'plus', pressed: saved.saved, onClick: () => void saved.toggle() },
        ]} />
        {saved.failed && <p class="detail-note" role="alert">{t('detail.saveFailed')}</p>}
      </DetailHero>
      {tracks.length === 0 && !page.continuation
        ? <p class="message-state">{t('detail.noSongs')}</p>
        : <TrackList tracks={tracks} startRow={4} onPlay={(index) => play(index)} unavailable={page.skipped} />}
      {page.continuation && (
        <button {...focusProps('detail-more', 4 + tracks.length, 0)} class="text-action" disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? t('common.loading') : t('home.loadMore')}
        </button>
      )}
      {moreFailed && <p class="detail-note" role="alert">{t('detail.failed')}</p>}
      {related.map((section, index) => (
        <CardRow
          key={section.id}
          id={`playlist-rel-${index}`}
          title={section.title ?? t('detail.related')}
          gridRow={5 + tracks.length + index}
          items={applyFilters(dedupe(section.items.map(homeItemFromCatalog)), filters)}
          onActivate={(item) => activate({ items: section.items.map(homeItemFromCatalog) }, item)}
          onSeeAll={section.more ? () => { pageCache.set(`section.row:playlist-${id}-${index}`, { id: `playlist-${id}-${index}`, kind: 'feed', title: section.title ?? '', origin: 'online', items: section.items.map(homeItemFromCatalog), more: section.more, detail: true }); navigate({ name: 'section', sectionId: `playlist-${id}-${index}`, title: section.title ?? t('detail.related') }); } : undefined}
        />
      ))}
    </section>
  );
}

/** A playlist stored on this TV: play it, rename or delete it, and edit its songs (remove, reorder). */
function LocalPlaylist({ id }: { id: string }) {
  const { t, services, playTracks, goBack, toast, library, openOverlay } = useApp();
  const actions = useLibraryActions();
  const snapshot = useSnapshot(library);
  const { sort, buttons: sortButtons } = useSort('playlistSongs');
  const [state, setState] = useState<{ status: 'loading' } | { status: 'missing' } | { status: 'ready'; playlist: PlaylistRecord; entries: PlaylistEntry[] }>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    let first = true;
    const load = () => services.repo.getPlaylist(id).then(
      (found) => { if (live) setState(found ? { status: 'ready', ...found } : { status: 'missing' }); },
      () => { if (live && first) setState({ status: 'missing' }); },
    ).finally(() => { first = false; });
    setState({ status: 'loading' });
    void load();
    // Renaming, removing and reordering (here or from another page) refresh what is shown.
    const stop = services.repo.subscribe(() => void load());
    return () => { live = false; stop(); };
  }, [id]);

  if (state.status === 'loading') return <section class="detail-view"><p class="message-state" role="status">{t('common.loading')}</p></section>;
  if (state.status === 'missing') {
    return (
      <section class="detail-view">
        <div class="home-empty" role="alert">
          <p class="message-state">{t('detail.notFound')}</p>
          <button {...focusProps('detail-back', 1, 0)} class="text-action" onClick={goBack}>{t('common.back')}</button>
        </div>
      </section>
    );
  }
  const { playlist, entries } = state;
  const shown = sortItems(entries.filter((entry) => entry.track), sort, {
    name: (entry) => entry.track!.title,
    artist: (entry) => entry.track!.artist,
    date: (entry) => entry.addedAt,
    playTime: (entry) => snapshot.playTime.get(entry.trackKey) ?? 0,
  });
  const tracks = shown.map((entry) => entry.track!);
  const missing = entries.length - tracks.length;
  const source = playlist.source;
  const sourceName = source ? providerLabel(source.provider, t) : undefined;
  const play = (index = 0, shuffle = false) => playTracks(tracks, index, 'playlist', shuffle ? { shuffle } : undefined);
  const total = formatTotal(totalDurationMs(tracks));

  const edit = async (work: () => Promise<unknown>, done: string) => {
    try { await work(); toast(done); } catch (error) { toast(t('toast.failed', { message: error instanceof Error ? error.message : String(error) })); }
  };
  const move = (entry: PlaylistEntry, to: number) => void edit(() => services.repo.moveEntry(entry.entryId, to), t('pl.moved'));
  const entryMenu = (_track: Track, index: number) => {
    const entry = shown[index];
    const position = entries.findIndex((candidate) => candidate.entryId === entry.entryId);
    return actions.songActions(entry.track!, {
      extra: [
        { id: 'remove', label: t('act.removeFromPlaylist'), onSelect: () => void edit(() => services.repo.removeEntry(entry.entryId), t('pl.removedEntry')) },
        ...(sort.key !== 'custom' ? [] : position > 0 ? [
          { id: 'up', label: t('act.moveUp'), onSelect: () => move(entry, position - 1) },
          { id: 'top', label: t('act.moveTop'), onSelect: () => move(entry, 0) },
        ] : []),
        ...(sort.key !== 'custom' ? [] : position < entries.length - 1 ? [
          { id: 'down', label: t('act.moveDown'), onSelect: () => move(entry, position + 1) },
          { id: 'bottom', label: t('act.moveBottom'), onSelect: () => move(entry, entries.length - 1) },
        ] : []),
      ],
    });
  };
  const manage = () => actions.showActions(playlist.name, actions.playlistActions(playlist, { onDeleted: goBack }), 'detail-manage');
  return (
    <section class="detail-view" aria-labelledby="detail-heading">
      <DetailHero
        title={playlist.name}
        artworkUrl={tracks[0]?.artworkUrl}
        meta={
          <div class="detail-meta">
            <p class="detail-sub">{[t('detail.localPlaylist'), t('home.songsCount', { count: tracks.length }), total].filter(Boolean).join(' · ')}</p>
            {source && <p class="detail-sub">{t('detail.importedFrom', { source: sourceName ?? '' })}</p>}
            {source?.reportedTrackCount !== undefined && source.reportedTrackCount > tracks.length && (
              <p class="detail-note">{t('detail.importedPartial', { count: tracks.length, total: source.reportedTrackCount })}</p>
            )}
            {tracks.length > 0 && <p class="detail-note">{sort.key === 'custom' ? t('pl.editHint') : t('sort.customHint')}</p>}
          </div>
        }
      >
        <ActionRow actions={[
          { id: 'play', label: t('common.play'), icon: 'play', onClick: () => play(), disabled: tracks.length === 0 },
          { id: 'shuffle', label: t('detail.shuffle'), icon: 'shuffle', onClick: () => play(0, true), disabled: tracks.length === 0 },
          ...sortButtons,
          ...(source?.url ? [{ id: 'refresh', label: t('pl.refreshFromLink'), icon: 'refresh-cw' as const, onClick: () => openOverlay('linkImport', { openerFocusId: 'detail-refresh', props: { refreshPlaylistId: playlist.id } }) }] : []),
          { id: 'manage', label: t('pl.manage'), icon: 'ellipsis-vertical', onClick: manage },
        ]} />
      </DetailHero>
      {tracks.length === 0
        ? <p class="message-state">{t('detail.emptyPlaylist')}</p>
        : <TrackList tracks={tracks} startRow={4} onPlay={(index) => play(index)} menu={entryMenu} />}
      {missing > 0 && (
        <>
          <p class="detail-note" role="status">{t('detail.missingTracks', { count: missing })}</p>
          <button {...focusProps('detail-clear-missing', 4 + tracks.length, 0)} class="text-action"
            onClick={() => void edit(async () => { for (const entry of entries) if (!entry.track) await services.repo.removeEntry(entry.entryId); }, t('pl.removedEntry'))}>
            {t('pl.removeMissing')}
          </button>
        </>
      )}
    </section>
  );
}

function AutoPlaylist() {
  const { t, goBack } = useApp();
  return (
    <section class="detail-view">
      <div class="home-empty">
        <p class="message-state">{t('detail.playlistLater')}</p>
        <button {...focusProps('detail-back', 1, 0)} class="text-action" onClick={goBack}>{t('common.back')}</button>
      </div>
    </section>
  );
}
