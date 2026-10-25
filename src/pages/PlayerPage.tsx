import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { EXIT_MS, motionAllowed } from '../app/motion';
import { useApp } from '../app/AppContext';
import { focusProps, formatDuration, formatPosition } from '../app/format';
import { Artwork } from '../components/Artwork';
import { Icon } from '../components/Icon';
import { ScrollText } from '../components/ScrollText';
import { LyricsView } from '../components/LyricsView';
import { PlayerBackdrop } from '../features/player/PlayerBackdrop';
import { PlayerDeck } from '../features/player/PlayerDeck';
import { QueuePanel } from '../features/player/QueuePanel';
import { flyFrom, rememberCover, takeCover } from '../features/player/sharedCover';
import { useSnapshot } from '../app/useSnapshot';
import { discLabelForTrack } from '../data/playerPreferences';
import { effectiveCover, endTimestamp, shiftPx } from '../features/studio/studio';
import { useStudio } from '../features/studio/useStudio';
import { usePlayerMenu } from '../features/playerMenu/actions';
import type { PlaybackSnapshot } from '../model';
import { PREF_FORMAT_BADGE, PREF_FORMAT_SAMPLE_RATE } from '../features/settings/prefs';
import { currentTrack, hasNext, hasPrevious } from '../playback/queueModel';

/** The short format tag next to the title ("OPUS", "AAC", "FLAC"): the codec the source really sent. */
function formatBadge(source: NonNullable<PlaybackSnapshot['source']>): string {
  const known = /\b(HE-AAC|AAC|OPUS|FLAC|ALAC|MP3|VORBIS|EAC3|AC-3|ATMOS)\b/i.exec(`${source.codec ?? ''} ${source.quality}`);
  const word = known?.[1] ?? source.codec ?? source.quality.split(/[ ·]+/).find((part) => /^[A-Za-z][A-Za-z0-9-]*$/.test(part) && !/^(hi|res|kbps|khz|lossless)$/i.test(part)) ?? source.label;
  return word.toUpperCase();
}
/** Everything the source said, for the tooltip and screen readers (never shown as a second line). */
function sourceDetail(source: NonNullable<PlaybackSnapshot['source']>): string {
  return `${source.label} · ${source.quality}${source.sampleRateHz ? ` · ${(source.sampleRateHz / 1000).toFixed(source.sampleRateHz % 1000 ? 1 : 0)} kHz` : ''}`;
}

