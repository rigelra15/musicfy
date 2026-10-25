import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../app/AppContext';
import { focusProps } from '../app/format';
import { pageScroller } from '../app/remote';
import { useResource } from '../app/useResource';
import type { CatalogSection, GenericPage } from '../catalog/types';
import { Carousel } from '../components/Carousel';
import { Icon } from '../components/Icon';
import { applyFilters, dedupe, homeItemFromCatalog, type HomeItem } from '../features/home/model';
import { CardArt, useActivate } from '../features/home/ui/HomeCard';
import { contentFilters, usableSections } from '../features/detail/browse';
import { ResourceGate } from '../features/detail/ui';
import { loadCommunity, type CommunityCard } from '../features/search/community';
import { genreDescription } from '../features/search/genreDescriptions';
import { cardSubtitle } from '../features/search/labels';

/** One cover under a title and an owner, as the phone shows a mood page's playlists, albums, artists and songs. */
function GenreCard({ item, id, row, column, onActivate }: { item: HomeItem; id: string; row: number; column: number; onActivate(): void }) {
  const { t } = useApp();
  const subtitle = cardSubtitle(item, t);
  return (
    <button {...focusProps(id, row, column)} class={`genre-card kind-${item.kind}`} aria-label={subtitle ? `${item.title}, ${subtitle}` : item.title} onClick={onActivate}>
      <span class="genre-card-art" data-carousel-art><CardArt url={item.artworkUrl} round={item.kind === 'artist'} /></span>
      <span class="genre-card-title">{item.title}</span>
      <span class="genre-card-sub">{subtitle}</span>
    </button>
  );
}

/** A community playlist card: its first covers tilted across the top, the name and the song count over a dark fade. */
function CommunityTile({ card, id, row, column, onOpen }: { card: CommunityCard; id: string; row: number; column: number; onOpen(): void }) {
  return (
    <button {...focusProps(id, row, column)} class="community-card" aria-label={card.songCount ? `${card.title}, ${card.songCount}` : card.title} onClick={onOpen}>
      <span class="community-collage" data-carousel-art aria-hidden="true">
        <span class="community-grid">
          <span class="community-line">{card.covers.slice(0, 3).map((url, index) => <img key={`a${index}`} src={url} alt="" loading="lazy" decoding="async" />)}</span>
          <span class="community-line">{card.covers.slice(3, 5).map((url, index) => <img key={`b${index}`} src={url} alt="" loading="lazy" decoding="async" />)}</span>
        </span>
      </span>
      <span class="community-fade" aria-hidden="true" />
      <span class="community-copy"><span class="community-title">{card.title}</span>{card.songCount && <span class="community-count">{card.songCount}</span>}</span>
    </button>
  );
}

