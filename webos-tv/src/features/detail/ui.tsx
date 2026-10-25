import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../../app/AppContext';
import { ChunkedList } from '../../app/ChunkedList';
import { focusProps, formatDuration } from '../../app/format';
import { focusFirstContent } from '../../app/remote';
import type { Resource } from '../../app/useResource';
import type { Track } from '../../model';
import { CardArt, HomeCard } from '../home/ui/HomeCard';
import type { HomeItem } from '../home/model';
import { Icon, type IconName } from '../../components/Icon';
import { useLongPress } from '../../app/longPress';
import type { ActionItem } from '../../app/OverlayHost';
import { useLibraryActions } from '../library/actions';

/** Loading, failure (with retry) and not-found for a page that fetches its content. */
export function ResourceGate<T>({ resource, reload, retryRow = 1, children }: {
  resource: Resource<T>; reload(): void; retryRow?: number; children(data: T): ComponentChildren;
}) {
  const { t, goBack, store } = useApp();
  // Content that arrives after the page opened has nothing to land focus on yet, so focus waited on
  // the tab. Once it is there, move to the first control unless the user already went elsewhere.
  const wasLoading = useRef(resource.status === 'loading');
  useEffect(() => {
    if (resource.status === 'ready' && wasLoading.current) {
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body || active.dataset?.focusId === `nav-${store.nav.tab}`) focusFirstContent();
    }
    wasLoading.current = resource.status === 'loading';
  }, [resource.status]);
  if (resource.status === 'ready') return <>{children(resource.data)}</>;
  if (resource.status === 'loading') return <section class="detail-view"><p class="message-state" role="status">{t('common.loading')}</p></section>;
  const message = resource.kind === 'not-found' ? t('detail.notFound') : resource.kind === 'rate-limited' ? t('home.rateLimited') : t('detail.failed');
  return (
    <section class="detail-view">
      <div class="home-empty" role="alert">
        <p class="message-state">{message}</p>
        <div class="detail-actions">
          {resource.kind !== 'not-found' && resource.kind !== 'bad-request' && <button {...focusProps('detail-retry', retryRow, 0)} class="text-action" onClick={reload}>{t('common.retry')}</button>}
          <button {...focusProps('detail-back', retryRow, 1)} class="text-action" onClick={goBack}>{t('common.back')}</button>
        </div>
      </div>
    </section>
  );
}

export function DetailHero({ title, artworkUrl, round, meta, children, description }: {
  title: string; artworkUrl?: string; round?: boolean; meta?: ComponentChildren; children?: ComponentChildren; description?: string;
}) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <header class="detail-hero">
      <CardArt url={artworkUrl} round={round} />
      <div class="detail-hero-copy">
        <h1 id="detail-heading">{title}</h1>
        {meta}
        {description && (
          <>
            <p class={`detail-description ${open ? 'is-open' : ''}`}>{description}</p>
            {description.length > 160 && (
              <button {...focusProps('detail-description-toggle', 2, 0)} class="text-link" aria-expanded={open} onClick={() => setOpen(!open)}>
                {open ? t('detail.less') : t('detail.more')}
              </button>
            )}
          </>
        )}
        {children}
      </div>
    </header>
  );
}

export interface ActionSpec { id: string; label: string; icon?: IconName; onClick(): void; pressed?: boolean; disabled?: boolean }

