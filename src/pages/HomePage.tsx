import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../app/AppContext';
import { focusProps } from '../app/format';
import type { StringKey } from '../app/i18n';
import { CardArt, HomeCard, useActivate } from '../features/home/ui/HomeCard';
import { useHomeSnapshot } from '../features/home/ui/useHome';
import type { HeroCard } from '../features/home/feed';
import type { HomeRow } from '../features/home/model';

const FIRST_ROWS = 4;
const FIXED_TITLES: Partial<Record<HomeRow['kind'], StringKey>> = {
  recent: 'home.recent', quick: 'home.quick', mostPlayed: 'home.mostPlayed', history: 'home.history', forgotten: 'home.forgotten',
  keepListening: 'home.keepListening', localPlaylists: 'home.localPlaylists', artists: 'home.artists', community: 'home.community',
  newReleases: 'home.newReleases', live: 'home.live', videos: 'home.videos', newFromArtists: 'home.newFromArtists',
};

export function useRowTitle() {
  const { t } = useApp();
  return (row: HomeRow): string => {
    if (row.kind === 'because') return t('home.because', { title: row.title });
    if (row.kind === 'moreLike') return t('home.moreLike', { title: row.title });
    if (row.kind === 'newGenre') return t('home.newGenre', { title: row.title });
    if (row.kind === 'charts') return row.title || t('home.charts');
    const key = FIXED_TITLES[row.kind];
    return key ? t(key) : row.title;
  };
}

function heroLabel(card: HeroCard, t: ReturnType<typeof useApp>['t']): { label: string; detail?: string } {
  if (card.kind === 'continue') return { label: t('home.continue') };
  if (card.kind === 'discover') return { label: t('home.discover'), detail: card.reason ? t('home.discoverBecause', { title: card.reason }) : undefined };
  return { label: t('home.starter'), detail: card.reason ? t('home.starterBy', { artist: card.reason }) : undefined };
}

