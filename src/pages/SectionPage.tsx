import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../app/AppContext';
import { focusProps } from '../app/format';
import type { CatalogItem, ContinuationRef } from '../catalog/types';
import { HomeCard, useActivate } from '../features/home/ui/HomeCard';
import { applyFilters, dedupe, homeItemFromCatalog, type HomeItem } from '../features/home/model';
import { PREF_HIDE_EXPLICIT, PREF_HIDE_VIDEO_SONGS } from '../features/home/feed';
import { useHomeSnapshot } from '../features/home/ui/useHome';

const COLUMNS = 6;
interface State { status: 'loading' | 'ready' | 'error'; items: HomeItem[]; continuation?: ContinuationRef; loadingMore: boolean }

/** "Lihat semua" of a Home row: the full shelf from YouTube Music, or the row itself when it has no more. */
export function SectionPage({ sectionId, title }: { sectionId: string; title: string }) {
  const { t, homeFeed, catalog, services, pageCache, goBack } = useApp();
  const snap = useHomeSnapshot(homeFeed);
  const row = snap.rows.find((candidate) => candidate.id === sectionId) ?? pageCache.get<typeof snap.rows[number]>(`section.row:${sectionId}`);
  if (row) pageCache.set(`section.row:${sectionId}`, row);
  const activate = useActivate();
  const [state, setState] = useState<State>(() => pageCache.get<State>(`section:${sectionId}`) ?? { status: 'loading', items: [], loadingMore: false });
  const token = useRef(0);
  const filters = () => ({ hideExplicit: services.prefs.get(PREF_HIDE_EXPLICIT, false), hideVideoSongs: services.prefs.get(PREF_HIDE_VIDEO_SONGS, false) });
  const toItems = (items: CatalogItem[]) => applyFilters(dedupe(items.map(homeItemFromCatalog)), filters());
  const update = (next: State) => { pageCache.set(`section:${sectionId}`, next); setState(next); };

  async function load() {
    const id = ++token.current;
    if (!row) { update({ status: 'ready', items: [], loadingMore: false }); return; }
    if (!row.more) { update({ status: 'ready', items: row.items, loadingMore: false }); return; }
    update({ status: 'loading', items: [], loadingMore: false });
    try {
      const page = await catalog.page(row.more.browseId, row.more.params);
      if (id !== token.current) return;
      update({ status: 'ready', items: toItems(page.sections.flatMap((section) => section.items)), continuation: page.continuation, loadingMore: false });
    } catch {
      if (id !== token.current) return;
      update({ status: 'error', items: row.items, loadingMore: false });
    }
  }
  useEffect(() => { if (state.status === 'loading') void load(); }, [sectionId]);

  async function loadMore() {
    if (!state.continuation || state.loadingMore) return;
    const id = token.current;
    update({ ...state, loadingMore: true });
    try {
      const page = await catalog.more('browse', state.continuation);
      if (id !== token.current) return;
      const extra = toItems([...page.items, ...page.sections.flatMap((section) => section.items)]);
      update({ ...state, items: dedupe([...state.items, ...extra]), continuation: page.continuation, loadingMore: false });
    } catch {
      if (id === token.current) update({ ...state, loadingMore: false });
    }
  }

  const items = state.items;
  return (
    <section class="section-view" aria-labelledby="section-heading">
      <h1 id="section-heading">{title}</h1>
      {state.status === 'loading' ? <p class="message-state" role="status">{t('common.loading')}</p> : (
        <>
          {state.status === 'error' && (
            <div class="home-note" role="status">
              <span>{t('home.offline')}</span>
              <button {...focusProps('section-retry', 1, 0)} class="text-action" onClick={() => void load()}>{t('common.retry')}</button>
            </div>
          )}
          {items.length === 0 && state.status === 'ready' && (
            <div class="home-empty">
              <p class="message-state">{t('section.empty')}</p>
              <button {...focusProps('section-back', 1, 0)} class="text-action" onClick={goBack}>{t('common.back')}</button>
            </div>
          )}
          <div class="card-grid">
            {items.map((item, index) => (
              <HomeCard key={item.key} idPrefix="section" item={item} rowIndex={2 + Math.floor(index / COLUMNS)} column={index % COLUMNS} onActivate={() => activate({ items }, item)} />
            ))}
          </div>
          {state.continuation && (
            <button {...focusProps('section-more', 2 + Math.ceil(items.length / COLUMNS), 0)} class="text-action" disabled={state.loadingMore} onClick={() => void loadMore()}>
              {state.loadingMore ? t('common.loading') : t('home.loadMore')}
            </button>
          )}
        </>
      )}
    </section>
  );
}