/** The Play / Shuffle / Save row. */
export function ActionRow({ actions, row = 3 }: { actions: ActionSpec[]; row?: number }) {
  return (
    <div class="detail-actions" role="group">
      {actions.map((action, column) => (
        <button
          key={action.id}
          {...focusProps(`detail-${action.id}`, row, column, action.disabled)}
          class={`chip-button ${action.pressed ? 'is-on' : ''}`}
          aria-pressed={action.pressed}
          onClick={action.onClick}
        >
          {action.icon && <Icon name={action.icon} />}
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
}

export type TrackMenu = (track: Track, index: number) => ActionItem[];

export function TrackRow({ track, index, row, idPrefix, numbered, onPlay, menu }: {
  track: Track; index: number; row: number; idPrefix: string; numbered: boolean; onPlay(index: number): void; menu?: TrackMenu;
}) {
  const { t } = useApp();
  const { showActions } = useLibraryActions();
  const id = `${idPrefix}-${index}`;
  const openMenu = () => { if (menu) showActions(track.title, menu(track, index), id); };
  const press = useLongPress(() => onPlay(index), openMenu);
  return (
    <div class={`track-line ${menu ? 'has-menu' : ''}`}>
      <button {...focusProps(id, row, 0)} class="result-row kind-track" aria-label={`${track.title}, ${track.artist}`} {...(menu ? press : { onClick: () => onPlay(index) })}>
        {numbered ? <span class="detail-index" aria-hidden="true">{index + 1}</span> : <CardArt url={track.artworkUrl} />}
        <span class="result-copy">
          <span class="result-title">{track.title}</span>
          <span class="result-artist">{track.artist}{track.explicit ? ` · ${t('detail.explicit')}` : ''}</span>
        </span>
        <span class="result-duration">{track.durationMs > 0 ? formatDuration(track.durationMs) : ''}</span>
      </button>
      {menu && (
        <button {...focusProps(`${id}-menu`, row, 1)} class="row-menu icon-button" aria-label={t('act.menu', { title: track.title })} aria-haspopup="dialog" onClick={openMenu}>
          <Icon name="ellipsis-vertical" />
        </button>
      )}
    </div>
  );
}

/**
 * A numbered song list; selecting a row plays the list from there. Rows carry a ⋮ button (and
 * hold-OK) for the song menu unless `menu` is false; pass `menu` to add or replace actions.
 */
export function TrackList({ tracks, startRow, idPrefix = 'detail-t', numbered = true, onPlay, unavailable = 0, menu }: {
  tracks: readonly Track[]; startRow: number; idPrefix?: string; numbered?: boolean; onPlay(index: number): void; unavailable?: number; menu?: TrackMenu | false;
}) {
  const { t } = useApp();
  const { songActions } = useLibraryActions();
  const menuFor: TrackMenu | undefined = menu === false ? undefined : menu ?? ((track) => songActions(track));
  return (
    <>
      <ChunkedList class="result-list detail-tracks" chunk={40} items={tracks} ariaLabel={t('detail.songs')} render={(track, index) => (
        <TrackRow track={track} index={index} row={startRow + index} idPrefix={idPrefix} numbered={numbered} onPlay={onPlay} menu={menuFor} />
      )} />
      {unavailable > 0 && <p class="detail-note" role="status">{t('detail.unavailable', { count: unavailable })}</p>}
    </>
  );
}

/** A titled horizontal row of cards (albums, singles, similar artists…). */
export function CardRow({ id, title, items, gridRow, onActivate, onSeeAll }: {
  id: string; title: string; items: HomeItem[]; gridRow: number; onActivate(item: HomeItem): void; onSeeAll?: () => void;
}) {
  const { t } = useApp();
  if (items.length === 0) return null;
  return (
    <section class="home-row" aria-label={title}>
      <div class="home-row-head">
        <h2>{title}</h2>
        {onSeeAll && <button {...focusProps(`${id}-all`, gridRow, 0)} class="text-link" onClick={onSeeAll}>{t('home.seeAll')}</button>}
      </div>
      <div class="home-row-cards">
        {items.map((item, column) => (
          <HomeCard key={item.key} idPrefix={id} item={item} rowIndex={gridRow} column={column + (onSeeAll ? 1 : 0)} onActivate={() => onActivate(item)} />
        ))}
      </div>
    </section>
  );
}

const GRID_COLUMNS = 6;
/** Cards in a plain grid (the "see all" pages). */
export function CardArtGrid({ items, startRow, idPrefix, onActivate }: { items: HomeItem[]; startRow: number; idPrefix: string; onActivate(item: HomeItem): void }) {
  return (
    <div class="card-grid">
      {items.map((item, index) => (
        <HomeCard key={item.key} idPrefix={idPrefix} item={item} rowIndex={startRow + Math.floor(index / GRID_COLUMNS)} column={index % GRID_COLUMNS} onActivate={() => onActivate(item)} />
      ))}
    </div>
  );
}
