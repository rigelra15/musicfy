import type { ProviderDefinition } from './types';
import type { StringKey } from '../app/i18n';
import { useState } from 'preact/hooks';
import { useApp } from '../app/AppContext';
import { ChunkedList } from '../app/ChunkedList';
import { focusProps } from '../app/format';
import { registerOverlay, type ActionItem } from '../app/OverlayHost';
import { useSnapshot } from '../app/useSnapshot';
import { Row } from '../features/playerMenu/overlays';
import { formatLrcTime, hasRichTiming, type EditorLine } from './edit';
import { USER_EDITED } from './selection';
import { LANGUAGES } from './translation';
import { lyricsProviders, type SourceResult } from './types';

type Props = { id: number; close(): void };
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// ---- provider -----------------------------------------------------------------------------

/** What a provider's answer is, in words: how it is timed, whether it has two voices, or why it cannot be used. */
function describe(result: SourceResult | undefined, t: ReturnType<typeof useApp>['t']): { label: string; usable: boolean; rank: number } {
  if (!result || result.status === 'waiting') return { label: t('lyrics.state.waiting'), usable: false, rank: 5 };
  if (result.status === 'loading') return { label: t('lyrics.state.loading'), usable: false, rank: 4 };
  if (result.status === 'error') return { label: t('lyrics.state.error'), usable: false, rank: 7 };
  const document = result.document;
  if (result.status === 'missing' || !document || document.type === 'missing') return { label: t('lyrics.state.missing'), usable: false, rank: 6 };
  if (document.type === 'plain') return { label: t('lyrics.state.plain'), usable: true, rank: 3 };
  const rich = document.lines.some((line) => line.words?.length || line.syllables?.length);
  const duet = new Set(document.lines.filter((line) => !line.isBackground).map((line) => line.agent || 'v1')).size > 1;
  return { label: `${rich ? t('lyrics.provider.word') : t('lyrics.provider.line')}${duet ? ` · ${t('lyrics.provider.duet')}` : ''}`, usable: true, rank: rich ? 1 : 2 };
}

function ProviderOverlay({ id, close }: Props) {
  const { t, lyrics, services, toast } = useApp();
  const state = useSnapshot(lyrics);
  const { snapshot, songChoice } = state;
  const shown = snapshot.document?.source;
  const rows = lyricsProviders
    .map((provider, order) => ({ provider, order, info: describe(snapshot.results.find((result) => result.id === provider.id), t) }))
    .sort((a, b) => a.info.rank - b.info.rank || a.order - b.order);
  const defaultName = lyrics.defaultSource === 'auto' ? t('lyrics.auto') : lyricsProviders.find((provider) => provider.id === lyrics.defaultSource)?.name ?? lyrics.defaultSource;
  const choose = (source: string, asDefault = false) => {
    void lyrics.selectSource(source, { asDefault }).then(() => toast(asDefault ? t('lyrics.provider.defaultSaved') : t('lyrics.provider.saved'))).catch(() => toast(t('lyrics.provider.saveFailed')));
  };
  let row = 0;
  const current = songChoice ?? snapshot.source;
  return (
    <div class="overlay-panel">
      <h2>{t('lyrics.provider.title')}</h2>
      <p class="studio-hint">{t('lyrics.provider.defaultNow', { name: defaultName })}</p>
      <div class="overlay-list">
        <Row id={`ov${id}-auto`} row={(row += 1)} label={t('lyrics.provider.auto')} selected={current === 'auto'} onSelect={() => choose('auto')} />
        {snapshot.edited && <Row id={`ov${id}-mine`} row={(row += 1)} label={t('lyrics.provider.mine')} selected={current === USER_EDITED} onSelect={() => choose(USER_EDITED)} />}
        {rows.map(({ provider, info }) => (
          <Row
            key={provider.id}
            id={`ov${id}-p-${provider.id}`}
            row={(row += 1)}
            label={providerName(provider, t)}
            detail={`${info.label}${shown === provider.id ? ` · ${t('lyrics.provider.inUse')}` : ''}`}
            selected={current === provider.id}
            note={info.usable ? undefined : providerNote(provider, t)}
            onSelect={() => { if (info.usable) choose(provider.id); }}
          />
        ))}
      </div>
      <div class="overlay-list">
        <Row id={`ov${id}-default`} row={(row += 1)} label={t('lyrics.provider.default')} onSelect={() => choose(current === USER_EDITED ? 'auto' : current, true)} />
        {songChoice !== undefined && <Row id={`ov${id}-follow`} row={(row += 1)} label={t('lyrics.provider.followDefault')} onSelect={() => { void lyrics.followDefault().then(() => toast(t('lyrics.provider.saved'))).catch(() => toast(t('lyrics.provider.saveFailed'))); }} />}
      </div>
      <div class="overlay-actions">
        <button {...focusProps(`ov${id}-done`, row + 1, 0)} class="text-action" onClick={close}>{t('pm.done')}</button>
      </div>
    </div>
  );
}

