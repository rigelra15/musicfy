import { capabilityReason } from '../../platform/capabilities';
import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../../app/AppContext';
import { focusProps } from '../../app/format';
import { registerOverlay } from '../../app/OverlayHost';
import { useSnapshot } from '../../app/useSnapshot';
import { Artwork } from '../../components/Artwork';
import { Icon } from '../../components/Icon';
import { trackKeyOf } from '../../domain/entity';
import { MAX_RATE, MIN_RATE, clampRate, descriptionOf } from '../../playback/htmlAudioPlayer';
import { currentTrack } from '../../playback/queueModel';
import { MENU_ACTIONS, SIDE_SLOT, actionAt, type MenuAction } from './layout';
import { usePlayerMenu } from './actions';
import { PREF_SPEED } from './prefs';
import { PREF_READINGS } from '../../lyrics/store';
import { formatRemaining } from './sleepTimer';

type Props = { id: number; close(): void };

/** One row of an overlay list: label, optional state, optional reason it does nothing. */
export function Row({ id, row, label, detail, note, selected, onSelect }: { id: string; row: number; label: string; detail?: string; note?: string; selected?: boolean; onSelect(): void }) {
  return (
    <button {...focusProps(id, row, 0)} class={`overlay-item ${selected ? 'is-selected' : ''}`} aria-current={selected ? 'true' : undefined} aria-disabled={note ? 'true' : undefined} onClick={onSelect}>
      <span>{label}{detail && <em class="overlay-detail"> · {detail}</em>}</span>
      {selected && <Icon name="check" />}
      {note && <small>{note}</small>}
    </button>
  );
}

function SongHeader() {
  const { store } = useApp();
  const track = currentTrack(store.root.queue);
  if (!track) return null;
  return (
    <div class="pm-song">
      <Artwork track={track} size="small" />
      <span class="result-copy"><span class="result-title">{track.title}</span><span class="result-artist">{track.artist}</span></span>
    </div>
  );
}

// ---- Other menu ---------------------------------------------------------------------------

function OtherMenu({ id, close }: Props) {
  const { store, t, services, library, lyrics, toast, openOverlay } = useApp();
  const menu = usePlayerMenu();
  const snapshot = useSnapshot(library);
  const track = currentTrack(store.root.queue);
  const key = track ? trackKeyOf(track) : '';
  const inLibrary = snapshot.libraryKeys.has(key);
  const failed = (error: unknown) => toast(t('toast.failed', { message: error instanceof Error ? error.message : String(error) }));
  const then = (action: () => void) => () => { close(); action(); };
  const via = (action: MenuAction) => then(() => menu.run(action));
  const item = (action: MenuAction) => menu.info[action];
  let row = 0;
  const next = () => (row += 1);

  return (
    <div class="overlay-panel">
      <h2>{t('pm.title')}</h2>
      <SongHeader />
      <div class="overlay-list">
        <Row id={`ov${id}-ai`} row={next()} label={t('lyrics.tools.ai')} note={t('lyrics.tools.aiOff')} onSelect={() => toast(t('lyrics.tools.aiOff'))} />
        <Row id={`ov${id}-lyedit`} row={next()} label={t('lyrics.tools.edit')} onSelect={then(() => openOverlay('lyricsEditor', { openerFocusId: menu.opener('OTHER_MENU') }))} />
        <Row id={`ov${id}-lyprovider`} row={next()} label={t('lyrics.tools.provider')} onSelect={then(() => openOverlay('lyricsProvider', { openerFocusId: menu.opener('OTHER_MENU') }))} />
        <Row id={`ov${id}-lytranslate`} row={next()} label={t('lyrics.tools.translate')} detail={menu.info.TRANSLATE_LYRICS.detail} selected={menu.info.TRANSLATE_LYRICS.active} onSelect={then(() => openOverlay('lyricsTranslate', { openerFocusId: menu.opener('OTHER_MENU') }))} />
        <Row id={`ov${id}-lyreadings`} row={next()} label={t('lyrics.tools.readings')} detail={lyrics.readings ? t('lyrics.tools.readingsOn') : t('lyrics.tools.readingsOff')} note={t('lyrics.tools.readingsNote')} onSelect={() => { void services.prefs.set(PREF_READINGS, !lyrics.readings).catch(failed); }} />
        <Row id={`ov${id}-playlist`} row={next()} label={item('ADD_TO_PLAYLIST').label} note={item('ADD_TO_PLAYLIST').unavailable} onSelect={via('ADD_TO_PLAYLIST')} />
        <Row id={`ov${id}-download`} row={next()} label={item('DOWNLOAD').label} note={item('DOWNLOAD').unavailable} onSelect={via('DOWNLOAD')} />
        <Row id={`ov${id}-output`} row={next()} label={t('pm.output.title')} onSelect={via('OUTPUT')} />
        <Row id={`ov${id}-sleep`} row={next()} label={item('SLEEP_TIMER').label} detail={item('SLEEP_TIMER').detail} onSelect={via('SLEEP_TIMER')} />
        <Row id={`ov${id}-awake`} row={next()} label={item('KEEP_AWAKE').label} selected={item('KEEP_AWAKE').active} note={item('KEEP_AWAKE').unavailable} onSelect={via('KEEP_AWAKE')} />
        <Row id={`ov${id}-speed`} row={next()} label={t('pm.speed.title')} detail={item('SPEED').detail} note={item('SPEED').unavailable} onSelect={via('SPEED')} />
        <Row id={`ov${id}-like`} row={next()} label={item('LIKE').active ? t('act.unlike') : t('act.like')} selected={item('LIKE').active} note={item('LIKE').unavailable} onSelect={via('LIKE')} />
        <Row
          id={`ov${id}-library`}
          row={next()}
          label={inLibrary ? t('act.removeLibrary') : t('act.saveLibrary')}
          selected={inLibrary}
          note={track ? undefined : t('pm.noTrack')}
          onSelect={then(() => {
            if (!track) return;
            const work = inLibrary ? services.repo.removeFromLibrary(key) : services.repo.addToLibrary(track);
            void work.then(() => toast(inLibrary ? t('toast.removedLibrary') : t('toast.savedLibrary'))).catch(failed);
          })}
        />
        <Row id={`ov${id}-details`} row={next()} label={t('pm.details')} note={track ? undefined : t('pm.noTrack')} onSelect={then(() => { if (track) openOverlay('songDetails', { openerFocusId: menu.opener('OTHER_MENU') }); })} />
        <Row id={`ov${id}-edit`} row={next()} label={t('pm.editPlayer')} onSelect={then(() => openOverlay('studio', { openerFocusId: menu.opener('OTHER_MENU') }))} />
        <Row id={`ov${id}-slots`} row={next()} label={t('pm.edit')} onSelect={then(() => openOverlay('menuSlots', { openerFocusId: menu.opener('OTHER_MENU') }))} />
      </div>
    </div>
  );
}