/** A mood or genre page (search tab), laid out like the phone's: a tinted header with the name and a blurb, then carousels. */
export function GenrePage({ browseId, params, title }: { browseId: string; params?: string; title: string }) {
  const { t, services, catalog, language, goBack } = useApp();
  const activate = useActivate();
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [community, setCommunity] = useState<CommunityCard[] | undefined>(undefined);
  const [collapsed, setCollapsed] = useState(false);
  const header = useRef<HTMLElement>(null);
  const [barHeight, setBarHeight] = useState(96);
  const resource = useResource<GenericPage>(`genre:${browseId}:${params ?? ''}`, (signal) => catalog.page(browseId, params, signal));
  const filters = contentFilters(services.prefs);

  const pageData = resource.status === 'ready' ? resource.data : undefined;
  useEffect(() => {
    if (!pageData) return;
    const controller = new AbortController();
    setCommunity(undefined);
    loadCommunity(catalog, pageData.sections, controller.signal).then(setCommunity, (error) => { if (!controller.signal.aborted && (error as { kind?: string })?.kind !== 'aborted') setCommunity([]); });
    return () => controller.abort();
  }, [pageData?.sections[0]?.id, browseId, params]);
  // The header runs up under the app's navigation bar, so it needs to know how tall that bar is.
  useEffect(() => {
    const measure = () => { const bar = document.querySelector<HTMLElement>('.app-topbar'); if (bar && bar.offsetHeight > 0) setBarHeight(bar.offsetHeight); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  useEffect(() => {
    const scrolling = pageScroller();
    const scrollTarget = scrolling instanceof HTMLElement ? scrolling : window;
    const onScroll = () => setCollapsed(scrolling.scrollTop > (header.current?.offsetHeight ?? 300) * 0.55);
    scrollTarget.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => scrollTarget.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <ResourceGate resource={resource} reload={resource.reload}>
      {(page) => {
        const sections = usableSections(page.sections);
        const shown = page.title || title;
        const art = sections.flatMap((section: CatalogSection) => section.items).find((item) => item.artworkUrl)?.artworkUrl;
        async function loadMore() {
          if (!page.continuation || loadingMore) return;
          setLoadingMore(true); setMoreFailed(false);
          try {
            const next = await catalog.more('browse', page.continuation);
            resource.set({ ...page, sections: [...page.sections, ...next.sections], continuation: next.continuation, skipped: page.skipped + next.skipped });
          } catch { setMoreFailed(true); }
          setLoadingMore(false);
        }
        let row = 1;
        return (
          <section class={`genre-view ${collapsed ? 'is-collapsed' : ''}`} aria-labelledby="genre-title" style={`--topbar-h:${barHeight}px`}>
            <div class="genre-topbar">
              <button {...focusProps('genre-back', row, 0)} data-focus-skip="true" class="genre-back icon-button" aria-label={t('search.back')} onClick={() => goBack()}><Icon name="arrow-left" /></button>
              <span class="genre-topbar-title" aria-hidden="true">{shown}</span>
            </div>
            <header class="genre-header" ref={header}>
              {art && <span class="genre-backdrop" style={`background-image:url("${art}")`} aria-hidden="true" />}
              <span class="genre-fade" aria-hidden="true" />
              <div class="genre-heading">
                <h1 id="genre-title">{shown}</h1>
                <p class="genre-description">{genreDescription(shown, language)}</p>
              </div>
            </header>
            {sections.length === 0 && <p class="message-state">{t('detail.genreEmpty')}</p>}
            {sections.map((section, index) => {
              const items = applyFilters(dedupe(section.items.map(homeItemFromCatalog)), filters);
              if (items.length === 0) return null;
              row += 1;
              const sectionRow = row;
              const label = section.title ?? t('search.featured');
              return (
                <div key={section.id}>
                  <section class="genre-section" aria-label={label}>
                    <h2>{label}</h2>
                    <Carousel label={label}>
                      {items.map((item, column) => <GenreCard key={item.key} item={item} id={`genre-card-${index}-${column}`} row={sectionRow} column={column} onActivate={() => activate({ items }, item)} />)}
                    </Carousel>
                  </section>
                  {index === 0 && (community === undefined || community.length > 0) && (() => {
                    row += 1;
                    const communityRow = row;
                    return (
                      <section class="genre-section" aria-label={t('search.community')}>
                        <h2>{t('search.community')}</h2>
                        {community === undefined
                          ? <p class="message-state" role="status">{t('common.loading')}</p>
                          : (
                            <Carousel label={t('search.community')} wide>
                              {community.map((card, column) => <CommunityTile key={card.id} card={card} id={`genre-community-${column}`} row={communityRow} column={column} onOpen={() => activate({ items: [] }, { key: card.id, kind: 'playlist', id: card.id, playlistId: card.id, title: card.title })} />)}
                            </Carousel>
                          )}
                      </section>
                    );
                  })()}
                </div>
              );
            })}
            {page.continuation && (
              <button {...focusProps('genre-more', row + 1, 0)} class="text-action" disabled={loadingMore} onClick={() => void loadMore()}>
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