export function PlayerPage() {
  const { store, dispatch, controls, audio, t, goTab, navigate, openOverlay, playerPanel, services } = useApp();
  const showBadge = services.prefs.get<boolean>(PREF_FORMAT_BADGE, true) !== false;
  const showRate = services.prefs.get<boolean>(PREF_FORMAT_SAMPLE_RATE, false) === true;
  const [menuHost, setMenuHost] = useState<HTMLElement | null>(null);
  const quickMenu = useRef<HTMLDetailsElement>(null);
  const heading = useRef<HTMLDivElement>(null);
  const quickPanel = useRef<HTMLDivElement>(null);
  // Bound the popup to the space between the navbar and the deck, including portalled lyric options.
  const placeQuickMenu = () => {
    if (!quickMenu.current?.open || !heading.current || !quickPanel.current) return;
    const box = heading.current.getBoundingClientRect();
    const navBottom = document.querySelector('.app-topbar')?.getBoundingClientRect().bottom ?? 0;
    const deckTop = document.querySelector('.player-deck')?.getBoundingClientRect().top ?? window.innerHeight;
    const scale = box.width / heading.current.offsetWidth || 1;
    const above = Math.max(0, (box.top - navBottom) / scale - 16);
    const below = Math.max(0, (deckTop - box.bottom) / scale - 16);
    const upwards = above >= below;
    quickPanel.current.style.maxHeight = `${upwards ? above : below}px`;
    quickPanel.current.style.bottom = upwards ? 'calc(100% + 10px)' : 'auto';
    quickPanel.current.style.top = upwards ? 'auto' : 'calc(100% + 10px)';
  };
  useEffect(() => {
    window.addEventListener('resize', placeQuickMenu);
    window.addEventListener('scroll', placeQuickMenu, true);
    return () => { window.removeEventListener('resize', placeQuickMenu); window.removeEventListener('scroll', placeQuickMenu, true); };
  }, []);
  const menu = usePlayerMenu();
  const { settings } = useStudio();
  const cover = effectiveCover(settings);
  const { queue, playback } = store.root;
  const track = currentTrack(queue);
  const panel = useSnapshot(playerPanel);
  const coverFrame = useRef<HTMLDivElement>(null);
  // The cover grows out of the mini player when the page opens, and the mini player takes it back when the page closes.
  useLayoutEffect(() => {
    const note = takeCover('toPlayer');
    if (note) flyFrom(coverFrame.current, note);
    return () => rememberCover(coverFrame.current, 'toMini');
  }, []);

  if (!track) {
    return (
      <section class="player-view" aria-labelledby="player-heading">
        <div class="empty-view">
          <h2 id="player-heading">{t('player.empty')}</h2>
          <button {...focusProps('player-empty-search', 1, 0)} class="text-action" onClick={() => goTab('search')}>{t('common.search')}</button>
        </div>
      </section>
    );
  }
  // Links replace the plain artist text only when every artist can be opened; otherwise all names stay as text.
  const withIds = (track.artists ?? []).filter((artist) => artist.id);
  const artistLinks = withIds.length > 0 && withIds.length === (track.artists ?? []).length ? withIds : [];
  const artistText = artistLinks.length > 0 ? artistLinks.map((artist) => artist.name).join(', ') : track.artist;
  const durationMs = playback.durationMs || track.durationMs || 0;
  const positionMs = Math.min(playback.positionMs, durationMs);
  const percent = durationMs > 0 ? Math.round((positionMs / durationMs) * 100) : 0;
  const busy = playback.status === 'playing' || playback.status === 'buffering';
  const idle = playback.status === 'loading' || playback.status === 'idle';
  const showLabels = settings.buttonStyle === 'M3_EXPRESSIVE';

  return (
    <section class={`player-view ${settings.reducedMotion ? 'is-reduced-motion' : ''}`} aria-labelledby="player-heading">
      <PlayerBackdrop url={track.artworkUrl} />
      <PlayerDeck />
      <div class={`player-layout player-with-lyrics preset-${settings.preset.toLowerCase()}`}>
        <div class={`player-card buttons-${settings.buttonStyle.toLowerCase().replace(/_/g, '-')}`} style={`--controls-shift:${shiftPx(settings)}px`}>
          <div class="player-cover-frame" ref={coverFrame}>
            <Artwork track={track} size="large" style={cover} playing={playback.status === 'playing'} rotating={settings.rotation && !settings.reducedMotion} realistic={settings.realistic} label={discLabelForTrack(track, settings)} />
          </div>
          <div class="player-details">
            <div class="player-heading-actions" ref={heading}>
              <div class="player-summary">
                <div class="player-title-row">
                  <h2 id="player-heading"><ScrollText text={track.title} reducedMotion={settings.reducedMotion} /></h2>
                </div>
                <div class="player-artist-row">
                  <p class="player-artist">
                    <ScrollText text={artistText} reducedMotion={settings.reducedMotion}>
                      {artistLinks.length > 0 ? artistLinks.map((artist, index) => (
                        <span key={`${artist.id}:${index}`}>
                          {index > 0 && ', '}
                          <button {...focusProps(`player-artist-${index}`, 1, index)} class="inline-link" onClick={() => navigate({ name: 'artist', id: artist.id!, title: artist.name })}>{artist.name}</button>
                        </span>
                      )) : track.artist}
                    </ScrollText>
                  </p>
                  {playback.source && showBadge && (
                    <span class="format-badge" title={sourceDetail(playback.source)} aria-label={`${t('player.source')}: ${sourceDetail(playback.source)}`}>{formatBadge(playback.source)}{showRate && playback.source.sampleRateHz ? ` · ${(playback.source.sampleRateHz / 1000).toFixed(playback.source.sampleRateHz % 1000 ? 1 : 0)} kHz` : ''}</span>
                  )}
                </div>
              </div>
              <div class="player-secondary-controls">
                {(() => {
                  const side = menu.info[menu.layout.side];
                  return (
                    <button {...focusProps(menu.opener(side.id), 1, 10)} id={menu.opener(side.id)} class={`icon-button player-side ${side.active ? 'is-on' : ''}`} aria-label={side.label} aria-pressed={side.active} aria-disabled={side.unavailable ? 'true' : undefined} onClick={() => menu.run(side.id)}>
                      <Icon name={side.icon} />
                    </button>
                  );
                })()}
                <details class="player-menu" ref={quickMenu} onToggle={placeQuickMenu}>
                  <summary {...focusProps('player-more', 1, 11)} aria-label={t('player.options')} onClick={(event) => {
                    // Closing eases out (the panel fades and drops) before the menu really closes.
                    const menuElement = quickMenu.current;
                    if (!menuElement?.open || !motionAllowed()) return;
                    event.preventDefault();
                    menuElement.classList.add('is-closing');
                    setTimeout(() => { menuElement.open = false; menuElement.classList.remove('is-closing'); }, EXIT_MS - 20);
                  }}><Icon name="ellipsis" /></summary>
                  <div class="player-menu-panel" ref={quickPanel}>
                    <div class="pm-quick" role="group" aria-label={t('pm.menu')}>
                      {menu.layout.slots.map((id, index) => {
                        const action = menu.info[id];
                        return (
                          <button {...focusProps(menu.opener(id), 4.2, index)} id={menu.opener(id)} class={`pm-quick-button ${action.active ? 'is-on' : ''}`} aria-pressed={action.active} aria-disabled={action.unavailable ? 'true' : undefined} key={id} onClick={() => { if (quickMenu.current) quickMenu.current.open = false; menu.run(id); }}>
                            <Icon name={action.icon} />
                            <span>{action.label}{action.detail ? ` · ${action.detail}` : ''}</span>
                          </button>
                        );
                      })}
                    </div>
                    <button {...focusProps('player-edit-menu', 4.4, 0)} class="chip-button pm-edit" onClick={() => { if (quickMenu.current) quickMenu.current.open = false; openOverlay('menuSlots', { openerFocusId: 'player-more' }); }}>{t('pm.edit')}</button>
                    <div ref={setMenuHost} />
                  </div>
                </details>
              </div>
            </div>
            <div class={`player-progress seek seek-${settings.seekBarStyle.toLowerCase().replace(/_/g, '-')} ${busy ? 'is-playing' : ''}`} aria-label={t('player.position')} style={`--progress:${percent}%`}>
              <div class="seek-visual" aria-hidden="true"><span class="seek-rest" /><span class="seek-played" /></div>
              <input
                {...focusProps('player-seek', 2, 1, idle)}
                class="progress-rail"
                type="range"
                min="0"
                max={Math.max(durationMs, 1000)}
                step="1000"
                value={positionMs}
                aria-label={t('player.position')}
                onInput={(event) => controls.seekTo(Number(event.currentTarget.value))}
              />
              <span class="progress-times"><span>{formatPosition(positionMs)}</span><span>{endTimestamp(settings, positionMs, durationMs, formatDuration)}</span></span>
            </div>
            <div class="player-controls">
              <button {...focusProps('previous-track', 3, 0, !hasPrevious(queue))} class="transport-button icon-button" aria-label={t('common.previous')} onClick={() => dispatch({ type: 'queue/previous' })}><Icon name="skip-back" />{showLabels && <span class="button-label">{t('player.prev.label')}</span>}</button>
              <button
                {...focusProps('play-track', 3, 1, idle)}
                class="play-button icon-button"
                aria-label={busy ? t('common.pause') : playback.status === 'error' ? t('common.retry') : t('common.play')}
                onClick={controls.toggle}
              >
                <Icon name={busy ? 'pause' : playback.status === 'error' ? 'rotate-ccw' : 'play'} />
                {showLabels && <span class="button-label">{busy ? t('common.pause') : playback.status === 'error' ? t('common.retry') : t('common.play')}</span>}
              </button>
              <button {...focusProps('next-track', 3, 2, !hasNext(queue))} class="transport-button icon-button" aria-label={t('common.next')} onClick={() => dispatch({ type: 'queue/next', reason: 'user' })}><Icon name="skip-forward" />{showLabels && <span class="button-label">{t('player.next.label')}</span>}</button>
            </div>
            {(playback.error || playback.status === 'loading' || playback.status === 'buffering') && (
              <p class="player-status" role="status">{playback.error ?? (playback.status === 'loading' ? t('common.loading') : t('player.waiting'))}</p>
            )}
          </div>
        </div>
        {panel === 'queue'
          ? <QueuePanel />
          : <LyricsView track={track} positionMs={positionMs} audio={audio} playing={playback.status === 'playing'} menuHost={menuHost} />}
      </div>
    </section>
  );
}