// ---- Sleep timer --------------------------------------------------------------------------

function SleepOverlay({ id, close }: Props) {
  const { t, sleep, toast } = useApp();
  const state = useSnapshot(sleep);
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(30);
  const [, tick] = useState(0);
  useEffect(() => {
    if (state.deadlineAt === undefined) return;
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [state.deadlineAt]);
  const total = hours * 60 + minutes;
  const active = state.deadlineAt !== undefined || state.atSongEnd;

  return (
    <div class="overlay-panel">
      <h2>{t('pm.sleep.title')}</h2>
      {active && (
        <p class="overlay-body" role="status">{state.deadlineAt !== undefined ? t('pm.sleep.left', { time: formatRemaining(sleep.remainingMs()) }) : t('pm.sleep.songEndOn')}</p>
      )}
      <label class="pm-slider"><span>{t('pm.sleep.hours')}</span><strong>{hours}</strong>
        <input {...focusProps(`ov${id}-hours`, 1, 0)} type="range" min="0" max="23" step="1" value={hours} aria-label={t('pm.sleep.hours')} onInput={(event) => setHours(Number(event.currentTarget.value))} />
      </label>
      <label class="pm-slider"><span>{t('pm.sleep.minutes')}</span><strong>{minutes}</strong>
        <input {...focusProps(`ov${id}-minutes`, 2, 0)} type="range" min="0" max="59" step="1" value={minutes} aria-label={t('pm.sleep.minutes')} onInput={(event) => setMinutes(Number(event.currentTarget.value))} />
      </label>
      <div class="overlay-actions">
        <button {...focusProps(`ov${id}-set`, 3, 0, total < 1)} class="text-action" onClick={() => { if (sleep.start(total)) { toast(t('pm.sleep.toast', { minutes: total })); close(); } }}>{t('pm.sleep.set')}</button>
      </div>
      <p class="overlay-or">{t('pm.sleep.or')}</p>
      <div class="overlay-actions">
        <button {...focusProps(`ov${id}-songend`, 4, 0)} class="text-action" onClick={() => { sleep.startAtSongEnd(); toast(t('pm.sleep.toastEnd')); close(); }}>{t('pm.sleep.songEnd')}</button>
      </div>
      {active && (
        <div class="overlay-actions">
          <button {...focusProps(`ov${id}-cancel`, 5, 0)} class="text-action" onClick={() => { sleep.clear(); toast(t('pm.sleep.off')); close(); }}>{t('pm.sleep.cancel')}</button>
        </div>
      )}
    </div>
  );
}

// ---- Speed --------------------------------------------------------------------------------

const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function SpeedOverlay({ id }: Props) {
  const { t, services, controls } = useApp();
  const stored = clampRate(Number(services.prefs.get(PREF_SPEED, 1)));
  const [rate, setRate] = useState(stored);
  const pitch = services.capabilities.get('audio.pitch');
  const apply = (next: number, persist: boolean) => {
    const value = clampRate(next);
    setRate(value);
    controls.setSpeed(value);
    if (persist) void services.prefs.set(PREF_SPEED, value).catch(() => undefined);
  };
  return (
    <div class="overlay-panel">
      <h2>{t('pm.speed.title')}</h2>
      <label class="pm-slider"><span>{t('pm.speed.speed')}</span><strong>{rate.toFixed(2).replace(/0$/, '')}×</strong>
        <input {...focusProps(`ov${id}-speed`, 1, 0)} type="range" min={MIN_RATE} max={MAX_RATE} step="0.05" value={rate} aria-label={t('pm.speed.speed')} onInput={(event) => apply(Number(event.currentTarget.value), false)} onChange={(event) => apply(Number(event.currentTarget.value), true)} />
      </label>
      <div class="detail-actions" role="group">
        {PRESETS.map((preset, column) => (
          <button {...focusProps(`ov${id}-p${preset}`, 2, column)} class={`chip-button ${rate === preset ? 'is-on' : ''}`} aria-pressed={rate === preset} key={preset} onClick={() => apply(preset, true)}>{preset}×</button>
        ))}
      </div>
      <label class="pm-slider is-disabled"><span>{t('pm.speed.pitch')}</span><strong>1×</strong>
        <input {...focusProps(`ov${id}-pitch`, 3, 0, pitch.status !== 'supported')} type="range" min="0.25" max="3" step="0.05" value="1" disabled aria-label={t('pm.speed.pitch')} />
      </label>
      {pitch.status !== 'supported' && <p class="overlay-body">{capabilityReason(pitch)}</p>}
      <div class="overlay-actions">
        <button {...focusProps(`ov${id}-reset`, 4, 0, rate === 1)} class="text-action" onClick={() => apply(1, true)}>{t('pm.speed.reset')}</button>
      </div>
    </div>
  );
}

// ---- Device output ------------------------------------------------------------------------

function OutputOverlay({ id, close }: Props) {
  const { t, services, controls } = useApp();
  const device = services.capabilities.get('system.outputDevice');
  const volume = services.capabilities.get('system.volume');
  return (
    <div class="overlay-panel">
      <h2>{t('pm.output.title')}</h2>
      <label class="pm-slider"><span>{t('pm.output.appVolume')}</span><strong>{Math.round(controls.volume * 100)}%</strong>
        <input {...focusProps(`ov${id}-volume`, 1, 0)} type="range" min="0" max="1" step="0.05" value={controls.volume} aria-label={t('pm.output.appVolume')} onInput={(event) => controls.setVolume(Number(event.currentTarget.value))} />
      </label>
      <h3 class="overlay-sub">{t('pm.output.device')}</h3>
      {[volume, device].filter((capability) => capability.status !== 'supported').map((capability) => <p class="overlay-body" key={capability.id}>{capabilityReason(capability)}</p>)}
      <div class="overlay-actions">
        <button {...focusProps(`ov${id}-done`, 2, 0)} class="text-action" onClick={close}>{t('pm.done')}</button>
      </div>
    </div>
  );
}

// ---- Song details and About song ----------------------------------------------------------

function SongDetails({ id, close }: Props) {
  const { store, t, navigate, openOverlay } = useApp();
  const track = currentTrack(store.root.queue);
  if (!track) return <div class="overlay-panel"><h2>{t('pm.details')}</h2><p class="overlay-body">{t('pm.noTrack')}</p></div>;
  const artists = (track.artists ?? []).filter((artist) => artist.id);
  let row = 0;
  return (
    <div class="overlay-panel">
      <h2>{t('pm.details')}</h2>
      <SongHeader />
      <div class="overlay-list">
        {artists.map((artist) => (
          <Row key={artist.id} id={`ov${id}-artist-${artist.id}`} row={(row += 1)} label={t('pm.view', { name: artist.name })} onSelect={() => { close(); navigate({ name: 'artist', id: artist.id!, title: artist.name }); }} />
        ))}
        {track.albumId && track.album && (
          <Row id={`ov${id}-album`} row={(row += 1)} label={t('pm.view', { name: track.album })} onSelect={() => { close(); navigate({ name: 'album', id: track.albumId! }); }} />
        )}
        <Row id={`ov${id}-about`} row={(row += 1)} label={t('pm.about')} onSelect={() => openOverlay('aboutSong')} />
      </div>
      <div class="overlay-actions">
        <button {...focusProps(`ov${id}-done`, row + 1, 0)} class="text-action" onClick={close}>{t('pm.done')}</button>
      </div>
    </div>
  );
}

function AboutSong({ id, close }: Props) {
  const { store, t } = useApp();
  const track = currentTrack(store.root.queue);
  const description = track ? descriptionOf(track.id) : undefined;
  return (
    <div class="overlay-panel">
      <h2>{t('pm.about')}</h2>
      <SongHeader />
      <pre {...focusProps(`ov${id}-text`, 1, 0)} tabIndex={0} data-scrollable="true" class="pm-about">{description ?? t('pm.aboutNone')}</pre>
      <div class="overlay-actions">
        <button {...focusProps(`ov${id}-done`, 2, 0)} class="text-action" onClick={close}>{t('pm.done')}</button>
      </div>
    </div>
  );
}

// ---- Edit menu ----------------------------------------------------------------------------

function MenuSlots({ id, close }: Props) {
  const { t } = useApp();
  const menu = usePlayerMenu();
  const [picking, setPicking] = useState<number | undefined>(undefined);
  const slotName = (slot: number) => (slot === SIDE_SLOT ? t('pm.side') : t('pm.slot', { n: slot + 1 }));

  if (picking !== undefined) {
    const current = actionAt(menu.layout, picking);
    return (
      <div class="overlay-panel">
        <h2>{t('pm.pick', { slot: slotName(picking) })}</h2>
        <div class="overlay-list">
          {MENU_ACTIONS.map((action, index) => {
            const used = [...menu.layout.slots, menu.layout.side].indexOf(action);
            return (
              <Row
                key={action}
                id={`ov${id}-pick-${action}`}
                row={index + 1}
                label={menu.info[action].label}
                selected={action === current}
                note={used >= 0 && action !== current ? t('pm.inUse', { slot: slotName(used) }) : undefined}
                onSelect={() => { void menu.place(picking, action); setPicking(undefined); }}
              />
            );
          })}
        </div>
      </div>
    );
  }
  return (
    <div class="overlay-panel">
      <h2>{t('pm.edit')}</h2>
      <p class="overlay-body">{t('pm.editHint')}</p>
      <div class="overlay-list">
        {[0, 1, 2, 3, SIDE_SLOT].map((slot, index) => (
          <Row key={slot} id={`ov${id}-slot-${slot}`} row={index + 1} label={slotName(slot)} detail={menu.info[actionAt(menu.layout, slot)].label} onSelect={() => setPicking(slot)} />
        ))}
      </div>
      <div class="overlay-actions">
        <button {...focusProps(`ov${id}-reset`, 6, 0)} class="text-action" onClick={() => void menu.reset()}>{t('pm.reset')}</button>
        <button {...focusProps(`ov${id}-done`, 6, 1)} class="text-action" onClick={close}>{t('pm.done')}</button>
      </div>
    </div>
  );
}

registerOverlay('playerMenu', (overlay, { close }) => <OtherMenu id={overlay.id} close={close} />);
registerOverlay('sleepTimer', (overlay, { close }) => <SleepOverlay id={overlay.id} close={close} />);
registerOverlay('speed', (overlay, { close }) => <SpeedOverlay id={overlay.id} close={close} />);
registerOverlay('output', (overlay, { close }) => <OutputOverlay id={overlay.id} close={close} />);
registerOverlay('songDetails', (overlay, { close }) => <SongDetails id={overlay.id} close={close} />);
registerOverlay('aboutSong', (overlay, { close }) => <AboutSong id={overlay.id} close={close} />);
registerOverlay('menuSlots', (overlay, { close }) => <MenuSlots id={overlay.id} close={close} />);
