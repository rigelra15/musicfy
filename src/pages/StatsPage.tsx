import { tr } from '../app/i18n';
import { useMemo, useState } from 'preact/hooks';
import { useApp } from '../app/AppContext';
import { focusProps } from '../app/format';
import { formatTotal } from '../features/detail/convert';
import { TrackList } from '../features/detail/ui';
import { CardArt } from '../features/home/ui/HomeCard';
import { aggregate, monthOf, recapAvailability, shiftRange, yearOf, type ListeningStats, type StatsRange } from '../features/stats/stats';
import { useHistory } from '../features/stats/useHistory';

const minutes = (ms: number) => formatTotal(ms) || tr('time.m', { m: 0 });

export function StatsPage() {
  const { t, language, services, playTracks, navigate } = useApp();
  const history = useHistory(services.repo);
  const today = useMemo(() => new Date(), []);
  const [range, setRange] = useState<StatsRange>(() => monthOf(today));
  const stats = useMemo(() => aggregate(range, history.events), [history.events, range]);
  const recap = useMemo(() => recapAvailability(history.events, today), [history.events, today]);
  const label = periodLabel(range, language);
  const isNow = range.kind === 'month' ? range.year === today.getFullYear() && range.month === today.getMonth() + 1 : range.year === today.getFullYear();
  const earliest = useMemo(() => history.events.reduce((min, event) => Math.min(min, event.startedAt), Date.now()), [history.events]);
  const first = new Date(earliest);
  const atStart = range.kind === 'month' ? range.year * 12 + range.month <= first.getFullYear() * 12 + first.getMonth() + 1 : range.year <= first.getFullYear();

  const recapText = recap.status === 'ready'
    ? t('stats.recapReady', { period: periodLabel(recap.range, language), percent: recap.progressPercent })
    : recap.unlockDay !== undefined ? t('stats.recapUnlockDay', { day: recap.unlockDay }) : t('stats.recapMissing', { count: recap.missingSongs });

  return (
    <section class="detail-view stats-view" aria-labelledby="stats-heading">
      <h1 id="stats-heading">{t('stats.title')}</h1>
      <div class="detail-actions" role="group" aria-label={t('stats.period')}>
        <button {...focusProps('stats-month', 1, 0)} class={`chip-button ${range.kind === 'month' ? 'is-on' : ''}`} aria-pressed={range.kind === 'month'} onClick={() => setRange(monthOf(new Date(range.year, range.kind === 'month' ? range.month - 1 : today.getMonth(), 1)))}>{t('stats.month')}</button>
        <button {...focusProps('stats-year', 1, 1)} class={`chip-button ${range.kind === 'year' ? 'is-on' : ''}`} aria-pressed={range.kind === 'year'} onClick={() => setRange(yearOf(new Date(range.year, 0, 1)))}>{t('stats.year')}</button>
        <button {...focusProps('stats-prev', 1, 2, atStart)} class="chip-button" onClick={() => setRange(shiftRange(range, -1))}>{t('stats.prev')}</button>
        <span class="stats-period" aria-live="polite">{label}</span>
        <button {...focusProps('stats-next', 1, 3, isNow)} class="chip-button" onClick={() => setRange(shiftRange(range, 1))}>{t('stats.next')}</button>
      </div>
      {history.status === 'error' && <p class="message-state" role="alert">{t('stats.loadFailed')}</p>}
      {history.status === 'ready' && (
        <div class="stats-recap">
          <span class="stats-recap-text"><strong>{t('stats.recap')}</strong> {recapText}</span>
          {recap.status === 'ready' && (
            <button {...focusProps('stats-recap', 2, 0)} class="chip-button" onClick={() => setRange(recap.range)}>{t('stats.openRecap')}</button>
          )}
        </div>
      )}
      {history.status === 'ready' && stats.isEmpty && <p class="message-state">{t('stats.empty')}</p>}
      {!stats.isEmpty && <StatsBody stats={stats} />}
      {!stats.isEmpty && stats.topSongs.length > 0 && (
        <>
          <h2 class="stats-heading">{t('stats.topSongs')}</h2>
          <TrackList tracks={stats.topSongs.map((song) => song.track)} startRow={10} idPrefix="stats-song" onPlay={(index) => playTracks(stats.topSongs.map((song) => song.track), index, 'playlist')} />
        </>
      )}
      {!stats.isEmpty && stats.topArtists.length > 0 && (
        <>
          <h2 class="stats-heading">{t('stats.topArtists')}</h2>
          <div class="result-list stats-artists">
            {stats.topArtists.slice(0, 10).map((artist, index) => {
              const id = artist.topSong?.track.artists?.find((a) => a.name.trim().toLowerCase() === artist.name.toLowerCase())?.id;
              return (
                <button {...focusProps(`stats-artist-${index}`, 10 + stats.topSongs.length + index, 0, !id)} class="result-row" key={artist.name} onClick={() => id && navigate({ name: 'artist', id, title: artist.name })}>
                  <span class="queue-index">{String(index + 1).padStart(2, '0')}</span>
                  <CardArt url={artist.artworkUrl} round />
                  <span class="result-copy"><span class="result-title">{artist.name}</span><span class="result-artist">{t('stats.playsCount', { count: artist.plays })}</span></span>
                  <span class="result-duration">{minutes(artist.playTimeMs)}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
      <p class="detail-note">{t('stats.private')}</p>
    </section>
  );
}

function StatsBody({ stats }: { stats: ListeningStats }) {
  const { t, language } = useApp();
  const monthly = stats.range.kind === 'month';
  const dayLabels = stats.bucketMs.map((_, i) => String(i + 1));
  const monthLabels = stats.bucketMs.map((_, i) => new Date(2024, i, 1).toLocaleDateString(language, { month: 'short' }));
  const weekdayLabels = stats.weekdayMs.map((_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(language, { weekday: 'short' }));
  const hourLabels = stats.hourMs.map((_, i) => String(i));
  const busiest = stats.busiestHour === undefined ? undefined : `${String(stats.busiestHour).padStart(2, '0')}.00`;
  return (
    <>
      <dl class="stats-facts">
        <div><dt>{t('stats.total')}</dt><dd>{minutes(stats.totalMs)}</dd></div>
        <div><dt>{t('stats.plays')}</dt><dd>{stats.plays}</dd></div>
        <div><dt>{t('stats.songs')}</dt><dd>{stats.songCount}</dd></div>
        <div><dt>{t('stats.artists')}</dt><dd>{stats.artistCount}</dd></div>
        <div><dt>{t('stats.albums')}</dt><dd>{stats.albumCount}</dd></div>
      </dl>
      <div class="stats-charts">
        <Bars id="stats-chart-bucket" row={3} title={monthly ? t('stats.byDay') : t('stats.byMonth')} values={stats.bucketMs} labels={monthly ? dayLabels : monthLabels} />
        <Bars id="stats-chart-weekday" row={4} title={t('stats.byWeekday')} values={stats.weekdayMs} labels={weekdayLabels} />
        <Bars id="stats-chart-hour" row={5} title={t('stats.byHour')} values={stats.hourMs} labels={hourLabels} />
      </div>
      {busiest && <p class="detail-note">{t('stats.busiest', { hour: busiest })}</p>}
    </>
  );
}

/** A bar chart that can take focus (so the D-pad can scroll to it) and says its numbers in words. */
function Bars({ id, row, title, values, labels }: { id: string; row: number; title: string; values: number[]; labels: string[] }) {
  const peak = Math.max(1, ...values);
  const summary = values.map((value, i) => (value > 0 ? `${labels[i]}: ${minutes(value)}` : '')).filter(Boolean).join(', ');
  return (
    <div {...focusProps(id, row, 0)} tabIndex={0} class="stats-chart" role="img" aria-label={`${title}. ${summary}`}>
      <h3>{title}</h3>
      <div class="stats-bars" aria-hidden="true">
        {values.map((value, i) => (
          <span class="stats-bar" key={i} style={{ '--bar': `${Math.max(value > 0 ? 4 : 0, Math.round((value / peak) * 100))}%` }}><i /></span>
        ))}
      </div>
      <div class="stats-axis" aria-hidden="true">{labels.map((label, i) => <span key={i}>{values.length > 12 && i % 5 !== 0 ? '' : label}</span>)}</div>
    </div>
  );
}

function periodLabel(range: StatsRange, language: string): string {
  return range.kind === 'month'
    ? new Date(range.year, range.month - 1, 1).toLocaleDateString(language, { month: 'long', year: 'numeric' })
    : String(range.year);
}
