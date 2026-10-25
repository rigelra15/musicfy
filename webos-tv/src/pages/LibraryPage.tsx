import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useApp } from '../app/AppContext';
import { ChunkedList } from '../app/ChunkedList';
import { focusProps } from '../app/format';
import { focusById } from '../app/remote';
import type { LibrarySection, LibraryShelf } from '../app/router';
import { useSnapshot } from '../app/useSnapshot';
import { Icon } from '../components/Icon';
import type { EntityRef } from '../domain/entity';
import type { SavedEntity } from '../library/types';
import type { Track } from '../model';
import { ActionRow, TrackList, TrackRow } from '../features/detail/ui';
import { homeItemFromCatalog, type HomeItem } from '../features/home/model';
import { HomeCard } from '../features/home/ui/HomeCard';
import { useLibraryActions } from '../features/library/actions';
import type { LibrarySnapshot, LibrarySong, PlaylistPreview } from '../features/library/data';
import { indexSections, sortForIndex } from '../features/library/index';
import { entityMetrics, sortItems, yearOf } from '../features/library/sort';
import { useSort } from '../features/library/useSort';
import { fold, resultCount, searchLibrary } from '../features/library/search';
import { CategoryCard, EntityRow, PinnedTile, Section, WideCard } from '../features/library/ui';

export function useLibrarySnapshot(): LibrarySnapshot {
  const { library } = useApp();
  return useSnapshot(library);
}

function LoadFailed() {
  const { t, library } = useApp();
  return (
    <div class="home-empty" role="alert">
      <p class="message-state">{t('lib.loadFailed')}</p>
      <button {...focusProps('lib-retry', 1, 0)} class="text-action" onClick={() => void library.reload()}>{t('common.retry')}</button>
    </div>
  );
}

const tracksOf = (songs: readonly LibrarySong[]): Track[] => songs.map((song) => song.track);

export function LibraryPage({ section = 'root', shelf, source }: { section?: LibrarySection; shelf?: LibraryShelf; source?: string }) {
  switch (section) {
    case 'songs': case 'added': case 'liked': return <SongListPage kind={section} source={source} />;
    case 'playlists': return <PlaylistsPage source={source} />;
    case 'albums': case 'artists': return <SavedEntitiesPage kind={section} />;
    default: return <LibraryRoot shelf={shelf} />;
  }
}

// ---- landing page ---------------------------------------------------------------------------------

const TABS: LibraryShelf[] = ['all', 'local', 'cached', 'imported'];

function LibraryRoot({ shelf }: { shelf?: LibraryShelf }) {
  const { t, pageCache, goTab } = useApp();
  const snap = useLibrarySnapshot();
  const [tab, setTabState] = useState<LibraryShelf>(() => shelf ?? pageCache.get<LibraryShelf>('library.tab') ?? 'all');
  const [query, setQueryState] = useState(() => pageCache.get<string>('library.query') ?? '');
  const setTab = (next: LibraryShelf) => { pageCache.set('library.tab', next); setTabState(next); };
  const setQuery = (next: string) => { pageCache.set('library.query', next); setQueryState(next); };
  const results = useMemo(() => searchLibrary(query, snap), [query, snap]);
  const searching = query.trim().length > 0;

  return (
    <section class="lib-view" aria-labelledby="lib-heading">
      <h1 id="lib-heading">{t('lib.title')}</h1>
      <div class="lib-searchbar">
        <input {...focusProps('lib-search', 1, 0)} class="lib-search" type="search" value={query} placeholder={t('lib.search')} aria-label={t('lib.searchLabel')} onInput={(event) => setQuery(event.currentTarget.value)} />
      </div>
      <div class="lib-tabs" role="group" aria-label={t('lib.tabs')}>
        {TABS.map((id, index) => (
          <button {...focusProps(`lib-tab-${id}`, 2, index)} class={`chip-button ${tab === id ? 'is-on' : ''}`} aria-pressed={tab === id} key={id} onClick={() => setTab(id)}>
            {t(`lib.tab.${id}` as 'lib.tab.all')}
          </button>
        ))}
      </div>
      {snap.status === 'loading' && <p class="message-state" role="status">{t('common.loading')}</p>}
      {snap.status === 'error' && snap.songs.length === 0 && <LoadFailed />}
      {snap.status !== 'loading' && !(snap.status === 'error' && snap.songs.length === 0) && (
        searching ? <SearchResults results={results} snap={snap} /> :
        tab === 'all' ? <AllTab snap={snap} goSearch={() => goTab('search')} /> :
        tab === 'local' ? <ShelfTab songs={snap.local} empty={t('lib.local.empty')} /> :
        tab === 'cached' ? <ShelfTab songs={snap.cached} empty={t('lib.cached.empty')} /> :
        <ImportedTab snap={snap} />
      )}
    </section>
  );
}

