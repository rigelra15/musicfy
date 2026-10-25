import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../app/AppContext';
import { ChunkedList } from '../app/ChunkedList';
import { focusProps, formatDuration } from '../app/format';
import type { StringKey } from '../app/i18n';
import { currentRoute } from '../app/router';
import { useSnapshot } from '../app/useSnapshot';
import { Icon } from '../components/Icon';
import { CardArt, routeForItem } from '../features/home/ui/HomeCard';
import { useLibraryActions } from '../features/library/actions';
import { useLongPress } from '../app/longPress';
import type { HomeItem } from '../features/home/model';
import { artistsOf, BULLET, KIND_LABELS, ownerOf, rowSubtitle } from '../features/search/labels';
import { SEARCH_FILTERS, SearchSession, type GenreTile, type ResultSection } from '../features/search/session';

const FIRST_RESULT_ROW = 3;

const KIND_TITLES: Record<string, StringKey> = { exact: 'search.group.exact', track: 'search.group.track', video: 'search.group.video', album: 'search.group.album', artist: 'search.group.artist', playlist: 'search.group.playlist' };
/** A section's heading: the top result, YouTube's own title, or (for the untitled one-kind lists) the kind in the app's language. */
function sectionTitle(section: ResultSection, t: (key: StringKey) => string): string | undefined {
  if (section.topResult) return t('search.topResult');
  if (section.title) return section.title;
  const key = section.contentKind ? KIND_TITLES[section.contentKind] : undefined;
  return key ? t(key) : undefined;
}

/** The phone's mood tile: the stripe colour lifted toward grey, laid over the tile colour at 55% and 16% for the gradient. */
function tileStyle(color?: string): { background: string } {
  const match = /^#([0-9a-f]{6})$/i.exec(color ?? '');
  const base = [0x12, 0x12, 0x14];
  const raw = match ? [0, 2, 4].map((i) => parseInt(match[1].slice(i, i + 2), 16)) : [0, 0, 0];
  const tint = raw.every((c) => c === 0) ? [0x3a, 0x3a, 0x44] : raw.map((c) => Math.min(220, Math.max(40, Math.trunc(c + (170 - c) * 0.45))));
  const blend = (alpha: number) => `rgb(${tint.map((c, i) => Math.round(c * alpha + base[i] * (1 - alpha))).join(',')})`;
  return { background: `linear-gradient(135deg, ${blend(0.55)}, ${blend(0.16)})` };
}

