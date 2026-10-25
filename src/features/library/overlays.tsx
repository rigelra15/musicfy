import { useEffect, useMemo, useState } from 'preact/hooks';
import { useApp } from '../../app/AppContext';
import { focusProps } from '../../app/format';
import { registerOverlay } from '../../app/OverlayHost';
import { trackKeyOf } from '../../domain/entity';
import type { Track } from '../../model';
import type { PlaylistPreview } from './data';

const MAX_NAME = 120;
const RECENT_COUNT = 4;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

interface CreateProps { mode?: 'create' | 'rename'; playlistId?: string; initialName?: string; tracks?: Track[] }

/** Create a playlist (optionally with songs already in it), or rename one. */
function PlaylistNameOverlay({ id, props, close }: { id: number; props: CreateProps; close(): void }) {
  const { t, services, toast } = useApp();
  const renaming = props.mode === 'rename' && props.playlistId;
  const [name, setName] = useState(props.initialName ?? '');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();

  async function submit() {
    if (busy) return;
    if (!trimmed) { setError(t('pl.nameEmpty')); return; }
    setBusy(true); setError(undefined);
    try {
      if (renaming) {
        await services.repo.renamePlaylist(props.playlistId!, trimmed);
        toast(t('pl.renamed'));
      } else {
        const created = await services.repo.createPlaylist(trimmed);
        const songs = props.tracks ?? [];
        if (songs.length > 0) await services.repo.addToPlaylist(created.id, songs);
        toast(songs.length > 0 ? t('pl.createdWith', { name: created.name, count: songs.length }) : t('pl.created', { name: created.name }));
      }
      close();
    } catch (failure) {
      setError(t('pl.failed', { message: message(failure) }));
      setBusy(false);
    }
  }

  return (
    <form class="overlay-panel" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h2>{renaming ? t('act.rename') : t('pl.create')}</h2>
      <div class="overlay-field">
        <label for={`ov${id}-name`}>{t('pl.name')}</label>
        <input
          {...focusProps(`ov${id}-name`, 1, 0)}
          class="overlay-input"
          type="text"
          maxLength={MAX_NAME}
          value={name}
          aria-invalid={error ? 'true' : undefined}
          onInput={(event) => { setName(event.currentTarget.value); setError(undefined); }}
        />
        {error && <p class="overlay-error" role="alert">{error}</p>}
      </div>
      <div class="overlay-actions">
        <button type="button" {...focusProps(`ov${id}-cancel`, 2, 0)} class="text-action" onClick={close}>{t('common.cancel')}</button>
        <button type="submit" {...focusProps(`ov${id}-save`, 2, 1, busy)} class="text-action">{renaming ? t('pl.save') : t('pl.createAction')}</button>
      </div>
    </form>
  );
}

registerOverlay('createPlaylist', (overlay, { close }) => <PlaylistNameOverlay id={overlay.id} props={(overlay.props ?? {}) as CreateProps} close={close} />);

function sections(playlists: PlaylistPreview[], query: string) {
  const needle = query.trim().toLowerCase();
  const byName = (a: PlaylistPreview, b: PlaylistPreview) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  if (needle) return { recents: [] as PlaylistPreview[], rest: playlists.filter((playlist) => playlist.name.toLowerCase().includes(needle)).sort(byName) };
  if (playlists.length <= RECENT_COUNT) return { recents: [], rest: [...playlists].sort(byName) };
  const recents = [...playlists].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT_COUNT);
  return { recents, rest: playlists.filter((playlist) => !recents.includes(playlist)).sort(byName) };
}