// ---- editor -------------------------------------------------------------------------------

function EditorOverlay({ id, close }: Props) {
  const { t, lyrics, toast } = useApp();
  const state = useSnapshot(lyrics);
  const [rows, setRows] = useState<EditorLine[]>(() => lyrics.editorRows());
  const [saving, setSaving] = useState(false);
  const rich = hasRichTiming(state.snapshot.edited ? null : state.snapshot.document);
  const change = (index: number, text: string) => {
    const next = rows.map((row, i) => (i === index ? { ...row, text } : row));
    setRows(next);
    lyrics.saveDraft(next);
  };
  const save = async () => {
    setSaving(true);
    try { await lyrics.saveEdit(rows); toast(t('lyrics.edit.saved')); close(); } catch (error) { toast(t('lyrics.edit.failed', { message: errorText(error) })); }
    setSaving(false);
  };
  const revert = async () => {
    try { await lyrics.revertEdit(); toast(t('lyrics.edit.reverted')); close(); } catch (error) { toast(t('lyrics.edit.failed', { message: errorText(error) })); }
  };
  const canRevert = Boolean(state.snapshot.edited) || lyrics.hasDraft;
  if (rows.length === 0) {
    return (
      <div class="overlay-panel">
        <h2>{t('lyrics.edit.title')}</h2>
        <p class="overlay-body">{t('lyrics.edit.empty')}</p>
        <div class="overlay-actions"><button {...focusProps(`ov${id}-done`, 1, 0)} class="text-action" onClick={close}>{t('pm.done')}</button></div>
      </div>
    );
  }
  return (
    <div class="overlay-panel lyrics-editor">
      <h2>{t('lyrics.edit.title')}</h2>
      <p class="studio-hint">{t('lyrics.edit.hint')}</p>
      {rich && <p class="studio-hint is-warning">{t('lyrics.edit.rich')}</p>}
      <div class="overlay-actions editor-actions">
        <button {...focusProps(`ov${id}-save`, 1, 0, saving)} class="text-action" onClick={() => void save()}>{t('lyrics.edit.save')}</button>
        <button {...focusProps(`ov${id}-revert`, 1, 1, !canRevert)} class="text-action" onClick={() => void revert()}>{t('lyrics.edit.revert')}</button>
        <button {...focusProps(`ov${id}-cancel`, 1, 2)} class="text-action" onClick={close}>{t('common.cancel')}</button>
      </div>
      <ChunkedList class="editor-rows" chunk={30} items={rows} render={(row, index) => (
        <label class="editor-row">
          <span class="editor-time">{row.timeMs === undefined ? index + 1 : formatLrcTime(row.timeMs).slice(1, -1)}</span>
          <input {...focusProps(`ov${id}-row-${index}`, index + 2, 0)} type="text" value={row.text} maxLength={300} aria-label={t('lyrics.edit.row', { n: index + 1 })} onInput={(event) => change(index, event.currentTarget.value)} />
        </label>
      )} />
    </div>
  );
}

// ---- translation --------------------------------------------------------------------------

