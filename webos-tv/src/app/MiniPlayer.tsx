import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useApp } from './AppContext';
import { flyFrom, rememberCover, takeCover } from '../features/player/sharedCover';
import { Artwork } from '../components/Artwork';
import { Icon } from '../components/Icon';
import { focusProps, formatDuration, formatPosition } from './format';
import { currentRoute } from './router';
import { currentTrack, hasNext } from '../playback/queueModel';
import { EXIT_MS, motionAllowed } from './motion';

/** Row far below any page content, so Down from a page lands here and Up leaves it. */
const MINI_ROW = 900;

export function MiniPlayer() {
  const { store, dispatch, controls, t, goTab } = useApp();
  const track = currentTrack(store.root.queue);
  const route = currentRoute(store.nav);
  const visible = Boolean(track) && route.name !== 'player';
  const aside = useRef<HTMLElement>(null);
  // Coming back from the player, the cover flies down from where it was.
  useLayoutEffect(() => {
    if (!visible) return;
    const note = takeCover('toMini');
    if (note) flyFrom(aside.current?.querySelector<HTMLElement>('.artwork'), note);
  }, [visible]);
  // When it goes away it stays a moment longer so it can sink and fade out.
  const lastTrack = useRef(track);
  if (track) lastTrack.current = track;
  const wasVisible = useRef(visible);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (visible) { setLeaving(false); wasVisible.current = true; return; }
    if (!wasVisible.current || !motionAllowed()) { wasVisible.current = false; return; }
    wasVisible.current = false;
    setLeaving(true);
    const timer = setTimeout(() => setLeaving(false), EXIT_MS + 60);
    return () => clearTimeout(timer);
  }, [visible]);
  const shown = visible ? track : leaving ? lastTrack.current : null;
  if (!shown) return null;
  const track_ = shown;
  const { playback } = store.root;
  const busy = playback.status === 'playing' || playback.status === 'buffering';
  const duration = playback.durationMs || track_.durationMs || 0;
  const percent = duration > 0 ? Math.min(100, Math.round((playback.positionMs / duration) * 100)) : 0;
  const idle = playback.status === 'loading' || playback.status === 'idle';
  return (
    <aside class={`mini-player ${visible ? '' : 'is-leaving'}`} inert={visible ? undefined : true} aria-label={t('nav.player')} ref={aside}>
      <div class="mini-progress" style={`--progress:${percent}%`} aria-hidden="true" />
      <button {...focusProps('mini-open', MINI_ROW, 0)} class="mini-open" aria-label={t('mini.open')} onClick={() => { rememberCover(aside.current?.querySelector('.artwork'), 'toPlayer'); goTab('player'); }}>
        <Artwork track={track_} size="small" />
        <span class="result-copy"><span class="result-title">{track_.title}</span><span class="result-artist">{track_.artist}</span></span>
      </button>
      <div class="mini-controls">
        {duration > 0 && <span class="mini-time" aria-label={t('mini.time', { position: formatPosition(playback.positionMs), total: formatDuration(duration) })}>{formatPosition(Math.min(playback.positionMs, duration))} / {formatDuration(duration)}</span>}
        <button {...focusProps('mini-toggle', MINI_ROW, 1, idle)} class="icon-button" aria-label={busy ? t('common.pause') : t('common.play')} onClick={controls.toggle}><Icon name={busy ? 'pause' : 'play'} /></button>
        <button {...focusProps('mini-next', MINI_ROW, 2, !hasNext(store.root.queue))} class="icon-button" aria-label={t('common.next')} onClick={() => dispatch({ type: 'queue/next', reason: 'user' })}><Icon name="skip-forward" /></button>
      </div>
    </aside>
  );
}