function SearchResults({ results, snap }: { results: ReturnType<typeof searchLibrary>; snap: LibrarySnapshot }) {
  const { t, navigate, playTracks } = useApp();
  const actions = useLibraryActions();
  if (resultCount(results) === 0) return <p class="message-state" role="status">{t('lib.noMatch')}</p>;
  let row = 3;
  const songRow = row; row += results.songs.length;
  const artistRow = row; row += results.artists.length;
  const albumRow = row; row += results.albums.length;
  const playlistRow = row;
  return (
    <>
      {results.songs.length > 0 && (
        <Section title={t('lib.results.songs')}>
          <TrackList tracks={tracksOf(results.songs)} startRow={songRow} idPrefix="lib-hit" numbered={false} onPlay={(index) => playTracks(tracksOf(results.songs), index, 'manual')} />
        </Section>
      )}
      {results.artists.length > 0 && (
        <Section title={t('lib.results.artists')}>
          {results.artists.map((artist, index) => (
            <EntityRow key={artist.key} id={`lib-artist-${index}`} row={artistRow + index} title={artist.title} artworkUrl={artist.artworkUrl} round
              onOpen={() => navigate({ name: 'artist', id: artist.ref.id, title: artist.title })}
              onMenu={() => actions.showActions(artist.title, actions.entityActions(artist.ref, artist, { open: { name: 'artist', id: artist.ref.id, title: artist.title } }), `lib-artist-${index}`)} />
          ))}
        </Section>
      )}
      {results.albums.length > 0 && (
        <Section title={t('lib.results.albums')}>
          {results.albums.map((album, index) => (
            <EntityRow key={album.key} id={`lib-album-${index}`} row={albumRow + index} title={album.title} subtitle={album.subtitle} artworkUrl={album.artworkUrl}
              onOpen={() => navigate({ name: 'album', id: album.ref.id })}
              onMenu={() => actions.showActions(album.title, actions.entityActions(album.ref, album, { open: { name: 'album', id: album.ref.id } }), `lib-album-${index}`)} />
          ))}
        </Section>
      )}
      {results.playlists.length > 0 && (
        <Section title={t('lib.results.playlists')}>
          <PlaylistRows playlists={results.playlists} startRow={playlistRow} idPrefix="lib-pl" />
        </Section>
      )}
      <span class="visually-hidden">{snap.songs.length}</span>
    </>
  );
}

function PlaylistRows({ playlists, startRow, idPrefix }: { playlists: PlaylistPreview[]; startRow: number; idPrefix: string }) {
  const { t, navigate } = useApp();
  const actions = useLibraryActions();
  return (
    <>
      {playlists.map((playlist, index) => (
        <EntityRow key={playlist.id} id={`${idPrefix}-${index}`} row={startRow + index} title={playlist.name}
          subtitle={[t('home.songsCount', { count: playlist.trackCount }), playlist.source ? t('lib.fromSource', { source: playlist.source.title ?? playlist.source.provider }) : undefined].filter(Boolean).join(' · ')}
          covers={playlist.covers}
          onOpen={() => navigate({ name: 'playlist', id: playlist.id, origin: 'local' })}
          onMenu={() => actions.showActions(playlist.name, actions.playlistActions(playlist, { open: true }), `${idPrefix}-${index}`)} />
      ))}
    </>
  );
}

