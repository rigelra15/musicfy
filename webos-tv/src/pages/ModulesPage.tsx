import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app/AppContext';
import { focusProps } from '../app/format';
import { useSnapshot } from '../app/useSnapshot';
import { currentTrack } from '../playback/queueModel';
import { PREF_SOURCE_ENABLED, PREF_SOURCE_ORDER, PREF_SOURCE_PICKS, SOURCE_NAMES, activeSources, move, readSettings, type SourceId } from '../sources/config';
import { queryOf } from '../sources/resolver';
import type { DiagnosticStep, ModuleStatus } from '../sources/client';
import { kindLabel, type FailureKind } from '../sources/errors';
import type { Language, StringKey } from '../app/i18n';

const STEP_KEYS: Record<string, StringKey> = { account: 'modules.step.account', search: 'modules.step.search', stream: 'modules.step.stream' };

/** The service's account line, in the language on screen: only the state and, once signed in, the account's own detail (its country) are shown. */
function accountText(t: (key: StringKey, vars?: Record<string, string | number>) => string, account: ModuleStatus['account'] | undefined, language: Language): string {
  if (!account) return t('modules.state.unknown');
  const base = t(`modules.state.${account.state}` as StringKey);
  if (account.state !== 'signedIn') return base;
  const detail = account.label.replace(/^(Terhubung|Connected)(?: · ?)?/, '').trim();
  return detail ? `${base} · ${/^[a-z]{2}$/i.test(detail) ? regionName(detail, language, detail.toUpperCase()) : detail}` : base;
}
const regionName = (code: string, language: Language, fallback: string): string => {
  try { return new Intl.DisplayNames([language], { type: 'region' }).of(code.toUpperCase()) ?? fallback; } catch { return fallback; }
};

const SAMPLE = { title: 'Espresso', artist: 'Sabrina Carpenter', artists: [{ name: 'Sabrina Carpenter' }], durationMs: 175_000, id: 'sample' };

