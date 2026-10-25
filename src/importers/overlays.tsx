import { useEffect, useMemo, useState } from 'preact/hooks';
import { useApp } from '../app/AppContext';
import { focusProps } from '../app/format';
import { registerOverlay } from '../app/OverlayHost';
import { useSnapshot } from '../app/useSnapshot';
import type { Translate } from '../app/i18n';
import type { LinkProvider } from './link';
import type { ImportResult } from './runner';

type Props = { id: number; close(): void; refreshPlaylistId?: string };

export const providerLabel = (provider: string, t: Translate) =>
  ({ spotify: 'Spotify', applemusic: 'Apple Music', deezer: 'Deezer', youtube: 'YouTube Music', tidal: 'Tidal', csv: 'CSV' } as Record<string, string>)[provider] ?? t('link.source.other');

function Results({ id, result, close }: { id: number; result: ImportResult; close(): void }) {
  const { t } = useApp();
  return (
    <div class="overlay-panel link-panel">
      <h2>{t(result.partial ? 'link.donePartial' : 'link.done')}</h2>
      <p class="overlay-body" role="status">{t('link.doneSummary', { name: result.name, source: providerLabel(result.provider, t), matched: result.matched, total: result.total })}</p>
      <ul class="preview-lines">
        <li>{t(result.mode === 'resync' ? 'link.addedResync' : 'link.added', { count: result.added })}</li>
        {result.alreadyThere > 0 && <li>{t('link.alreadyThere', { count: result.alreadyThere })}</li>}
        {result.none > 0 && <li>{t('link.none', { count: result.none })}</li>}
        {result.failed > 0 && <li class="is-error">{t('link.failed', { count: result.failed })}</li>}
      </ul>
      {result.warnings.map((warning) => <p class="studio-hint" key={warning}>{warning}</p>)}
      {result.unmatched.length > 0 && (
        <div class="link-unmatched" role="group" aria-label={t('link.unmatched')}>
          <p class="studio-hint">{t('link.unmatched')}</p>
          <ul class="link-unmatched-list">
            {result.unmatched.map((song) => <li key={song.label} class={song.reason === 'failed' ? 'is-error' : ''}>{song.label}{song.reason === 'failed' ? ` — ${t('link.searchFailed')}` : ''}</li>)}
          </ul>
          {result.none + result.failed > result.unmatched.length && <p class="studio-hint">{t('link.moreUnmatched', { count: result.none + result.failed - result.unmatched.length })}</p>}
        </div>
      )}
      <div class="overlay-actions"><button {...focusProps(`ov${id}-close`, 1, 0)} class="text-action" onClick={close}>{t('preview.close')}</button></div>
    </div>
  );
}

