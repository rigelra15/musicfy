import { useApp } from '../../app/AppContext';
import { focusById } from '../../app/remote';
import { useSnapshot } from '../../app/useSnapshot';
import type { IconName } from '../../components/Icon';
import { trackKeyOf } from '../../domain/entity';
import { currentTrack } from '../../playback/queueModel';
import { capabilityReason, type CapabilityId } from '../../platform/capabilities';
import {
  MENU_ACTIONS, PREF_MENU_SIDE, PREF_MENU_SLOTS, assign, readLayout, serializeSlots, DEFAULT_SIDE, DEFAULT_SLOTS,
  type MenuAction, type MenuLayout,
} from './layout';
import { PREF_KEEP_AWAKE, PREF_SEE_VIDEO, PREF_SPEED } from './prefs';
import { formatRemaining } from './sleepTimer';

export interface MenuActionInfo {
  id: MenuAction;
  label: string;
  icon: IconName;
  /** The action is on right now (liked, repeat on, a timer running, ...). */
  active: boolean;
  /** A short state next to the label ("All", "12:30", "1.25×"). */
  detail?: string;
  /** Why this cannot be done here. The button stays visible; using it says why instead of doing nothing. */
  unavailable?: string;
  run(): void;
}

/** Capability each gated action depends on; a feature is usable only once the TV itself has proven it. */
const GATES: Partial<Record<MenuAction, CapabilityId>> = { SEE_VIDEO: 'video.background', KEEP_AWAKE: 'system.keepAwake', SPEED: 'audio.speed' };

/**
 * The fourteen quick actions with what each does right now. Playback-affecting ones change the
 * queue or engine; the rest open the overlay that owns them. Anything the TV cannot do (or that
 * is not built yet) keeps its button but carries the reason, so no button is silently dead.
 */