/** Pick the playlist songs go into; makes a new one on request and asks before adding duplicates. */
function AddToPlaylistOverlay({ id, opener, props, close }: { id: number; opener?: string; props: { tracks: Track[] }; close(): void }) {
  const { t, services, library, openOverlay, toast } = useApp();
  const [snapshot, setSnapshot] = useState(library.getSnapshot());
  useEffect(() => { setSnapshot(library.getSnapshot()); return library.subscribe(() => setSnapshot(library.getSnapshot())); }, [library]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const tracks = props.tracks;
  const { recents, rest } = useMemo(() => sections(snapshot.playlists, query), [snapshot.playlists, query]);

  async function pick(playlist: PlaylistPreview) {
    if (busy || tracks.length === 0) return;
    setBusy(true); setError(undefined);
    try {
      const keys = tracks.map((track) => trackKeyOf(track));
      const duplicates = await services.repo.findDuplicates(playlist.id, keys);
      if (duplicates.length > 0) {
        close();
        openOverlay('duplicates', { openerFocusId: opener, props: { playlistId: playlist.id, playlistName: playlist.name, tracks, duplicates } });
        return;
      }
      await services.repo.addToPlaylist(playlist.id, tracks);
      toast(tracks.length === 1 ? t('pl.added', { name: playlist.name }) : t('pl.addedMany', { count: tracks.length, name: playlist.name }));
      close();
    } catch (failure) {
      setError(t('pl.failed', { message: message(failure) }));
      setBusy(false);
    }
  }

  let row = 3;
  const item = (playlist: PlaylistPreview) => (
    <button {...focusProps(`ov${id}-pl-${playlist.id}`, row++, 0, busy)} class="overlay-item" key={playlist.id} onClick={() => void pick(playlist)}>
      <span>{playlist.name}</span>
      <small>{t('home.songsCount', { count: playlist.trackCount })}</small>
    </button>
  );
  return (
    <div class="overlay-panel">
      <h2>{t('pl.addTitle')}</h2>
      <div class="overlay-field">
        <label for={`ov${id}-q`} class="visually-hidden">{t('pl.search')}</label>
        <input {...focusProps(`ov${id}-q`, 1, 0)} class="overlay-input" type="search" placeholder={t('pl.search')} value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
      </div>
      <button {...focusProps(`ov${id}-new`, 2, 0, busy)} class="overlay-item" onClick={() => { close(); openOverlay('createPlaylist', { openerFocusId: opener, props: { tracks } }); }}>
        <span>{t('pl.create')}</span>
      </button>
      {error && <p class="overlay-error" role="alert">{error}</p>}
      {snapshot.status === 'loading' && <p class="overlay-body">{t('common.loading')}</p>}
      {snapshot.status === 'ready' && snapshot.playlists.length === 0 && <p class="overlay-body">{t('pl.none')}</p>}
      {snapshot.status === 'ready' && snapshot.playlists.length > 0 && rest.length + recents.length === 0 && <p class="overlay-body">{t('lib.noMatch')}</p>}
      <div class="overlay-list">
        {recents.length > 0 && <p class="overlay-subtitle">{t('pl.recent')}</p>}
        {recents.map(item)}
        {recents.length > 0 && rest.length > 0 && <p class="overlay-subtitle">{t('pl.others')}</p>}
        {rest.map(item)}
      </div>
    </div>
  );
}

registerOverlay('addToPlaylist', (overlay, { close }) => <AddToPlaylistOverlay id={overlay.id} opener={overlay.openerFocusId} props={(overlay.props ?? { tracks: [] }) as { tracks: Track[] }} close={close} />);

interface DuplicateProps { playlistId: string; playlistName: string; tracks: Track[]; duplicates: string[] }

registerOverlay('duplicates', (overlay, { close, t }) => {
  const props = overlay.props as unknown as DuplicateProps;
  return <DuplicatesOverlay id={overlay.id} props={props} close={close} t={t} />;
});

function DuplicatesOverlay({ id, props, close, t }: { id: number; props: DuplicateProps; close(): void; t: ReturnType<typeof useApp>['t'] }) {
  const { services, toast } = useApp();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const fresh = props.tracks.filter((track) => !props.duplicates.includes(trackKeyOf(track)));

  async function add(tracks: Track[]) {
    if (busy) return;
    setBusy(true); setError(undefined);
    try {
      if (tracks.length > 0) await services.repo.addToPlaylist(props.playlistId, tracks);
      toast(tracks.length === 0 ? t('pl.nothingNew') : tracks.length === 1 ? t('pl.added', { name: props.playlistName }) : t('pl.addedMany', { count: tracks.length, name: props.playlistName }));
      close();
    } catch (failure) {
      setError(t('pl.failed', { message: message(failure) }));
      setBusy(false);
    }
  }
  return (
    <div class="overlay-panel">
      <h2>{t('pl.dupTitle')}</h2>
      <p class="overlay-body">{props.duplicates.length === 1 ? t('pl.dupOne') : t('pl.dupMany', { count: props.duplicates.length })}</p>
      {error && <p class="overlay-error" role="alert">{error}</p>}
      <div class="overlay-actions">
        <button {...focusProps(`ov${id}-skip`, 1, 0, busy)} class="text-action" onClick={() => void add(fresh)}>{t('pl.skipDup')}</button>
        <button {...focusProps(`ov${id}-anyway`, 1, 1, busy)} class="text-action" onClick={() => void add(props.tracks)}>{t('pl.addAnyway')}</button>
        <button {...focusProps(`ov${id}-cancel`, 1, 2)} class="text-action" onClick={close}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}