function openRef(ref: EntityRef, title: string): import('../app/router').Route | undefined {
  if (ref.kind === 'album') return { name: 'album', id: ref.id };
  if (ref.kind === 'artist') return { name: 'artist', id: ref.id, title };
  if (ref.kind === 'playlist') return { name: 'playlist', id: ref.id, origin: ref.provider === 'local' ? 'local' : 'online' };
  return undefined;
}

/** History and stats are about listening, not the collection, so they are reachable with an empty library too. */
function ListeningCards({ row }: { row: number }) {
  const { t, navigate } = useApp();
  return (
    <>
      <WideCard id="lib-history" row={row} title={t('lib.history')} count={t('lib.historyHint')} covers={[]} icon="history" onOpen={() => navigate({ name: 'history' })} />
      <WideCard id="lib-stats" row={row + 1} title={t('lib.stats')} count={t('lib.statsHint')} covers={[]} icon="chart-column" onOpen={() => navigate({ name: 'stats' })} />
      <WideCard id="lib-import" row={row + 2} title={t('lib.import')} count={t('lib.importHint')} covers={[]} icon="import" onOpen={() => navigate({ name: 'import' })} />
    </>
  );
}

function AllTab({ snap, goSearch }: { snap: LibrarySnapshot; goSearch(): void }) {
  const { t, navigate, playTracks } = useApp();
  const actions = useLibraryActions();
  const empty = snap.songs.length === 0 && snap.albums.length === 0 && snap.artists.length === 0 && snap.playlists.length === 0 && snap.onlinePlaylists.length === 0 && snap.pins.length === 0;
  if (empty) {
    return (
      <div class="home-empty">
        <p class="message-state">{t('lib.empty')}</p>
        <button {...focusProps('lib-empty-search', 3, 0)} class="text-action" onClick={goSearch}>{t('lib.emptyAction')}</button>
        <ListeningCards row={4} />
      </div>
    );
  }
  const pinRows = Math.ceil(snap.pins.length / 3);
  const cardRow = 3 + pinRows;
  const playlistCount = snap.playlists.length + snap.onlinePlaylists.length;
  const go = (section: LibrarySection) => navigate({ name: 'library', section });
  return (
    <>
      {snap.pins.length > 0 && (
        <Section title={t('lib.pinned')}>
          <div class="lib-pinned-grid">
            {snap.pins.map((pin, index) => {
              const route = openRef(pin.ref, pin.title);
              const open = () => (pin.track ? playTracks([pin.track], 0, 'manual') : route && navigate(route));
              const menu = () => actions.showActions(pin.title, [
                { id: 'open', label: pin.track ? t('common.play') : t('common.open'), onSelect: open },
                { id: 'unpin', label: t('act.unpin'), onSelect: () => void actions.unpinRef(pin.ref) },
              ], `lib-pin-${index}`);
              return <PinnedTile key={pin.key} id={`lib-pin-${index}`} row={3 + Math.floor(index / 3)} column={index % 3} title={pin.title} subtitle={pin.subtitle} artworkUrl={pin.artworkUrl} round={pin.ref.kind === 'artist'} onOpen={open} onMenu={menu} />;
            })}
          </div>
        </Section>
      )}
      <div class="lib-grid">
        <CategoryCard id="lib-cat-songs" row={cardRow} column={0} title={t('lib.cat.songs')} count={t('home.songsCount', { count: snap.songs.length })} covers={snap.songs.slice(0, 4).map((song) => song.track.artworkUrl)} onOpen={() => go('songs')} />
        <CategoryCard id="lib-cat-playlists" row={cardRow} column={1} title={t('lib.cat.playlists')} count={t('lib.count.playlists', { count: playlistCount })} covers={[...snap.playlists.flatMap((playlist) => playlist.covers.slice(0, 1)), ...snap.onlinePlaylists.map((playlist) => playlist.artworkUrl)].slice(0, 4)} onOpen={() => go('playlists')} />
        <CategoryCard id="lib-cat-albums" row={cardRow + 1} column={0} title={t('lib.cat.albums')} count={t('lib.count.albums', { count: snap.albums.length })} covers={snap.albums.slice(0, 4).map((album) => album.artworkUrl)} onOpen={() => go('albums')} />
        <CategoryCard id="lib-cat-artists" row={cardRow + 1} column={1} title={t('lib.cat.artists')} count={t('lib.count.artists', { count: snap.artists.length })} covers={snap.artists.slice(0, 4).map((artist) => artist.artworkUrl)} round onOpen={() => go('artists')} />
      </div>
      {snap.songs.length > 0 && <WideCard id="lib-added" row={cardRow + 2} title={t('lib.added')} count={t('home.songsCount', { count: snap.songs.length })} covers={snap.songs.slice(0, 4).map((song) => song.track.artworkUrl)} onOpen={() => go('added')} />}
      {snap.liked.length > 0 && <WideCard id="lib-liked" row={cardRow + 3} title={t('lib.liked')} count={t('home.songsCount', { count: snap.liked.length })} covers={[]} icon="heart" onOpen={() => go('liked')} />}
      <ListeningCards row={cardRow + 4} />
    </>
  );
}