function LinkImportOverlay({ id, close, refreshPlaylistId }: Props) {
  const { t, importRunner: runner } = useApp();
  const state = useSnapshot(runner);
  const [text, setText] = useState('');
  useEffect(() => {
    runner.discard();
    if (refreshPlaylistId) void runner.refresh(refreshPlaylistId);
    // Closing (Back included) abandons a run that is still being set up; a finished one is already written.
    return () => { if (!['done', 'saving'].includes(runner.getSnapshot().status)) runner.discard(); };
  }, [runner, refreshPlaylistId]);

  if (state.status === 'done') return <Results id={id} result={state.result} close={close} />;

  if (state.status === 'reading' || state.status === 'saving') {
    return (
      <div class="overlay-panel link-panel">
        <h2>{t('link.title')}</h2>
        <p class="overlay-body" role="status">{t(state.status === 'reading' ? 'link.reading' : 'link.saving')}</p>
        {state.status === 'reading' && <div class="overlay-actions"><button {...focusProps(`ov${id}-stop`, 1, 0)} class="text-action" onClick={() => { runner.discard(); if (refreshPlaylistId) close(); }}>{t('common.cancel')}</button></div>}
      </div>
    );
  }

  if (state.status === 'preview') {
    const { preview, mode, existing } = state;
    return (
      <div class="overlay-panel link-panel">
        <h2>{preview.name}</h2>
        <p class="studio-hint">{t(preview.kind === 'album' ? 'link.fromAlbum' : 'link.fromPlaylist', { source: providerLabel(preview.provider, t), count: preview.tracks.length })}</p>
        {preview.warnings.map((warning) => <p class="overlay-body is-warning" role="note" key={warning}>{warning}</p>)}
        {mode === 'resync' && existing && <p class="overlay-body">{t('link.existing', { name: existing.name, count: existing.songs })}</p>}
        <p class="studio-hint">{t(preview.provider === 'youtube' ? 'link.exactNote' : 'link.matchNote')}</p>
        <p class="studio-hint">{t('link.readOnly')}</p>
        <div class="overlay-actions">
          <button {...focusProps(`ov${id}-go`, 1, 0)} class="text-action" onClick={() => void runner.start()}>{t(mode === 'resync' ? 'link.refreshGo' : 'link.go')}</button>
          <button {...focusProps(`ov${id}-cancel`, 1, 1)} class="text-action" onClick={() => { runner.discard(); if (refreshPlaylistId) close(); }}>{t('common.cancel')}</button>
        </div>
      </div>
    );
  }

  if (state.status === 'matching' || state.status === 'paused') {
    const total = state.preview.tracks.length;
    const percent = total ? Math.round((state.done / total) * 100) : 0;
    const paused = state.status === 'paused';
    return (
      <div class="overlay-panel link-panel">
        <h2>{state.preview.name}</h2>
        <div class="link-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={t('link.progress')} style={{ '--progress': `${percent}%` }} />
        <p class="overlay-body" role="status" aria-live="off">{t('link.counts', { done: state.done, total, matched: state.matched, none: state.none, failed: state.failed })}</p>
        {!paused && state.current && <p class="studio-hint link-current">{state.current}</p>}
        {paused && <p class="studio-hint">{t('link.pausedNote')}</p>}
        <div class="overlay-actions">
          {paused ? (
            <>
              <button {...focusProps(`ov${id}-resume`, 1, 0)} class="text-action" onClick={() => void runner.start()}>{t('link.resume')}</button>
              <button {...focusProps(`ov${id}-save`, 1, 1, state.matched === 0)} class="text-action" onClick={() => void runner.saveFound()}>{t('link.saveFound', { count: state.matched })}</button>
              <button {...focusProps(`ov${id}-drop`, 1, 2)} class="text-action" onClick={() => { runner.discard(); close(); }}>{t('link.discard')}</button>
            </>
          ) : (
            <button {...focusProps(`ov${id}-stop`, 1, 0)} class="text-action" onClick={() => runner.cancel()}>{t('link.stop')}</button>
          )}
        </div>
      </div>
    );
  }

  const failure = state.status === 'error' ? state : undefined;
  const submit = () => { if (text.trim()) void runner.read(text); };
  return (
    <div class="overlay-panel link-panel">
      <h2>{t('link.title')}</h2>
      <p class="studio-hint">{t('link.hint')}</p>
      <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <label class="search-field">
          <input {...focusProps(`ov${id}-link`, 1, 0)} type="url" inputMode="url" value={text} placeholder="https://open.spotify.com/playlist/…" aria-label={t('link.label')} onInput={(event) => setText(event.currentTarget.value)} />
        </label>
      </form>
      {failure && <p class="overlay-body is-error" role="alert">{failure.message}</p>}
      <p class="studio-hint">{t('link.limits')}</p>
      <div class="overlay-actions">
        <button {...focusProps(`ov${id}-read`, 2, 0, !text.trim())} class="text-action" onClick={submit}>{t('link.read')}</button>
        {failure?.retry && text.trim() && <button {...focusProps(`ov${id}-again`, 2, 1)} class="text-action" onClick={submit}>{t('preview.retry')}</button>}
        <button {...focusProps(`ov${id}-close`, 2, failure?.retry ? 2 : 1)} class="text-action" onClick={close}>{t('preview.close')}</button>
      </div>
    </div>
  );
}

registerOverlay('linkImport', (overlay, { close }) => <LinkImportOverlay id={overlay.id} close={close} refreshPlaylistId={(overlay.props as { refreshPlaylistId?: string } | undefined)?.refreshPlaylistId} />);
export type { LinkProvider };