export function HomePage() {
  const { t, homeFeed, services, goTab, navigate, playTracks } = useApp();
  const snap = useHomeSnapshot(homeFeed);
  const activate = useActivate();
  const rowTitle = useRowTitle();
  const [visibleRows, setVisibleRows] = useState(FIRST_ROWS);
  // As on the phone, more arrives by itself when the end of the list comes near: shelves already fetched first, then the next page.
  const sentinel = useRef<HTMLDivElement>(null);
  const askedAt = useRef(-1);
  const hasMoreShelves = snap.rows.length > visibleRows;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const watcher = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      if (hasMoreShelves) { setVisibleRows((value) => value + 4); return; }
      // One request per page of results: a failed page is not hammered again until the rows change.
      if (snap.canLoadMore && !snap.loadingMore && askedAt.current !== snap.rows.length) { askedAt.current = snap.rows.length; void homeFeed.loadMore(); }
    }, { root: node.closest('.app-stage'), rootMargin: '0px 0px 400px 0px' });
    watcher.observe(node);
    return () => watcher.disconnect();
  }, [hasMoreShelves, snap.canLoadMore, snap.loadingMore, snap.rows.length, visibleRows, homeFeed]);

  // Coming back to Home applies the refresh policy; the very first load is the feed's own.
  useEffect(() => { if (homeFeed.hasLoaded) void homeFeed.refreshIfNeeded(); }, [homeFeed]);

  const rows = snap.rows;
  const shownRows = rows.slice(0, visibleRows);
  const networkNote = snap.online === 'failed'
    ? (snap.errorKind === 'rate-limited' ? t('home.rateLimited') : t('home.offline'))
    : snap.online === 'partial' ? t('home.partial') : undefined;
  const noContent = snap.localReady && rows.length === 0 && snap.hero.length === 0 && snap.online !== 'loading' && snap.online !== 'idle';
  // Fixed grid rows keep D-pad order stable while parts load: hero 1, chips 2, note 3, empty 4, card rows from 5.
  const heroOffset = 1;
  const chipRow = 2;
  const rowBase = 5;

  return (
    <section class="home-view" aria-labelledby="home-heading" onFocusCapture={(event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>('[data-home-row]');
      if (row && Number(row.dataset.homeRow) >= visibleRows - 2) setVisibleRows((value) => Math.min(rows.length, value + 3));
    }}>
      <h1 id="home-heading" class="visually-hidden">{t('home.title')}</h1>

      {snap.hero.length > 0 && (
        <div class="home-hero" role="list" aria-label={t('home.continue')}>
          {snap.hero.map((card, index) => {
            const { label, detail } = heroLabel(card, t);
            return (
              <button
                {...focusProps(`home-hero-${index}`, heroOffset, index)}
                class={`hero-card kind-${card.kind}`}
                role="listitem"
                key={`${card.kind}:${card.item.key}`}
                onClick={() => card.item.track && playTracks([card.item.track], 0, 'manual')}
              >
                <CardArt url={card.item.artworkUrl} />
                <span class="hero-copy">
                  <span class="hero-label">{label}</span>
                  <span class="hero-title">{card.item.title}</span>
                  <span class="hero-sub">{card.item.subtitle}</span>
                  {detail && <span class="hero-detail">{detail}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {snap.chips.length > 0 && (
        <div class="home-chips" role="group" aria-label={t('home.chips.label')}>
          <button {...focusProps('home-chip-all', chipRow, 0)} class={`chip-button ${snap.selectedChip ? '' : 'is-on'}`} aria-pressed={!snap.selectedChip} onClick={() => void homeFeed.selectChip(undefined)}>
            {t('home.chips.all')}
          </button>
          {snap.chips.map((chip, index) => {
            const on = snap.selectedChip?.title === chip.title;
            return (
              <button {...focusProps(`home-chip-${index}`, chipRow, index + 1)} class={`chip-button ${on ? 'is-on' : ''}`} aria-pressed={on} key={chip.title + (chip.params ?? '')} onClick={() => void homeFeed.selectChip(on ? undefined : chip)}>
                {chip.title}
              </button>
            );
          })}
        </div>
      )}

      {(snap.online === 'loading' || !snap.localReady) && <p class="message-state" role="status">{!snap.localReady ? t('common.loading') : t('home.loading')}</p>}
      {networkNote && (
        <div class="home-note" role="status">
          <span>{networkNote}{snap.fromCache && snap.rows.some((row) => row.origin === 'online') ? ` ${t('home.cached')}` : ''}</span>
          <button {...focusProps('home-retry', 3, 0)} class="text-action" onClick={() => void homeFeed.refresh()}>{t('common.retry')}</button>
        </div>
      )}

      {noContent && (
        <div class="home-empty">
          <p class="message-state">{t('home.empty')}</p>
          <button {...focusProps('home-empty-search', 4, 0)} class="text-action" onClick={() => goTab('search')}>{t('home.emptyAction')}</button>
        </div>
      )}

      {shownRows.map((row, rowIndex) => {
        const title = rowTitle(row);
        const grid = rowBase + rowIndex;
        return (
          <section class={`home-row row-${row.kind}`} data-home-row={rowIndex} key={row.id} aria-label={title}>
            <div class="home-row-head">
              <h2>{title}</h2>
              {row.subtitle && row.kind === 'because' && <span class="home-row-sub">{row.subtitle}</span>}
              {row.detail && (
                <button {...focusProps(`home-more-${rowIndex}`, grid, 0)} class="text-link" onClick={() => navigate({ name: 'section', sectionId: row.id, title })}>
                  {t('home.seeAll')}
                </button>
              )}
            </div>
            <div class="home-row-cards">
              {row.items.map((item, column) => (
                <HomeCard key={item.key} item={item} rowIndex={grid} column={column + (row.detail ? 1 : 0)} onActivate={() => activate(row, item)} />
              ))}
            </div>
          </section>
        );
      })}

      {(rows.length > shownRows.length || snap.canLoadMore) && <div class="home-sentinel" ref={sentinel} aria-hidden="true" />}
      {snap.loadingMore && <p class="message-state" role="status">{t('common.loading')}</p>}
    </section>
  );
}