export function usePlayerMenu() {
  const app = useApp();
  const { store, dispatch, t, services, library, sleep, lyrics, toast, goTab, openOverlay, playerPanel } = app;
  const lyricsState = useSnapshot(lyrics);
  const translating = lyricsState.translation.status === 'translating';
  const translationReady = lyricsState.translation.status === 'ready';
  const snapshot = useSnapshot(library);
  const sleepState = useSnapshot(sleep);
  const track = currentTrack(store.root.queue);
  const queue = store.root.queue;
  const layout: MenuLayout = readLayout(services.prefs.get(PREF_MENU_SLOTS, ''), services.prefs.get(PREF_MENU_SIDE, ''));
  const liked = track ? snapshot.likedKeys.has(trackKeyOf(track)) : false;
  const speed = Number(services.prefs.get(PREF_SPEED, 1)) || 1;
  const seeVideo = services.prefs.get<boolean>(PREF_SEE_VIDEO, false) === true;
  const keepAwake = services.prefs.get<boolean>(PREF_KEEP_AWAKE, false) === true;

  const gate = (action: MenuAction): string | undefined => {
    const id = GATES[action];
    if (!id) return undefined;
    const capability = services.capabilities.get(id);
    return capability.status === 'supported' ? undefined : capabilityReason(capability);
  };
  const opener = (action: MenuAction) => `player-menu-${action}`;
  const failed = (error: unknown) => toast(t('toast.failed', { message: error instanceof Error ? error.message : String(error) }));
  const toggleFlag = (key: string, value: boolean) => { void services.prefs.set(key, value).catch(failed); };

  const info: Record<MenuAction, MenuActionInfo> = {
    LIKE: {
      id: 'LIKE', label: t('pm.action.LIKE'), icon: 'heart', active: liked, unavailable: track ? undefined : t('pm.noTrack'),
      run: () => {
        if (!track) return;
        void services.repo.setLiked(track, !liked).then(() => toast(liked ? t('toast.unliked') : t('toast.liked'))).catch(failed);
      },
    },
    OTHER_MENU: { id: 'OTHER_MENU', label: t('pm.action.OTHER_MENU'), icon: 'ellipsis', active: false, run: () => openOverlay('playerMenu', { openerFocusId: opener('OTHER_MENU') }) },
    SLEEP_TIMER: {
      id: 'SLEEP_TIMER', label: t('pm.action.SLEEP_TIMER'), icon: 'timer', active: sleepState.deadlineAt !== undefined || sleepState.atSongEnd,
      detail: sleepState.deadlineAt !== undefined ? formatRemaining(Math.max(0, sleepState.deadlineAt - Date.now())) : sleepState.atSongEnd ? t('pm.sleep.songEndOn') : undefined,
      run: () => openOverlay('sleepTimer', { openerFocusId: opener('SLEEP_TIMER') }),
    },
    SEE_VIDEO: {
      id: 'SEE_VIDEO', label: t('pm.action.SEE_VIDEO'), icon: 'video', active: seeVideo && !gate('SEE_VIDEO'), unavailable: gate('SEE_VIDEO'),
      run: () => toggleFlag(PREF_SEE_VIDEO, !seeVideo),
    },
    REPEAT: {
      id: 'REPEAT', label: t('pm.action.REPEAT'), icon: queue.repeat === 'one' ? 'repeat-1' : 'repeat', active: queue.repeat !== 'off',
      detail: queue.repeat === 'off' ? undefined : queue.repeat === 'all' ? t('queue.repeat.all') : t('queue.repeat.one'),
      run: () => dispatch({ type: 'queue/cycleRepeat' }),
    },
    SHUFFLE: {
      id: 'SHUFFLE', label: t('pm.action.SHUFFLE'), icon: 'shuffle', active: queue.shuffle,
      run: () => dispatch({ type: 'queue/setShuffle', on: !queue.shuffle, seed: 1 + Math.floor(Math.random() * 2147483646) }),
    },
    LYRICS: {
      id: 'LYRICS', label: t('pm.action.LYRICS'), icon: 'mic', active: false,
      run: () => { playerPanel.set('lyrics'); goTab('player'); setTimeout(() => { if (!focusById('lyrics-plain')) toast(t('pm.lyricsRight')); }, 0); },
    },
    QUEUE: { id: 'QUEUE', label: t('pm.action.QUEUE'), icon: 'list-music', active: false, run: () => { playerPanel.set('queue'); goTab('player'); } },
    SPEED: {
      id: 'SPEED', label: t('pm.action.SPEED'), icon: 'gauge', active: speed !== 1, detail: speed !== 1 ? `${speed}×` : undefined, unavailable: gate('SPEED'),
      run: () => openOverlay('speed', { openerFocusId: opener('SPEED') }),
    },
    OUTPUT: { id: 'OUTPUT', label: t('pm.action.OUTPUT'), icon: 'cast', active: false, run: () => openOverlay('output', { openerFocusId: opener('OUTPUT') }) },
    KEEP_AWAKE: {
      id: 'KEEP_AWAKE', label: t('pm.action.KEEP_AWAKE'), icon: 'sun', active: keepAwake && !gate('KEEP_AWAKE'), unavailable: gate('KEEP_AWAKE'),
      run: () => toggleFlag(PREF_KEEP_AWAKE, !keepAwake),
    },
    TRANSLATE_LYRICS: {
      id: 'TRANSLATE_LYRICS', label: t('pm.action.TRANSLATE_LYRICS'), icon: 'languages', active: translating || translationReady,
      detail: translating ? t('lyrics.translating') : undefined,
      unavailable: !translating && !translationReady && !lyricsState.snapshot.document ? t('lyrics.tr.needLyrics') : undefined,
      // On: show the original again. Off: translate with the saved languages (the languages are changed in "Lyrics translation").
      run: () => {
        if (translating) { lyrics.stopTranslation(); toast(t('lyrics.tr.stopped')); return; }
        if (translationReady) { void lyrics.showOriginal(); toast(t('lyrics.tr.cleared')); return; }
        void lyrics.translate(); toast(t('lyrics.translating'));
      },
    },
    DOWNLOAD: { id: 'DOWNLOAD', label: t('pm.action.DOWNLOAD'), icon: 'download', active: false, unavailable: t('pm.pending.download'), run: () => undefined },
    ADD_TO_PLAYLIST: {
      id: 'ADD_TO_PLAYLIST', label: t('pm.action.ADD_TO_PLAYLIST'), icon: 'list-plus', active: false, unavailable: track ? undefined : t('pm.noTrack'),
      run: () => { if (track) openOverlay('addToPlaylist', { props: { tracks: [track] }, openerFocusId: opener('ADD_TO_PLAYLIST') }); },
    },
  };

  /** Runs an action; one that cannot be done here says why and changes nothing. */
  const run = (action: MenuAction) => {
    const item = info[action];
    if (item.unavailable) { toast(item.unavailable); return; }
    item.run();
  };

  const saveLayout = async (next: MenuLayout) => {
    try {
      await services.prefs.set(PREF_MENU_SLOTS, serializeSlots(next.slots));
      await services.prefs.set(PREF_MENU_SIDE, next.side);
    } catch (error) { failed(error); }
  };

  return {
    layout,
    info,
    all: MENU_ACTIONS.map((id) => info[id]),
    run,
    place: (slot: number, action: MenuAction) => saveLayout(assign(layout, slot, action)),
    reset: () => saveLayout({ slots: [...DEFAULT_SLOTS], side: DEFAULT_SIDE }),
    opener,
  };
}