/** A mood tile as on the phone: tinted gradient, the title on the left and two tilted covers on the right (asked for when it is on screen). */
function GenreTileButton({ tile, row, column, covers, onOpen, onVisible }: { tile: GenreTile; row: number; column: number; covers: readonly string[]; onOpen(): void; onVisible(): void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') { onVisible(); return; }
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { onVisible(); observer.disconnect(); } }, { rootMargin: '200px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [tile.key]);
  return (
    <button ref={ref} {...focusProps(`genre-${tile.key}`, row, column)} class="genre-tile" style={tileStyle(tile.color)} onClick={onOpen}>
      <span class="genre-tile-title">{tile.title}</span>
      {covers.length > 0 && (
        <span class="genre-tile-covers" aria-hidden="true">
          {covers[1] && <img class="tile-cover tile-cover-back" src={covers[1]} alt="" loading="lazy" decoding="async" />}
          <img class="tile-cover tile-cover-front" src={covers[0]} alt="" loading="lazy" decoding="async" />
        </span>
      )}
    </button>
  );
}

/** The search field and its history: the history is shown only while focus is in here, as on the phone. */
const inSearchZone = (node: EventTarget | null) => node instanceof Element && !!node.closest('.search-form, .search-history');

function ResultRow({ item, row, id, onOpen }: { item: HomeItem; row: number; id: string; onOpen(item: HomeItem): void }) {
  const { t } = useApp();
  const actions = useLibraryActions();
  const menu = () => {
    if (item.track) { actions.showActions(item.title, actions.songActions(item.track), id); return; }
    const refId = item.kind === 'playlist' ? (item.playlistId ?? item.id) : (item.browseId ?? item.id);
    const route = routeForItem(item);
    if (item.kind === 'album' || item.kind === 'artist' || item.kind === 'playlist') {
      actions.showActions(item.title, actions.entityActions({ provider: 'youtube', kind: item.kind, id: refId }, { title: item.title, subtitle: rowSubtitle(item, t), artworkUrl: item.artworkUrl }, route ? { open: route } : {}), id);
    }
  };
  const press = useLongPress(() => onOpen(item), menu);
  const subtitle = rowSubtitle(item, t);
  const hasMenu = item.kind === 'track' || item.kind === 'video' || item.kind === 'album' || item.kind === 'artist' || item.kind === 'playlist';
  return (
    <div class={`result-line ${hasMenu ? 'has-menu' : ''}`}>
      <button {...focusProps(id, row, 0)} class={`result-row kind-${item.kind}`} aria-label={subtitle ? `${item.title}, ${subtitle}` : item.title} {...(hasMenu ? press : { onClick: () => onOpen(item) })}>
        <CardArt url={item.artworkUrl} round={item.kind === 'artist'} />
        <span class="result-copy"><span class="result-title">{item.title}</span><span class="result-artist">{subtitle}</span></span>
      </button>
      {hasMenu && (
        <button {...focusProps(`${id}-menu`, row, 1)} class="row-menu icon-button" aria-label={t('act.menu', { title: item.title })} aria-haspopup="dialog" onClick={menu}>
          <Icon name="ellipsis" />
        </button>
      )}
    </div>
  );
}

/** The best match, as the phone shows it: a cover, the title, "Song • by LANY • 4:32" and a round play button. */
function TopResultCard({ item, row, onOpen }: { item: HomeItem; row: number; onOpen(item: HomeItem): void }) {
  const { t } = useApp();
  const kind = t(KIND_LABELS[item.kind] ?? 'search.kind.track');
  const by = item.track ? artistsOf(item) : ownerOf(item);
  const duration = item.track && item.track.durationMs > 0 ? formatDuration(item.track.durationMs) : '';
  const detail = [kind, by ? t('search.by', { name: by }) : '', duration].filter(Boolean).join(BULLET);
  return (
    <button {...focusProps('search-top', row, 0)} class={`top-card kind-${item.kind}`} aria-label={`${item.title}, ${detail}`} onClick={() => onOpen(item)}>
      {item.artworkUrl && <span class="top-card-backdrop" style={`background-image:url("${item.artworkUrl}")`} aria-hidden="true" />}
      <span class="top-card-body">
        <CardArt url={item.artworkUrl} round={item.kind === 'artist'} />
        <span class="top-card-row">
          <span class="top-card-copy"><span class="top-card-title">{item.title}</span><span class="top-card-detail">{detail}</span></span>
          {item.kind !== 'artist' && <span class="top-card-play" aria-hidden="true"><Icon name="play" /></span>}
        </span>
      </span>
    </button>
  );
}

/**
 * Search tab: typing shows history, suggestions and what a pasted link points to; submitting pushes
 * the results route (so Back returns to the typed query); filters, results and continuation live in
 * the SearchSession and survive visiting an album or artist.
 */
export function SearchPage() {
  const { t, search, store, navigate, goBack, playSong, goTab } = useApp();
  const snap = useSnapshot(search);
  const route = currentRoute(store.nav);
  const routeQuery = route.name === 'search' ? route.query : undefined;
  const routeFilter = route.name === 'search' ? route.filter : undefined;
  const inResults = routeQuery !== undefined;

  useEffect(() => {
    if (routeQuery !== undefined) void search.open(routeQuery, routeFilter);
    else search.closeResults();
  }, [search, routeQuery, routeFilter]);
  useEffect(() => { void search.loadGenres(); }, [search]);
  // Coming back from results to a typed query asks for its suggestions again.
  const typingNow = !inResults && snap.draft.trim().length > 0;
  useEffect(() => { if (typingNow && search.getSnapshot().suggest.status === 'idle') search.setDraft(search.getSnapshot().draft); }, [search, typingNow]);

  const openItem = (item: HomeItem) => {
    if (item.track) { playSong(item.track); return; }
    const target = routeForItem(item);
    if (target) navigate(target);
  };
  const submitText = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    void search.submit(trimmed);
    navigate({ name: 'search', query: trimmed });
  };
  const onInput = (value: string) => {
    if (inResults) goBack();          // editing the query leaves the results, as on Android
    search.setDraft(value);
  };

  const [zoneActive, setZoneActive] = useState(false);
  const typing = !inResults && snap.draft.trim().length > 0;
  const history = search.matchingHistory(snap.draft);
  let row = FIRST_RESULT_ROW;

  const renderResults = () => {
    const bucket = snap.bucket;
    if (!bucket || bucket.status === 'loading') return <p class="message-state" role="status">{t('search.searching')}</p>;
    if (bucket.status === 'failed') {
      return (
        <div class="home-note" role="status">
          <span>{bucket.errorKind === 'rate-limited' ? t('home.rateLimited') : t('search.failed')}</span>
          <button {...focusProps('search-retry', row, 0)} class="text-action" onClick={() => void search.retry()}>{t('common.retry')}</button>
        </div>
      );
    }
    if (snap.filter === 'all') {
      const sections = bucket.sections;
      if (sections.length === 0) return <p class="message-state" role="status">{t('search.noneFor', { query: snap.query ?? '' })}</p>;
      return (
        <div class="result-sections">
          {sections.map((section: ResultSection, sectionIndex) => (
            <section class={`result-section ${section.topResult ? 'is-top' : ''} ${sectionIndex > 0 ? 'has-rule' : ''}`} key={section.id} aria-label={sectionTitle(section, t)}>
              {sectionTitle(section, t) && <h2>{sectionTitle(section, t)}</h2>}
              {section.topResult && section.items[0] ? (() => { const current = row++; return <TopResultCard item={section.items[0]} row={current} onOpen={openItem} />; })() : null}
              <div class="result-list">
                {section.items.slice(section.topResult ? 1 : 0).map((item) => {
                  const current = row++;
                  return <ResultRow key={item.key} item={item} row={current} id={`search-r-${current}`} onOpen={openItem} />;
                })}
              </div>
            </section>
          ))}
        </div>
      );
    }
    if (bucket.items.length === 0) return <p class="message-state" role="status">{t('search.noneFor', { query: snap.query ?? '' })}</p>;
    const base = row;
    row += bucket.items.length;
    return (
      <>
        <ChunkedList class="result-list" chunk={40} items={bucket.items} render={(item, index) => (
          <ResultRow item={item} row={base + index} id={`search-r-${base + index}`} onOpen={openItem} />
        )} />
        {bucket.continuation && (
          <button {...focusProps('search-more', base + bucket.items.length, 0)} class="text-action" disabled={bucket.loadingMore} onClick={() => void search.loadMore()}>
            {bucket.loadingMore ? t('common.loading') : t('search.loadMore')}
          </button>
        )}
      </>
    );
  };

  const historyBlock = (entries: string[], withClear: boolean) => entries.length > 0 && (
    <section class="search-history" aria-label={t('search.history')}>
      <h2>{t('search.history')}</h2>
      <div class="result-list">
        {entries.map((entryText) => {
          const current = row++;
          return (
            <div class="history-line" key={entryText}>
              <button {...focusProps(`search-h-${current}`, current, 0)} class="result-row history-row" onClick={() => void submitText(entryText)}>
                <Icon name="history" />
                <span class="result-copy"><span class="result-title">{entryText}</span></span>
              </button>
              <button {...focusProps(`search-hx-${current}`, current, 1)} class="row-more icon-button" aria-label={t('search.history.forget', { query: entryText })} onClick={() => void search.forgetHistory(entryText)}>
                <Icon name="x" />
              </button>
            </div>
          );
        })}
      </div>
      {withClear && <button {...focusProps(`search-clear-history`, row++, 0)} class="text-link" onClick={() => void search.clearHistory()}>{t('search.history.clear')}</button>}
    </section>
  );

  return (
    <section class="search-view" aria-labelledby="search-heading"
      onFocusIn={(event) => setZoneActive(inSearchZone(event.target))} onFocusOut={(event) => setZoneActive(inSearchZone(event.relatedTarget))}>
      <div class="search-head">
        <h1 id="search-heading">{t('search.title')}</h1>
        <button {...focusProps('search-profile', 1, 4)} class="search-avatar icon-button" aria-label={t('profile.title')} onClick={() => navigate({ name: 'profile' })}><Icon name="user-round" /></button>
      </div>
      <form class="search-form" onSubmit={(event) => { event.preventDefault(); void submitText(snap.draft); }}>
        <div class="search-field">
          {inResults
            ? <button {...focusProps('search-back-arrow', 1, 0)} data-focus-skip="true" type="button" class="search-lead icon-button" aria-label={t('search.back')} onClick={() => goBack()}><Icon name="arrow-left" /></button>
            : <span class="search-lead" aria-hidden="true"><Icon name="search" /></span>}
          <input
            {...focusProps('search-query', 1, 1)}
            type="search"
            placeholder={t('search.placeholder')}
            value={snap.draft}
            aria-label={t('search.label')}
            onInput={(event) => onInput(event.currentTarget.value)}
          />
          {snap.draft && <button {...focusProps('search-clear', 1, 2)} type="button" class="search-clear icon-button" aria-label={t('search.clear')} onClick={() => { if (inResults) goBack(); search.setDraft(''); }}><Icon name="x" /></button>}
          <button {...focusProps('search-submit', 1, 3, !snap.draft.trim())} class="search-submit" type="submit" aria-label={t('common.search')}><Icon name="search" /></button>
        </div>
      </form>

      {inResults && (
        <div class="search-filters" role="group" aria-label={t('search.filters.label')}>
          {SEARCH_FILTERS.map((filter, index) => (
            <button {...focusProps(`search-filter-${filter}`, 2, index)} class={`search-chip ${snap.filter === filter ? 'is-on' : ''}`} aria-pressed={snap.filter === filter} key={filter} onClick={() => void search.setFilter(filter)}>
              {t(`search.filter.${filter}` as StringKey)}
            </button>
          ))}
        </div>
      )}

      {inResults ? (
        <section class="results-section" aria-label={t('search.results')}>{renderResults()}</section>
      ) : typing ? (
        <section class="suggest-section" aria-label={t('search.suggestions')}>
          {historyBlock(history, false)}
          {snap.suggest.linkItem && (
            <div class="result-list">
              <h2>{t('search.fromLink')}</h2>
              {(() => { const current = row++; return <ResultRow item={snap.suggest.linkItem!} row={current} id={`search-link`} onOpen={openItem} />; })()}
            </div>
          )}
          {snap.suggest.queries.length > 0 && (
            <div class="result-list">
              <h2>{t('search.suggestions')}</h2>
              {snap.suggest.queries.map((queryText) => {
                const current = row++;
                return (
                  <button {...focusProps(`search-s-${current}`, current, 0)} class="result-row history-row" key={queryText} onClick={() => void submitText(queryText)}>
                    <Icon name="search" />
                    <span class="result-copy"><span class="result-title">{queryText}</span></span>
                  </button>
                );
              })}
            </div>
          )}
          {snap.suggest.items.length > 0 && (
            <div class="result-list">
              <h2>{t('search.recommended')}</h2>
              {snap.suggest.items.map((item) => {
                const current = row++;
                return <ResultRow key={item.key} item={item} row={current} id={`search-i-${current}`} onOpen={openItem} />;
              })}
            </div>
          )}
          {snap.suggest.status === 'loading' && <p class="message-state" role="status">{t('search.searching')}</p>}
          {snap.suggest.status === 'failed' && <p class="message-state" role="status">{t('search.suggestionsFailed')}</p>}
        </section>
      ) : (
        <>
          {zoneActive && historyBlock(history.slice(0, 5), true)}
          <section class="genre-section" aria-label={t('search.genres')}>
            <h2>{t('search.genres')}</h2>
            {snap.genres.status === 'loading' && snap.genres.groups.length === 0 && <p class="message-state" role="status">{t('common.loading')}</p>}
            {snap.genres.status === 'failed' && (
              <div class="home-note" role="status">
                <span>{t('search.genres.failed')}</span>
                <button {...focusProps('genres-retry', row++, 0)} class="text-action" onClick={() => void search.loadGenres(true)}>{t('common.retry')}</button>
              </div>
            )}
            {snap.genres.groups.map((group) => (
              <div class="genre-group" key={group.id}>
                {group.title && <h3>{group.title}</h3>}
                <div class="genre-grid">
                  {(() => { const start = row; row += Math.ceil(group.tiles.length / 5); return group.tiles.map((tile, index) => (
                    <GenreTileButton key={tile.key} tile={tile} row={start + Math.floor(index / 5)} column={index % 5} covers={snap.covers[SearchSession.coverKey(tile)] ?? []}
                      onVisible={() => search.requestCovers(tile)} onOpen={() => navigate({ name: 'genre', browseId: tile.browseId, params: tile.params, title: tile.title })} />
                  )); })()}
                </div>
              </div>
            ))}
          </section>
        </>
      )}
      {inResults && (
        <button {...focusProps('search-back', 9999, 0)} class="visually-hidden" tabIndex={-1} onClick={() => goTab('search')}>{t('search.back')}</button>
      )}
    </section>
  );
}
