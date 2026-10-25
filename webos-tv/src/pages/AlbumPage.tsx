import { useMemo } from 'preact/hooks';
import { useApp } from '../app/AppContext';
import { useResource } from '../app/useResource';
import { applyFilters, dedupe, homeItemFromCatalog, homeItemFromTrack } from '../features/home/model';
import { useActivate } from '../features/home/ui/HomeCard';
import { contentFilters, usableSections } from '../features/detail/browse';
import { detailTracks, formatTotal, totalDurationMs } from '../features/detail/convert';
import { useSaved } from '../features/detail/useSaved';
import { ActionRow, CardRow, DetailHero, ResourceGate, TrackList } from '../features/detail/ui';
import { focusProps } from '../app/format';
import type { DetailPage } from '../catalog/types';

export function AlbumPage({ id }: { id: string }) {
  const { catalog } = useApp();
  const resource = useResource<DetailPage>(`album:${id}`, (signal) => catalog.album(id, signal));
  return <ResourceGate resource={resource} reload={resource.reload}>{(page) => <AlbumContent id={id} page={page} />}</ResourceGate>;
}

function AlbumContent({ id, page }: { id: string; page: DetailPage }) {
  const { t, services, playTracks, navigate, catalog, pageCache } = useApp();
  const activate = useActivate();
  const filters = contentFilters(services.prefs);
  const header = page.header;
  const title = header.title ?? t('detail.untitledAlbum');
  const saved = useSaved({ provider: 'youtube', kind: 'album', id }, { title, subtitle: header.artists?.map((a) => a.name).join(', '), artworkUrl: header.artworkUrl });

  const tracks = useMemo(
    () => applyFilters(dedupe(detailTracks(page.tracks, header, { id, name: title }).map(homeItemFromTrack)), filters).map((item) => item.track!),
    [page, id],
  );
  const total = formatTotal(totalDurationMs(tracks));
  const related = usableSections(page.related);
  const play = (index = 0, shuffle = false) => playTracks(tracks, index, 'album', shuffle ? { shuffle } : undefined);
  const meta = (
    <div class="detail-meta">
      {header.artists && header.artists.length > 0 && (
        <p class="detail-artists">
          {header.artists.map((artist, index) => artist.id ? (
            <button {...focusProps(`detail-artist-${index}`, 1, index)} class="text-link" key={`${artist.id}:${index}`} onClick={() => navigate({ name: 'artist', id: artist.id!, title: artist.name })}>{artist.name}</button>
          ) : <span key={`${artist.name}:${index}`}>{artist.name}</span>)}
        </p>
      )}
      <p class="detail-sub">{[header.subtitle, header.year, header.secondSubtitle ?? (tracks.length > 0 ? `${t('home.songsCount', { count: tracks.length })}${total ? ` · ${total}` : ''}` : undefined)].filter(Boolean).join(' · ')}</p>
    </div>
  );
  return (
    <section class="detail-view" aria-labelledby="detail-heading">
      <DetailHero title={title} artworkUrl={header.artworkUrl} meta={meta} description={header.description}>
        <ActionRow actions={[
          { id: 'play', label: t('common.play'), icon: 'play', onClick: () => play(), disabled: tracks.length === 0 },
          { id: 'shuffle', label: t('detail.shuffle'), icon: 'shuffle', onClick: () => play(0, true), disabled: tracks.length === 0 },
          { id: 'save', label: saved.saved ? t('detail.saved') : t('detail.save'), icon: saved.saved ? 'check' : 'plus', pressed: saved.saved, onClick: () => void saved.toggle() },
        ]} />
        {saved.failed && <p class="detail-note" role="alert">{t('detail.saveFailed')}</p>}
      </DetailHero>
      {tracks.length === 0
        ? <p class="message-state">{t('detail.noSongs')}</p>
        : <TrackList tracks={tracks} startRow={4} onPlay={(index) => play(index)} unavailable={page.skipped} />}
      {related.map((section, index) => (
        <CardRow
          key={section.id}
          id={`album-rel-${index}`}
          title={section.title ?? t('detail.related')}
          gridRow={5 + tracks.length + index}
          items={applyFilters(dedupe(section.items.map(homeItemFromCatalog)), filters)}
          onActivate={(item) => activate({ items: section.items.map(homeItemFromCatalog) }, item)}
          onSeeAll={section.more ? () => { pageCache.set(`section.row:album-${id}-${index}`, { id: `album-${id}-${index}`, kind: 'feed', title: section.title ?? '', origin: 'online', items: section.items.map(homeItemFromCatalog), more: section.more, detail: true }); navigate({ name: 'section', sectionId: `album-${id}-${index}`, title: section.title ?? t('detail.related') }); } : undefined}
        />
      ))}
    </section>
  );
}