function TranslateOverlay({ id, close }: Props) {
  const { t, lyrics, openOverlay, toast } = useApp();
  const state = useSnapshot(lyrics);
  const { translation, snapshot } = state;
  const name = (code: string) => (code === 'auto' ? t('lyrics.tr.auto') : LANGUAGES.find((language) => language.code === code)?.name ?? code);
  const pick = (title: string, withAuto: boolean, apply: (code: string) => void, current: string) => {
    const actions: ActionItem[] = [
      ...(withAuto ? [{ id: 'auto', label: t('lyrics.tr.auto'), selected: current === 'auto', onSelect: () => apply('auto') }] : []),
      ...LANGUAGES.map((language) => ({ id: language.code, label: `${language.name}`, selected: current === language.code, onSelect: () => apply(language.code) })),
    ];
    openOverlay('actions', { props: { title, actions } });
  };
  const hasLyrics = Boolean(snapshot.document);
  const busy = translation.status === 'translating';
  const status = busy ? t('lyrics.tr.working') : translation.status === 'ready' ? t('lyrics.tr.done') : translation.status === 'error' ? translation.error : !hasLyrics ? t('lyrics.tr.needLyrics') : undefined;
  return (
    <div class="overlay-panel">
      <h2>{t('lyrics.tr.title')}</h2>
      <div class="overlay-list">
        <Row id={`ov${id}-from`} row={1} label={t('lyrics.tr.from')} detail={name(lyrics.translateSource)} onSelect={() => pick(t('lyrics.tr.from'), true, (code) => void lyrics.setTranslateOptions({ source: code }), lyrics.translateSource)} />
        <Row id={`ov${id}-to`} row={2} label={t('lyrics.tr.to')} detail={name(lyrics.target)} onSelect={() => pick(t('lyrics.tr.to'), false, (code) => void lyrics.setTranslateOptions({ target: code }), lyrics.target)} />
        <Row id={`ov${id}-session`} row={3} label={t('lyrics.tr.session')} detail={lyrics.sessionWide ? t('studio.on') : t('studio.off')} selected={lyrics.sessionWide} onSelect={() => void lyrics.setTranslateOptions({ sessionWide: !lyrics.sessionWide })} />
      </div>
      <p class="studio-hint">{t('lyrics.tr.sessionHint')}</p>
      {status && <p class={`overlay-body ${translation.status === 'error' ? 'is-error' : ''}`} role="status">{status}</p>}
      <div class="overlay-actions">
        {busy
          ? <button {...focusProps(`ov${id}-stop`, 4, 0)} class="text-action" onClick={() => { lyrics.stopTranslation(); toast(t('lyrics.tr.stopped')); }}>{t('lyrics.tr.stop')}</button>
          : <button {...focusProps(`ov${id}-go`, 4, 0, !hasLyrics)} class="text-action" onClick={() => void lyrics.translate()}>{translation.status === 'error' ? t('lyrics.tr.retry') : t('lyrics.tr.go')}</button>}
        <button {...focusProps(`ov${id}-original`, 4, 1, translation.status === 'idle' && !lyrics.sessionWide)} class="text-action" onClick={() => { void lyrics.showOriginal(); toast(t('lyrics.tr.cleared')); }}>{t('lyrics.tr.original')}</button>
        <button {...focusProps(`ov${id}-done`, 4, 2)} class="text-action" onClick={close}>{t('pm.done')}</button>
      </div>
    </div>
  );
}

registerOverlay('lyricsProvider', (overlay, { close }) => <ProviderOverlay id={overlay.id} close={close} />);
registerOverlay('lyricsEditor', (overlay, { close }) => <EditorOverlay id={overlay.id} close={close} />);
registerOverlay('lyricsTranslate', (overlay, { close }) => <TranslateOverlay id={overlay.id} close={close} />);

/** A lyrics source's name and note in the language on screen; brand names stay as they are. */
const providerName = (provider: ProviderDefinition, t: (key: StringKey) => string): string => provider.id === 'YouTubeSubtitle' || provider.id === 'YouTubeCaptions' ? t(`lyrics.prov.name.${provider.id}` as StringKey) : provider.name;
const providerNote = (provider: ProviderDefinition, t: (key: StringKey) => string): string | undefined => provider.note ? t(`lyrics.prov.note.${provider.id}` as StringKey) : undefined;
