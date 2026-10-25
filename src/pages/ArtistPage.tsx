import { useMemo, useState } from 'preact/hooks';
import { useApp } from '../app/AppContext';
import { focusProps } from '../app/format';
import { useResource } from '../app/useResource';
import type { ArtistPage as ArtistData, CatalogItem } from '../catalog/types';
import { applyFilters, dedupe, homeItemFromCatalog } from '../features/home/model';
import { useActivate } from '../features/home/ui/HomeCard';
import { browseItems, contentFilters, isPlayable, usableSections } from '../features/detail/browse';
import { useSaved } from '../features/detail/useSaved';
import { ActionRow, CardArtGrid, CardRow, DetailHero, ResourceGate, TrackList } from '../features/detail/ui';
import type { BrowsePage } from '../catalog/types';
import type { Track } from '../model';

export function ArtistPage({ id, title }: { id: string; title?: string }) {
  const { catalog } = useApp();
  const resource = useResource<ArtistData>(`artist:${id}`, (signal) => catalog.artist(id, signal));
  return <ResourceGate resource={resource} reload={resource.reload}>{(page) => <ArtistContent id={id} page={page} fallbackTitle={title} />}</ResourceGate>;
}

function ArtistContent({ id, page, fallbackTitle }: { id: string; page: ArtistData; fallbackTitle?: string }) {
  const { t, services, catalog, playTracks, navigate } = useApp();
  const activate = useActivate();
  const filters = contentFilters(services.prefs);
  const [radioState, setRadioState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const header = page.header;
  const name = header.title ?? fallbackTitle ?? t('detail.untitledArtist');
  const saved = useSaved({ provider: 'youtube', kind: 'artist', id }, { title: name, subtitle: header.subscribers, artworkUrl: header.artworkUrl });

  const songs = useMemo<Track[]>(
    () => applyFilters(dedupe(page.songs.filter(isPlayable).map(homeItemFromCatalog)), filters).map((item) => item.track!),
    [page],
  );
  const sections = usableSections(page.sections);
  const radioAvailable = Boolean(header.radioPlaylistId || header.radioVideoId);

  async function startRadio() {
    if (radioState === 'loading') return;
    setRadioState('loading');
    try {
      const next = await catalog.next({ playlistId: header.radioPlaylistId, videoId: header.radioVideoId });
      const radio = applyFilters(dedupe(next.items.filter(isPlayable).map(homeItemFromCatalog)), filters).map((item) => item.track!);
      if (radio.length === 0) { setRadioState('failed'); return; }
      playTracks(radio, 0, 'radio');
      setRadioState('idle');
    } catch { setRadioState('failed'); }
  }
  const playTop = (index = 0, shuffle = false) => (songs.length > 0 ? playTracks(songs, index, 'manual', shuffle ? { shuffle } : undefined) : void startRadio());
  const seeAll = (sectionTitle: string, more: { browseId: string; params?: string }) =>
    navigate({ name: 'artist', id, tab: 'items', browseId: more.browseId, params: more.params, title: `${name} · ${sectionTitle}` });

  let row = 4;
  const songsRow = row; row += songs.length + (page.songsMore ? 1 : 0);
  return (
    <section class="detail-view" aria-labelledby="detail-heading">
      <DetailHero
        title={name}
        artworkUrl={header.artworkUrl}
        round
        description={header.description}
        meta={(header.subscribers || header.monthlyListeners) ? <div class="detail-meta"><p class="detail-sub">{[header.monthlyListeners, header.subscribers].filter(Boolean).join(' · ')}</p></div> : undefined}
      >
        <ActionRow actions={[
          { id: 'play', label: t('common.play'), icon: 'play', onClick: () => playTop(), disabled: songs.length === 0 && !radioAvailable },
          { id: 'shuffle', label: t('detail.shuffle'), icon: 'shuffle', onClick: () => playTop(0, true), disabled: songs.length === 0 },
          { id: 'radio', label: radioState === 'loading' ? t('common.loading') : t('detail.radio'), icon: 'radio', onClick: () => void startRadio(), disabled: !radioAvailable || radioState === 'loading' },
          { id: 'save', label: saved.saved ? t('detail.following') : t('detail.follow'), icon: saved.saved ? 'check' : 'plus', pressed: saved.saved, onClick: () => void saved.toggle() },
        ]} />
        {radioState === 'failed' && <p class="detail-note" role="alert">{t('detail.radioFailed')}</p>}
        {saved.failed && <p class="detail-note" role="alert">{t('detail.saveFailed')}</p>}
      </DetailHero>

      {songs.length > 0 && (
        <section class="detail-section" aria-label={t('detail.topSongs')}>
          <h2>{t('detail.topSongs')}</h2>
          <TrackList tracks={songs} startRow={songsRow} idPrefix="artist-song" numbered={false} onPlay={(index) => playTop(index)} unavailable={page.skipped} />
          {page.songsMore && (
            <button {...focusProps('artist-songs-all', songsRow + songs.length, 0)} class="text-link"
              onClick={() => navigate({ name: 'artist', id, tab: 'songs', browseId: page.songsMore!.browseId, params: page.songsMore!.params, title: `${name} · ${t('detail.topSongs')}` })}>
              {t('home.seeAll')}
            </button>
          )}
        </section>
      )}

      {songs.length === 0 && sections.length === 0 && !radioAvailable && <p class="message-state">{t('detail.noSongs')}</p>}

      {sections.map((section, index) => {
        const gridRow = row + index;
        const items = applyFilters(dedupe(section.items.map(homeItemFromCatalog)), filters);
        return (
          <CardRow
            key={section.id}
            id={`artist-sec-${index}`}
            title={section.title ?? t('detail.related')}
            gridRow={gridRow}
            items={items}
            onActivate={(item) => activate({ items: section.items.map(homeItemFromCatalog) }, item)}
            onSeeAll={section.more ? () => seeAll(section.title ?? t('detail.related'), section.more!) : undefined}
          />
        );
      })}
    </section>
  );
}

/** "Lihat semua" of an artist shelf or of the top songs: the full list from YouTube Music. */
export function BrowseListPage({ browseId, params, title }: { browseId: string; params?: string; title: string }) {
  const { t, services, catalog, playTracks } = useApp();
  const activate = useActivate();
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const resource = useResource<{ items: CatalogItem[]; continuation?: { token: string }; skipped: number }>(
    `browse:${browseId}:${params ?? ''}`,
    async (signal) => {
      const page: BrowsePage = await catalog.browse(browseId, params, signal);
      const { items, continuation } = browseItems(page);
      return { items, continuation, skipped: page.skipped };
    },
  );
  const filters = contentFilters(services.prefs);

  return (
    <ResourceGate resource={resource} reload={resource.reload}>
      {(data) => {
        const items = applyFilters(dedupe(data.items.map(homeItemFromCatalog)), filters);
        const allPlayable = items.length > 0 && items.every((item) => item.track);
        const tracks = items.map((item) => item.track!).filter(Boolean);
        async function loadMore() {
          if (!data.continuation || loadingMore) return;
          setLoadingMore(true); setMoreFailed(false);
          try {
            const next = await catalog.more('browse', data.continuation);
            resource.set({ items: [...data.items, ...next.items, ...next.sections.flatMap((section) => section.items)], continuation: next.continuation, skipped: data.skipped + next.skipped });
          } catch { setMoreFailed(true); }
          setLoadingMore(false);
        }
        return (
          <section class="detail-view" aria-labelledby="detail-heading">
            <h1 id="detail-heading">{title}</h1>
            {items.length === 0 && <p class="message-state">{t('section.empty')}</p>}
            {allPlayable
              ? <TrackList tracks={tracks} startRow={1} idPrefix="browse-t" numbered={false} onPlay={(index) => playTracks(tracks, index, 'manual')} unavailable={data.skipped} />
              : <CardArtGrid items={items} startRow={1} idPrefix="browse" onActivate={(item) => activate({ items }, item)} />}
            {data.continuation && (
              <button {...focusProps('browse-more', 2 + (allPlayable ? items.length : Math.ceil(items.length / 6)), 0)} class="text-action" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? t('common.loading') : t('home.loadMore')}
              </button>
            )}
            {moreFailed && <p class="detail-note" role="alert">{t('detail.failed')}</p>}
          </section>
        );
      }}
    </ResourceGate>
  );
}