function ShelfTab({ songs, empty }: { songs: LibrarySong[]; empty: string }) {
  const { playTracks } = useApp();
  if (songs.length === 0) return <p class="message-state">{empty}</p>;
  const ordered = sortForIndex(songs, (song) => song.track.title);
  const tracks = tracksOf(ordered);
  return <TrackList tracks={tracks} startRow={3} idPrefix="lib-shelf" numbered={false} onPlay={(index) => playTracks(tracks, index, 'manual')} />;
}

function ImportedTab({ snap }: { snap: LibrarySnapshot }) {
  const { t, navigate } = useApp();
  if (snap.importSources.length === 0) return <p class="message-state">{t('lib.imported.empty')}</p>;
  let row = 3;
  return (
    <div class="lib-sources">
      {snap.importSources.map((source) => (
        <div class="lib-source-card" key={source.id}>
          <h2>{source.label}</h2>
          {source.songs.length > 0 && (
            <EntityRow id={`lib-src-${source.id}-songs`} row={row++} title={t('lib.cat.songs')} subtitle={t('home.songsCount', { count: source.songs.length })} artworkUrl={source.songs[0]?.track.artworkUrl}
              onOpen={() => navigate({ name: 'library', section: 'songs', source: source.id })} />
          )}
          {source.playlists.length > 0 && (
            <EntityRow id={`lib-src-${source.id}-playlists`} row={row++} title={t('lib.imported.playlists')} subtitle={t('lib.count.playlists', { count: source.playlists.length })} covers={source.playlists.flatMap((playlist) => playlist.covers.slice(0, 1))}
              onOpen={() => navigate({ name: 'library', section: 'playlists', source: source.id })} />
          )}
        </div>
      ))}
    </div>
  );
}

// ---- Songs, Recently added, Liked ------------------------------------------------------------------

type Flat = { kind: 'header'; label: string; key: string } | { kind: 'song'; song: LibrarySong; index: number };

