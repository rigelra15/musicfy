import { useState } from 'preact/hooks';
import { useLongPress } from '../../../app/longPress';
import { useApp } from '../../../app/AppContext';
import { focusProps } from '../../../app/format';
import type { Route } from '../../../app/router';
import type { HomeItem, HomeRow } from '../model';

export function CardArt({ url, round }: { url?: string; round?: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <span class={`card-art ${round ? 'is-round' : ''}`} aria-hidden="true">
      <img src={!url || broken ? './icon.png' : url} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
    </span>
  );
}

/** Where a card opens, for everything that is not a song. */
export function routeForItem(item: HomeItem): Route | undefined {
  switch (item.kind) {
    case 'album': return { name: 'album', id: item.browseId ?? item.id };
    case 'artist': return { name: 'artist', id: item.browseId ?? item.id, title: item.title };
    case 'playlist': return { name: 'playlist', id: item.playlistId ?? item.id, origin: 'online' };
    case 'localPlaylist': return { name: 'playlist', id: item.id, origin: 'local' };
    case 'liked': return { name: 'library', section: 'liked' };
    case 'link': return item.browseId ? { name: 'genre', browseId: item.browseId, params: item.params, title: item.title } : undefined;
    default: return undefined;
  }
}

export function useActivate() {
  const { playTracks, navigate } = useApp();
  return (row: Pick<HomeRow, 'items'>, item: HomeItem) => {
    if (item.track) {
      const playable = row.items.filter((candidate) => candidate.track);
      playTracks(playable.map((candidate) => candidate.track!), Math.max(0, playable.indexOf(item)), 'manual');
      return;
    }
    const route = routeForItem(item);
    if (route) navigate(route);
  };
}

export function HomeCard({ item, rowIndex, column, onActivate, onMenu, idPrefix = 'home' }: {
  item: HomeItem; rowIndex: number; column: number; onActivate(): void; idPrefix?: string;
  /** Hold OK for this card's menu (Library cards). */
  onMenu?: () => void;
}) {
  const { t } = useApp();
  const press = useLongPress(onActivate, onMenu ?? (() => undefined));
  const title = item.kind === 'liked' ? t('home.liked') : item.title;
  const subtitle = item.count !== undefined && (item.kind === 'liked' || item.kind === 'localPlaylist') ? t('home.songsCount', { count: item.count }) : item.subtitle;
  return (
    <button
      {...focusProps(`${idPrefix}-${rowIndex}-${column}`, rowIndex, column)}
      class={`home-card kind-${item.kind}`}
      aria-label={subtitle ? `${title}, ${subtitle}` : title}
      {...(onMenu ? press : { onClick: onActivate })}
    >
      <CardArt url={item.artworkUrl} round={item.kind === 'artist'} />
      <span class="card-title">{title}</span>
      {subtitle && <span class="card-subtitle">{subtitle}</span>}
    </button>
  );
}
