import type { StringKey } from '../../app/i18n';
import { useApp } from '../../app/AppContext';
import { focusProps } from '../../app/format';
import { registerOverlay, type ActionItem } from '../../app/OverlayHost';
import { capabilityReason, type CapabilityId } from '../../platform/capabilities';
import { DISC_LABEL_OPTIONS } from '../../data/playerPreferences';
import { Row } from '../playerMenu/overlays';
import {
  BUTTON_STYLES, FLAGSHIP_COVERS, PRESETS, SEEKBAR_STYLES, SHIFT_LIMIT, SHIFT_STEP, hasDisc,
  type StudioSettings,
} from './studio';
import { useStudio } from './useStudio';

const labelOf = <T extends { id: string; label: string }>(options: readonly T[], id: string) => options.find((option) => option.id === id)?.label ?? id;

/**
 * "Edit player": every setting of the studio in one list. The player stays visible on the left so a
 * change can be watched as it is made; a choice among several opens a picker, a switch flips at once.
 */
function StudioOverlay({ id, close }: { id: number; close(): void }) {
  const { t, services, openOverlay, toast } = useApp();
  const { settings, update, reset } = useStudio();
  const disc = hasDisc(settings);
  let row = 0;
  const next = () => (row += 1);
  // The picker lists carry the words for the language on screen.
  const L = <T extends { id: string }>(group: string, options: readonly T[]) => options.map((option) => ({ ...option, label: t(`studio.opt.${group}.${option.id}` as StringKey) }));

  const pick = (title: string, options: readonly { id: string; label: string }[], current: string, apply: (value: string) => void) => {
    const actions: ActionItem[] = options.map((option) => ({ id: option.id, label: option.label, selected: option.id === current, onSelect: () => apply(option.id) }));
    openOverlay('actions', { props: { title, actions }, openerFocusId: undefined });
  };
  const gated = (capability: CapabilityId) => {
    const found = services.capabilities.get(capability);
    return found.status === 'supported' ? undefined : capabilityReason(found);
  };
  const tell = (reason: string) => () => toast(reason);
  const flag = (key: 'rotation' | 'realistic' | 'reducedMotion', label: string, suffix: string) => (
    <Row id={`ov${id}-${suffix}`} row={next()} label={label} detail={settings[key] ? t('studio.on') : t('studio.off')} selected={settings[key]} onSelect={() => update({ [key]: !settings[key] } as Partial<StudioSettings>)} />
  );
  const unavailable = (capability: CapabilityId, label: string, suffix: string) => {
    const reason = gated(capability) ?? '';
    return <Row id={`ov${id}-${suffix}`} row={next()} label={label} detail={t('studio.off')} note={reason} onSelect={tell(reason)} />;
  };

  return (
    <div class="overlay-panel">
      <h2>{t('studio.title')}</h2>
      <p class="studio-hint">{t('studio.hint')}</p>
      <div class="overlay-list">
        <Row id={`ov${id}-preset`} row={next()} label={t('studio.preset')} detail={labelOf(L('preset', PRESETS), settings.preset)} onSelect={() => pick(t('studio.preset'), L('preset', PRESETS), settings.preset, (value) => update({ preset: value as StudioSettings['preset'] }))} />
        {settings.preset === 'FLAGSHIP' && (
          <Row id={`ov${id}-cover`} row={next()} label={t('studio.cover')} detail={labelOf(L('cover', FLAGSHIP_COVERS), settings.coverStyle)} onSelect={() => pick(t('studio.cover'), L('cover', FLAGSHIP_COVERS), settings.coverStyle, (value) => update({ coverStyle: value as StudioSettings['coverStyle'] }))} />
        )}
        {disc && flag('rotation', t('studio.rotate'), 'rotate')}
        {disc && flag('realistic', t('studio.realistic'), 'realistic')}
        {disc && (
          <Row id={`ov${id}-label`} row={next()} label={t('studio.discLabel')} detail={labelOf(L('disc', DISC_LABEL_OPTIONS), settings.labelChoice)} onSelect={() => pick(t('studio.discLabel'), L('disc', DISC_LABEL_OPTIONS), settings.labelChoice, (value) => update({ labelChoice: value as StudioSettings['labelChoice'] }))} />
        )}
        {disc && settings.labelChoice === 'CUSTOM' && (
          <label class="pm-slider"><span>{t('studio.customLabel')}</span>
            <input {...focusProps(`ov${id}-custom`, next(), 0)} type="text" maxLength={120} value={settings.customLabel} aria-label={t('studio.customLabel')} onInput={(event) => update({ customLabel: event.currentTarget.value })} />
          </label>
        )}
        <Row id={`ov${id}-buttons`} row={next()} label={t('studio.controls')} detail={labelOf(L('buttons', BUTTON_STYLES), settings.buttonStyle)} onSelect={() => pick(t('studio.controls'), L('buttons', BUTTON_STYLES), settings.buttonStyle, (value) => update({ buttonStyle: value as StudioSettings['buttonStyle'] }))} />
        <Row id={`ov${id}-seekbar`} row={next()} label={t('studio.seekbar')} detail={labelOf(L('seekbar', SEEKBAR_STYLES), settings.seekBarStyle)} onSelect={() => pick(t('studio.seekbar'), L('seekbar', SEEKBAR_STYLES), settings.seekBarStyle, (value) => update({ seekBarStyle: value as StudioSettings['seekBarStyle'] }))} />
        <Row id={`ov${id}-endtime`} row={next()} label={t('studio.endTime')} detail={settings.endTimestamp === 'END_TIME' ? t('studio.endTime.total') : t('studio.endTime.left')} onSelect={() => update({ endTimestamp: settings.endTimestamp === 'END_TIME' ? 'TIME_LEFT' : 'END_TIME' })} />
        {settings.preset === 'POSTER' && unavailable('audio.visualizer', t('studio.visualizer'), 'visualizer')}
        {unavailable('video.canvas', t('studio.canvas'), 'canvas')}
        {unavailable('video.background', t('studio.video'), 'video')}
        {unavailable('video.background', t('studio.timestampMatch'), 'match')}
      </div>
      <label class="pm-slider"><span>{t('studio.shift')}</span><strong>{t('studio.shiftValue', { value: settings.controlsShift * SHIFT_STEP })}</strong>
        <input {...focusProps(`ov${id}-shift`, next(), 0)} type="range" min={-SHIFT_LIMIT} max={SHIFT_LIMIT} step="1" value={settings.controlsShift} aria-label={t('studio.shift')} onInput={(event) => update({ controlsShift: Number(event.currentTarget.value) })} />
      </label>
      <div class="overlay-list">
        {flag('reducedMotion', t('studio.reduceMotion'), 'motion')}
        <Row id={`ov${id}-slots`} row={next()} label={t('studio.menuSlots')} onSelect={() => openOverlay('menuSlots')} />
      </div>
      <div class="overlay-actions">
        <button {...focusProps(`ov${id}-reset`, next(), 0)} class="text-action" onClick={() => { reset(); toast(t('studio.resetDone')); }}>{t('studio.reset')}</button>
        <button {...focusProps(`ov${id}-done`, row, 1)} class="text-action" onClick={close}>{t('pm.done')}</button>
      </div>
    </div>
  );
}

registerOverlay('studio', (overlay, { close }) => <StudioOverlay id={overlay.id} close={close} />);