function SongListPage({ kind, source }: { kind: 'songs' | 'added' | 'liked'; source?: string }) {
  const { t, playTracks, pageCache, openOverlay } = useApp();
  const snap = useLibrarySnapshot();
  const actions = useLibraryActions();
  const queryKey = `library.${kind}.query`;
  const [query, setQueryState] = useState(() => pageCache.get<string>(queryKey) ?? '');
  const setQuery = (next: string) => { pageCache.set(queryKey, next); setQueryState(next); };
  const [reveal, setReveal] = useState<number | undefined>();
  const pendingFocus = useRef<number | undefined>();

  const { sort, buttons: sortButtons } = useSort(kind === 'liked' ? 'liked' : 'songs');
  const base = kind === 'liked' ? snap.liked : source ? snap.songs.filter((song) => song.source === `import:${source}`) : snap.songs;
  const needle = fold(query);
  const visible = needle ? base.filter((song) => fold(`${song.track.title} ${song.track.artist} ${song.track.album ?? ''}`).includes(needle)) : base;
  const alphabetical = kind === 'songs' && sort.key === 'name';
  const sections = useMemo(() => {
    if (!alphabetical) return [];
    const ascending = indexSections(visible, (song) => song.track.title);
    return sort.descending ? ascending.map(([section, list]) => [section, [...list].reverse()] as typeof ascending[number]).reverse() : ascending;
  }, [visible, alphabetical, sort.descending]);
  const ordered = useMemo(() => {
    if (alphabetical) return sections.flatMap(([, list]) => list);
    if (kind === 'added') return visible;
    return sortItems(visible, sort, {
      name: (song) => song.track.title,
      artist: (song) => song.track.artist,
      date: (song) => (kind === 'liked' ? song.likedAt ?? song.addedAt : song.addedAt),
      playTime: (song) => snap.playTime.get(song.trackKey) ?? 0,
    });
  }, [sections, visible, alphabetical, kind, sort, snap.playTime]);
  const tracks = useMemo(() => tracksOf(ordered), [ordered]);
  const flat = useMemo<Flat[]>(() => {
    if (!alphabetical) return ordered.map((song, index) => ({ kind: 'song', song, index }));
    const out: Flat[] = [];
    let index = 0;
    for (const [section, list] of sections) {
      out.push({ kind: 'header', label: section.label, key: section.key });
      for (const song of list) out.push({ kind: 'song', song, index: index++ });
    }
    return out;
  }, [sections, ordered, alphabetical]);

  useEffect(() => {
    if (pendingFocus.current === undefined) return;
    const index = pendingFocus.current;
    pendingFocus.current = undefined;
    // The picker closes in the same moment and hands focus back to its opener; the song comes after that.
    const timer = setTimeout(() => { focusById(`lib-song-${index}`); }, 0);
    return () => clearTimeout(timer);
  }, [reveal]);

  const title = kind === 'liked' ? t('lib.liked') : kind === 'added' ? t('lib.added') : t('lib.cat.songs');
  const hint = kind === 'liked' ? t('lib.likedHint') : kind === 'added' ? t('lib.addedHint') : alphabetical ? t('lib.songsHint') : '';
  const jump = () => {
    const entries = sections.map(([section, list]) => ({ id: section.key, label: `${section.label} · ${list.length}`, first: list[0] }));
    openOverlay('actions', { openerFocusId: 'detail-songs-jump', props: { title: t('lib.jump'), actions: entries.map((entry) => ({
      id: entry.id.replace('/', '-'), label: entry.label,
      onSelect: () => {
        const flatIndex = flat.findIndex((item) => item.kind === 'song' && item.song === entry.first);
        pendingFocus.current = (flat[flatIndex] as Extract<Flat, { kind: 'song' }>).index;
        setReveal(flatIndex);
      },
    })) } });
  };
  const play = (index: number, shuffle = false) => playTracks(tracks, index, 'manual', shuffle ? { shuffle } : undefined);

  return (
    <section class="lib-view" aria-labelledby="lib-heading">
      <h1 id="lib-heading">{title}</h1>
      {hint && <p class="detail-sub">{hint}</p>}
      <div class="lib-searchbar">
        <input {...focusProps('lib-search', 1, 0)} class="lib-search" type="search" value={query} placeholder={t('lib.search')} aria-label={t('lib.searchLabel')} onInput={(event) => setQuery(event.currentTarget.value)} />
      </div>
      {snap.status === 'loading' && <p class="message-state" role="status">{t('common.loading')}</p>}
      {snap.status === 'error' && snap.songs.length === 0 && <LoadFailed />}
      {snap.status === 'ready' && (
        <>
          <ActionRow row={2} actions={[
            { id: 'play', label: t('lib.playAll'), icon: 'play', onClick: () => play(0), disabled: tracks.length === 0 },
            { id: 'shuffle', label: t('detail.shuffle'), icon: 'shuffle', onClick: () => play(0, true), disabled: tracks.length === 0 },
            ...(kind === 'added' ? [] : sortButtons),
            ...(alphabetical && sections.length > 1 ? [{ id: 'songs-jump', label: t('lib.jump'), icon: 'list-start' as const, onClick: jump }] : []),
          ]} />
          {visible.length === 0
            ? <p class="message-state" role="status">{needle ? t('lib.noMatch') : kind === 'liked' ? t('lib.likedHint') : t('lib.empty')}</p>
            : (
              <ChunkedList class="result-list detail-tracks" chunk={40} items={flat} reveal={reveal} ariaLabel={title} render={(item) => item.kind === 'header'
                ? <h2 class="letter-header" id={`lib-letter-${item.key.replace('/', '-')}`}>{item.label}</h2>
                : <TrackRow track={item.song.track} index={item.index} row={3 + item.index} idPrefix="lib-song" numbered={false} onPlay={(index) => play(index)} menu={(track) => actions.songActions(track)} />} />
            )}
        </>
      )}
    </section>
  );
}