export function ModulesPage({ moduleId }: { moduleId?: string }) {
  const { t, services, sourceStatus, navigate, language } = useApp();
  const state = useSnapshot(sourceStatus);
  const [, bump] = useState(0);
  useEffect(() => services.prefs.subscribe(() => bump((n) => n + 1)), [services]);
  useEffect(() => { void sourceStatus.refresh(); }, [sourceStatus]);
  const settings = readSettings(services.prefs);
  const set = (key: string, value: unknown) => { void services.prefs.set(key, value).catch(() => undefined); };
  const statusOf = (id: SourceId) => state.modules.find((module) => module.id === id);

  if (moduleId === 'monochrome' || moduleId === 'applemusic') return <ModuleDetail id={moduleId} module={statusOf(moduleId)} />;

  const stateText = (id: SourceId) => {
    if (id === 'youtube') return t('modules.youtube');
    return accountText(t, statusOf(id)?.account, language);
  };
  return (
    <section class="detail-view modules-view" aria-labelledby="modules-heading">
      <h1 id="modules-heading">{t('modules.title')}</h1>
      <p class="detail-note">{t('modules.hint')}</p>
      {activeSources(settings).length === 0 && <p class="message-state is-error" role="alert">{t('modules.noneOn')}</p>}
      {state.status === 'error' && <p class="detail-note" role="status">{t('modules.statusFailed', { message: state.error ?? '' })}</p>}
      <ol class="module-list">
        {settings.order.map((id, index) => {
          const on = settings.enabled[id];
          return (
            <li class={`module-row ${on ? 'is-on' : ''}`} key={id}>
              <span class="module-name"><strong>{SOURCE_NAMES[id]}</strong><small>{t('modules.position', { n: index + 1 })} · {stateText(id)}</small></span>
              <button {...focusProps(`module-${id}-toggle`, index + 2, 0)} class={`chip-button ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => set(PREF_SOURCE_ENABLED, { ...settings.enabled, [id]: !on })}>{on ? t('modules.on') : t('modules.off')}</button>
              <button {...focusProps(`module-${id}-up`, index + 2, 1, index === 0)} class="chip-button" aria-label={`${t('modules.up')}: ${SOURCE_NAMES[id]}`} onClick={() => set(PREF_SOURCE_ORDER, move(settings.order, id, -1))}>↑</button>
              <button {...focusProps(`module-${id}-down`, index + 2, 2, index === settings.order.length - 1)} class="chip-button" aria-label={`${t('modules.down')}: ${SOURCE_NAMES[id]}`} onClick={() => set(PREF_SOURCE_ORDER, move(settings.order, id, 1))}>↓</button>
              {id !== 'youtube'
                ? <button {...focusProps(`module-${id}-open`, index + 2, 3)} class="chip-button" onClick={() => navigate({ name: 'modules', moduleId: id })}>{t('modules.open')}</button>
                : <span />}
            </li>
          );
        })}
      </ol>
    </section>
  );

  function ModuleDetail({ id, module }: { id: 'monochrome' | 'applemusic'; module: ModuleStatus | undefined }) {
    const { t, services, sources, sourceStatus, openOverlay, toast, store, language } = useApp();
    const [busy, setBusy] = useState<'verify' | 'test' | undefined>();
    const [test, setTest] = useState<{ steps: DiagnosticStep[]; ok: boolean; kind?: FailureKind; song: string } | undefined>();
    const settings = readSettings(services.prefs);
    const picks = settings.picks[id] ?? {};
    const account = module?.account;
    const apple = id === 'applemusic';
    const run = async (kind: 'verify' | 'test', work: () => Promise<void>) => { setBusy(kind); try { await work(); } catch (error) { toast(t('modules.statusFailed', { message: error instanceof Error ? error.message : String(error) })); } setBusy(undefined); };
    const pick = (choice: ModuleStatus['choices'][number]) => openOverlay('actions', { props: { title: choiceTitle(choice), actions: choice.options.map((option) => ({ id: option.id, label: optionLabel(choice, option), selected: (picks as Record<string, string | undefined>)[choice.id] === option.id || (!(picks as Record<string, string | undefined>)[choice.id] && option === choice.options[0]), onSelect: () => { void services.prefs.set(PREF_SOURCE_PICKS, { ...settings.picks, [id]: { ...picks, [choice.id]: option.id } }).catch(() => undefined); } })) } });
    const choiceTitle = (choice: ModuleStatus['choices'][number]): string => t(`modules.choice.${choice.id}` as StringKey);
    const optionLabel = (choice: ModuleStatus['choices'][number], option: ModuleStatus['choices'][number]['options'][number]): string =>
      choice.id === 'region' ? (option.id === 'auto' ? t('modules.opt.auto') : regionName(option.id, language, option.label)) : option.label;
    const diagnose = () => run('test', async () => {
      const playing = currentTrack(store.root.queue);
      const song = playing ?? SAMPLE;
      const out = await sources.diagnose(id, queryOf(song), picks);
      for (const step of out.steps) console.debug('[source test]', id, step.id, step.ok, step.detail);
      setTest({ steps: out.steps, ok: out.result === 'found', kind: out.result === 'found' ? undefined : out.kind, song: `${song.title} · ${song.artist}` });
    });
    return (
      <section class="detail-view modules-view" aria-labelledby="module-heading">
        <h1 id="module-heading">{module?.name ?? SOURCE_NAMES[id]}</h1>
        <p class="detail-note">{t(`modules.desc.${id}` as StringKey)}</p>
        <p class="detail-note module-warning" role="note"><strong>{t('modules.unverified')}.</strong> {apple ? t('modules.unverifiedApple') : t('modules.unverifiedMono')} {apple ? t('modules.noOffline') : ''}</p>
        <dl class="module-facts"><div><dt>{t('modules.account')}</dt><dd>{accountText(t, account, language)}</dd></div></dl>
        {account?.state === 'expired' && <p class="detail-note" role="status">{t('modules.expiredHint')}</p>}
        <div class="detail-actions" role="group">
          {account && account.state !== 'ready' && <button {...focusProps('module-verify', 2, 0, busy !== undefined)} class="chip-button" onClick={() => void run('verify', async () => { await sources.verify(id); await sourceStatus.refresh(); })}>{busy === 'verify' ? t('modules.checking') : t('modules.verify')}</button>}
          {apple && <button {...focusProps('module-connect', 2, 1)} class="chip-button" onClick={() => openOverlay('pairing', { openerFocusId: 'module-connect' })}>{t('modules.connect')}</button>}
          {apple && account?.state !== 'signedOut' && <button {...focusProps('module-signout', 2, 2)} class="chip-button" onClick={() => openOverlay('confirm', { props: { title: t('modules.confirmSignOut'), body: t('modules.confirmSignOutBody'), confirmLabel: t('modules.signOut'), onConfirm: () => { void sources.signOut(id).then(() => sourceStatus.refresh()).then(() => toast(t('modules.signedOut'))); } } })}>{t('modules.signOut')}</button>}
          <button {...focusProps('module-test', 2, 3, busy !== undefined)} class="chip-button" onClick={() => void diagnose()}>{busy === 'test' ? t('modules.testing') : t('modules.test')}</button>
        </div>
        {apple && <p class="detail-note">{t('modules.connectHint')}</p>}
        {module && module.choices.length > 0 && (
          <div class="module-choices" role="group" aria-label={t('modules.choices')}>
            {module.choices.map((choice, index) => {
              const current = (picks as Record<string, string | undefined>)[choice.id];
              const option = choice.options.find((item) => item.id === current) ?? choice.options[0];
              return <button {...focusProps(`module-choice-${choice.id}`, 3, index)} class="chip-button" key={choice.id} onClick={() => pick(choice)}>{choiceTitle(choice)}: {optionLabel(choice, option)}</button>;
            })}
          </div>
        )}
        {test && (
          <div class="module-test" role="status">
            <p class="detail-note">{t('modules.testSong', { song: test.song })}</p>
            <ul class="preview-lines">{test.steps.map((step) => <li key={step.name}>{step.ok === true ? '✓' : step.ok === false ? '✗' : '…'} {STEP_KEYS[step.id] ? t(STEP_KEYS[step.id]) : step.id}</li>)}</ul>
            <p class={test.ok ? 'overlay-body' : 'overlay-body is-error'}>{test.ok ? t('modules.testOk') : t('modules.testFailed', { kind: kindLabel(test.kind ?? 'stream') })}</p>
          </div>
        )}
      </section>
    );
  }
}
