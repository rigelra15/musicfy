import type { ComponentChildren } from 'preact';
import { useApp } from '../../app/AppContext';
import { focusProps } from '../../app/format';
import { useLongPress } from '../../app/longPress';
import { Icon } from '../../components/Icon';
import { CardArt } from '../home/ui/HomeCard';

/** Up to four covers as a 2×2 collage, one cover as itself, none as the app icon. */
export function Collage({ covers, round }: { covers: ReadonlyArray<string | undefined>; round?: boolean }) {
  const shown = covers.filter((cover): cover is string => Boolean(cover)).slice(0, 4);
  if (shown.length < 2) return <CardArt url={shown[0]} round={round} />;
  return (
    <span class={`card-art collage ${round ? 'is-round' : ''}`} aria-hidden="true">
      {shown.map((cover, index) => <img key={index} src={cover} alt="" loading="lazy" decoding="async" />)}
    </span>
  );
}

export function CategoryCard({ id, row, column, title, count, covers, round, onOpen }: {
  id: string; row: number; column: number; title: string; count: string; covers: ReadonlyArray<string | undefined>; round?: boolean; onOpen(): void;
}) {
  return (
    <button {...focusProps(id, row, column)} class="lib-card" aria-label={`${title}, ${count}`} onClick={onOpen}>
      <Collage covers={covers} round={round} />
      <span class="card-title">{title}</span>
      <span class="card-subtitle">{count}</span>
    </button>
  );
}

export function WideCard({ id, row, title, count, covers, icon, onOpen }: {
  id: string; row: number; title: string; count: string; covers: ReadonlyArray<string | undefined>; icon?: 'heart' | 'history' | 'chart-column' | 'import' | 'puzzle'; onOpen(): void;
}) {
  return (
    <button {...focusProps(id, row, 0)} class="lib-wide" aria-label={`${title}, ${count}`} onClick={onOpen}>
      <span class="lib-wide-art">{icon ? <span class={`liked-cover ${icon === 'heart' ? '' : 'is-plain'}`} aria-hidden="true"><Icon name={icon} /></span> : <Collage covers={covers} />}</span>
      <span class="result-copy"><span class="result-title">{title}</span><span class="result-artist">{count}</span></span>
    </button>
  );
}

/** A pinned item: select to open, hold OK for its menu. */
export function PinnedTile({ id, row, column, title, subtitle, artworkUrl, round, onOpen, onMenu }: {
  id: string; row: number; column: number; title: string; subtitle?: string; artworkUrl?: string; round?: boolean; onOpen(): void; onMenu(): void;
}) {
  const press = useLongPress(onOpen, onMenu);
  return (
    <button {...focusProps(id, row, column)} class="lib-pinned" aria-label={subtitle ? `${title}, ${subtitle}` : title} {...press}>
      <CardArt url={artworkUrl} round={round} />
      <span class="card-title">{title}</span>
    </button>
  );
}

/** A row for a playlist, album, artist or search hit: open on select, ⋮ or hold OK for the menu. */
export function EntityRow({ id, row, title, subtitle, artworkUrl, covers, round, onOpen, onMenu }: {
  id: string; row: number; title: string; subtitle?: string; artworkUrl?: string; covers?: ReadonlyArray<string | undefined>; round?: boolean; onOpen(): void; onMenu?: () => void;
}) {
  const { t } = useApp();
  const press = useLongPress(onOpen, onMenu ?? (() => undefined));
  return (
    <div class={`track-line ${onMenu ? 'has-menu' : ''}`}>
      <button {...focusProps(id, row, 0)} class="result-row" aria-label={subtitle ? `${title}, ${subtitle}` : title} {...(onMenu ? press : { onClick: onOpen })}>
        {covers ? <Collage covers={covers} round={round} /> : <CardArt url={artworkUrl} round={round} />}
        <span class="result-copy"><span class="result-title">{title}</span>{subtitle && <span class="result-artist">{subtitle}</span>}</span>
        <span />
      </button>
      {onMenu && (
        <button {...focusProps(`${id}-menu`, row, 1)} class="row-menu icon-button" aria-label={t('act.menu', { title })} aria-haspopup="dialog" onClick={onMenu}>
          <Icon name="ellipsis-vertical" />
        </button>
      )}
    </div>
  );
}

export function Section({ title, children, hint }: { title: string; hint?: string; children: ComponentChildren }) {
  return (
    <section class="detail-section" aria-label={title}>
      <h2>{title}</h2>
      {hint && <p class="detail-sub">{hint}</p>}
      {children}
    </section>
  );
}