// ---- Playlists, Albums, Artists --------------------------------------------------------------------

function PlaylistsPage({ source }: { source?: string }) {
  const { t, openOverlay, navigate, pageCache } = useApp();
  const snap = useLibrarySnapshot();
  const actions = useLibraryActions();
  const [query, setQueryState] = useState(() => pageCache.get<string>('library.playlists.query') ?? '');
  const setQuery = (next: string) => { pageCache.set('library.playlists.query', next); setQueryState(next); };
  const { sort, buttons: sortButtons } = useSort('playlists');
  const needle = fold(query);
  const local = snap.playlists.filter((playlist) => (!source || playlist.source?.provider === source) && (!needle || fold(playlist.name).includes(needle)));
  const sorted = useMemo(() => sortItems(local, sort, { name: (playlist) => playlist.name, date: (playlist) => playlist.createdAt, songCount: (playlist) => playlist.trackCount, updated: (playlist) => playlist.updatedAt }), [local, sort]);
  const onlineShown = source ? [] : snap.onlinePlaylists.filter((playlist) => !needle || fold(playlist.title).includes(needle));
  const online = useMemo(() => sortItems(onlineShown, sort, { name: (playlist) => playlist.title, date: (playlist) => playlist.savedAt, updated: (playlist) => playlist.savedAt, songCount: () => 0 }), [onlineShown, sort]);
  return (
    <section class="lib-view" aria-labelledby="lib-heading">
      <h1 id="lib-heading">{t('lib.cat.playlists')}</h1>
      <div class="lib-searchbar">
        <input {...focusProps('lib-search', 1, 0)} class="lib-search" type="search" value={query} placeholder={t('lib.search')} aria-label={t('lib.searchLabel')} onInput={(event) => setQuery(event.currentTarget.value)} />
      </div>
      <ActionRow row={2} actions={[
        ...(source ? [] : [{ id: 'create-playlist', label: t('pl.create'), icon: 'plus' as const, onClick: () => openOverlay('createPlaylist', { openerFocusId: 'detail-create-playlist' }) }]),
        ...sortButtons,
      ]} />
      {snap.status === 'loading' && <p class="message-state" role="status">{t('common.loading')}</p>}
      {snap.status === 'error' && snap.playlists.length === 0 && <LoadFailed />}
      {snap.status === 'ready' && sorted.length + online.length === 0 && <p class="message-state" role="status">{needle ? t('lib.noMatch') : t('pl.none')}</p>}
      <div class="result-list">
        <PlaylistRows playlists={sorted} startRow={3} idPrefix="lib-pl" />
        {online.map((playlist, index) => (
          <EntityRow key={playlist.key} id={`lib-onl-${index}`} row={3 + sorted.length + index} title={playlist.title} subtitle={playlist.subtitle} artworkUrl={playlist.artworkUrl}
            onOpen={() => navigate({ name: 'playlist', id: playlist.ref.id, origin: 'online' })}
            onMenu={() => actions.showActions(playlist.title, actions.entityActions(playlist.ref, playlist, { open: { name: 'playlist', id: playlist.ref.id, origin: 'online' } }), `lib-onl-${index}`)} />
        ))}
      </div>
    </section>
  );
}

