import { useMemo, useState } from 'preact/hooks';
import { useApp } from '../app/AppContext';
import { ChunkedList } from '../app/ChunkedList';
import { focusProps } from '../app/format';
import { contentFilters } from '../features/detail/browse';
import { formatTotal } from '../features/detail/convert';
import { ActionRow, DetailHero, TrackRow } from '../features/detail/ui';
import { useLibraryActions } from '../features/library/actions';
import { groupHistory, type HistoryGroup } from '../features/stats/stats';
import { useHistory } from '../features/stats/useHistory';
import { DEFAULT_HISTORY_SECONDS, PREF_HISTORY_PAUSED, PREF_HISTORY_SECONDS } from '../playback/listening';
import type { Track } from '../model';

type Row = { kind: 'header'; key: string; label: string } | { kind: 'track'; key: string; track: Track; index: number };

export function HistoryPage() {
  const { t, language, services, playTracks, openOverlay, toast } = useApp();
  const { songActions } = useLibraryActions();
  const history = useHistory(services.repo);
  const [query, setQuery] = useState('');
  const paused = services.prefs.get<boolean>(PREF_HISTORY_PAUSED, false) === true;
  const hideVideos = contentFilters(services.prefs).hideVideoSongs;
  const needle = query.trim().toLowerCase();

  const { rows, tracks } = useMemo(() => {
    const events = needle
      ? history.events.filter((event) => event.track && `${event.track.title} ${event.track.artist}`.toLowerCase().includes(needle))
      : history.events;
    const groups = groupHistory(events, Date.now(), { hideVideos });
    const flat: Track[] = [];
    const list: Row[] = [];
    for (const group of groups) {
      list.push({ kind: 'header', key: `h-${group.key}`, label: groupLabel(group, t, language) });
      for (const event of group.events) {
        if (!event.track) continue;
        list.push({ kind: 'track', key: event.id, track: event.track, index: flat.length });
        flat.push(event.track);
      }
    }
    return { rows: list, tracks: flat };
  }, [history.events, needle, hideVideos, language]);

  const totalMs = useMemo(() => history.events.reduce((sum, event) => sum + event.listenedMs, 0), [history.events]);
  const distinct = useMemo(() => new Set(history.events.map((event) => event.trackKey)).size, [history.events]);
  const seconds = Number(services.prefs.get(PREF_HISTORY_SECONDS, DEFAULT_HISTORY_SECONDS));

  const clear = () => openOverlay('confirm', {
    props: {
      title: t('history.clear'),
      body: t('history.clearBody'),
      confirmLabel: t('history.clear'),
      onConfirm: () => { void services.repo.clearHistory().then(() => toast(t('history.cleared'))).catch(() => toast(t('history.loadFailed'))); },
    },
  });
  const togglePause = () => { void services.prefs.set(PREF_HISTORY_PAUSED, !paused).catch(() => undefined); };
  const empty = history.status === 'ready' && history.events.length === 0;

  return (
    <section class="detail-view history-view" aria-labelledby="history-heading">
      <DetailHero
        title={t('history.title')}
        meta={history.status === 'ready' && !empty ? <div class="detail-meta"><p class="detail-sub">{t('history.summary', { count: distinct, time: formatTotal(totalMs) || t('time.m', { m: 0 }) })}</p></div> : undefined}
      >
        <ActionRow actions={[
          { id: 'play', label: t('common.play'), icon: 'play', onClick: () => playTracks(tracks, 0, 'playlist'), disabled: tracks.length === 0 },
          { id: 'shuffle', label: t('detail.shuffle'), icon: 'shuffle', onClick: () => playTracks(tracks, 0, 'playlist', { shuffle: true }), disabled: tracks.length === 0 },
          { id: 'pause', label: paused ? t('history.resume') : t('history.pause'), icon: 'clock', pressed: paused, onClick: togglePause },
          { id: 'clear', label: t('history.clear'), icon: 'trash-2', onClick: clear, disabled: history.events.length === 0 },
        ]} />
      </DetailHero>
      {paused && <p class="detail-note" role="status">{t('history.pausedNote')}</p>}
      {history.status === 'error' && <p class="message-state" role="alert">{t('history.loadFailed')}</p>}
      {empty && <p class="message-state">{t('history.empty', { seconds })}</p>}
      {history.events.length > 0 && (
        <div class="lib-searchbar">
          <input {...focusProps('history-search', 4, 0)} class="lib-search" type="search" value={query} placeholder={t('history.search')} aria-label={t('history.searchLabel')} onInput={(event) => setQuery(event.currentTarget.value)} />
        </div>
      )}
      {history.events.length > 0 && rows.length === 0 && <p class="message-state">{t('history.noMatch')}</p>}
      <ChunkedList class="result-list detail-tracks" chunk={40} items={rows} ariaLabel={t('history.title')} render={(row, position) => row.kind === 'header'
        ? <h2 class="history-group">{row.label}</h2>
        : <TrackRow track={row.track} index={row.index} row={5 + position} idPrefix="history-t" numbered={false} onPlay={(index) => playTracks(tracks, index, 'playlist')} menu={(track) => songActions(track)} />} />
    </section>
  );
}

function groupLabel(group: HistoryGroup, t: ReturnType<typeof useApp>['t'], language: string): string {
  switch (group.key) {
    case 'today': return t('history.today');
    case 'yesterday': return t('history.yesterday');
    case 'thisWeek': return t('history.thisWeek');
    case 'lastWeek': return t('history.lastWeek');
    default: return group.month ? new Date(group.month.year, group.month.month - 1, 1).toLocaleDateString(language, { month: 'long', year: 'numeric' }) : group.key;
  }
}