const itemOf = (entity: SavedEntity): HomeItem => homeItemFromCatalog({
  kind: entity.ref.kind === 'artist' ? 'artist' : 'album', id: entity.ref.id, browseId: entity.ref.id, title: entity.title, subtitle: entity.subtitle, artworkUrl: entity.artworkUrl,
});

function SavedEntitiesPage({ kind }: { kind: 'albums' | 'artists' }) {
  const { t, navigate, pageCache } = useApp();
  const snap = useLibrarySnapshot();
  const actions = useLibraryActions();
  const queryKey = `library.${kind}.query`;
  const [query, setQueryState] = useState(() => pageCache.get<string>(queryKey) ?? '');
  const setQuery = (next: string) => { pageCache.set(queryKey, next); setQueryState(next); };
  const { sort, buttons: sortButtons } = useSort(kind);
  const needle = fold(query);
  const all = kind === 'albums' ? snap.albums : snap.artists;
  const metrics = useMemo(() => entityMetrics(snap, kind === 'albums' ? 'album' : 'artist'), [snap, kind]);
  const shown = useMemo(() => sortItems(all.filter((entity) => !needle || fold(`${entity.title} ${entity.subtitle ?? ''}`).includes(needle)), sort, {
    name: (entity) => entity.title,
    artist: (entity) => metrics.get(entity.ref.id)?.artist ?? entity.subtitle ?? '',
    date: (entity) => entity.savedAt,
    year: (entity) => yearOf(entity.subtitle),
    songCount: (entity) => metrics.get(entity.ref.id)?.songCount ?? 0,
    length: (entity) => metrics.get(entity.ref.id)?.length ?? 0,
    playTime: (entity) => metrics.get(entity.ref.id)?.playTime ?? 0,
  }), [all, needle, sort, metrics]);
  const columns = 6;
  return (
    <section class="lib-view" aria-labelledby="lib-heading">
      <h1 id="lib-heading">{kind === 'albums' ? t('lib.cat.albums') : t('lib.cat.artists')}</h1>
      <div class="lib-searchbar">
        <input {...focusProps('lib-search', 1, 0)} class="lib-search" type="search" value={query} placeholder={t('lib.search')} aria-label={t('lib.searchLabel')} onInput={(event) => setQuery(event.currentTarget.value)} />
      </div>
      {snap.status === 'loading' && <p class="message-state" role="status">{t('common.loading')}</p>}
      <ActionRow row={2} actions={sortButtons} />
      {snap.status === 'error' && all.length === 0 && <LoadFailed />}
      {snap.status === 'ready' && shown.length === 0 && <p class="message-state" role="status">{needle ? t('lib.noMatch') : t('lib.empty')}</p>}
      <div class="card-grid">
        {shown.map((entity, index) => {
          const open = kind === 'albums' ? ({ name: 'album', id: entity.ref.id } as const) : ({ name: 'artist', id: entity.ref.id, title: entity.title } as const);
          const id = `lib-${kind}-${index}`;
          return (
            <HomeCard key={entity.key} idPrefix={`lib-${kind}`} item={itemOf(entity)} rowIndex={3 + Math.floor(index / columns)} column={index % columns}
              onActivate={() => navigate(open)} onMenu={() => actions.showActions(entity.title, actions.entityActions(entity.ref, entity, { open }), `${id.replace(`lib-${kind}-${index}`, `lib-${kind}-${3 + Math.floor(index / columns)}-${index % columns}`)}`)} />
          );
        })}
      </div>
    </section>
  );
}
