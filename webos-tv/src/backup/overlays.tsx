import { useEffect, useMemo, useState } from 'preact/hooks';
import { useApp } from '../app/AppContext';
import { focusProps } from '../app/format';
import { registerOverlay } from '../app/OverlayHost';
import { useSnapshot } from '../app/useSnapshot';
import { QrCode } from '../components/QrCode';
import { Row } from '../features/playerMenu/overlays';
import type { Counts, ImportSummary } from './portable';
import { PairingSession } from './pairing';
import type { ImportSource } from './flow';

type Props = { id: number; close(): void };

const clock = (ms: number) => { const total = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`; };

function PairingOverlay({ id, close }: Props) {
  const { t, importFlow, openOverlay, toast, sourceStatus } = useApp();
  const session = useMemo(() => new PairingSession({
    deviceName: 'Musicfy TV',
    onPayload: (kind, text, device) => {
      void importFlow.receive(kind, text, { from: 'phone', device }).then(() => { close(); openOverlay('importPreview'); });
    },
    onPrivate: (kind) => {
      close();
      if (kind === 'applemusic-session') { toast(t('modules.appleConnected')); void sourceStatus.refresh(); }
    },
  }), [importFlow]);
  const state = useSnapshot(session);
  useEffect(() => {
    void session.start();
    // The listener lives only while this screen is looked at: leaving it, or the TV suspending the app, ends it.
    const hidden = () => { if (document.visibilityState === 'hidden') void session.cancel(); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', hidden);
    return () => { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', hidden); session.dispose(); };
  }, [session]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (state.phase !== 'waiting' && state.phase !== 'paired') return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [state.phase]);
  const live = ['starting', 'waiting', 'paired', 'receiving'].includes(state.phase);
  const percent = state.totalBytes ? Math.round(((state.receivedBytes ?? 0) / state.totalBytes) * 100) : 0;
  const status = state.phase === 'starting' ? t('pair.starting')
    : state.phase === 'waiting' ? t('pair.waiting')
      : state.phase === 'paired' ? t('pair.paired', { device: state.device ? ` (${state.device})` : '' })
        : state.phase === 'receiving' ? t('pair.receiving', { percent })
          : state.phase === 'received' ? t('pair.received')
            : state.error ?? t(state.phase === 'expired' ? 'pair.expired' : state.phase === 'cancelled' ? 'pair.cancelled' : 'pair.failed');
  return (
    <div class="overlay-panel pairing-panel">
      <h2>{t('pair.title')}</h2>
      {state.qr && state.phase === 'waiting' && <QrCode value={state.qr} label={t('pair.qrLabel')} />}
      {state.phase === 'waiting' && <p class="studio-hint">{t('pair.step1')} {t('pair.step2')}</p>}
      {state.expiresAt && (state.phase === 'waiting' || state.phase === 'paired') && <p class="studio-hint" aria-live="off">{t('pair.expires', { time: clock(state.expiresAt - Date.now()) })}</p>}
      <p class={`overlay-body ${['failed', 'expired'].includes(state.phase) ? 'is-error' : ''}`} role="status">{status}</p>
      <div class="overlay-actions">
        {!live && state.phase !== 'received' && <button {...focusProps(`ov${id}-again`, 1, 0)} class="text-action" onClick={() => void session.start()}>{t('pair.again')}</button>}
        <button {...focusProps(`ov${id}-cancel`, 1, 1)} class="text-action" onClick={close}>{live ? t('pair.cancel') : t('preview.close')}</button>
      </div>
    </div>
  );
}

// ---- preview ------------------------------------------------------------------------------

function sourceName(source: ImportSource, t: ReturnType<typeof useApp>['t']) {
  return source.from === 'phone' ? t('preview.phone', { device: source.device ?? '' }).trim() : t('preview.file', { name: source.name });
}

function summaryLines(summary: ImportSummary, t: ReturnType<typeof useApp>['t']): string[] {
  const a: Counts = summary.added;
  const lines: string[] = [];
  if (summary.total.songs) lines.push(t('preview.songs', { added: a.songs, total: summary.total.songs }));
  if (summary.total.likes) lines.push(t('preview.likes', { added: a.likes, total: summary.total.likes }));
  if (summary.total.playlists) lines.push(t('preview.playlists', { added: a.playlists, songs: a.playlistSongs }));
  if (summary.total.history) lines.push(t('preview.history', { added: a.history }));
  if (summary.total.pins) lines.push(t('preview.pins', { added: a.pins }));
  if (summary.total.saved) lines.push(t('preview.saved', { added: a.saved }));
  if (summary.total.lyrics) lines.push(t('preview.lyrics', { added: a.lyrics }));
  return lines;
}

function PreviewOverlay({ id, close }: Props) {
  const { t, importFlow, openOverlay, toast } = useApp();
  const state = useSnapshot(importFlow);
  // Closing the preview (Back included) throws the received data away.
  useEffect(() => () => { if (importFlow.getSnapshot().status !== 'done') importFlow.discard(); }, [importFlow]);

  if (state.status === 'importing') return <div class="overlay-panel"><h2>{t('preview.title')}</h2><p class="overlay-body" role="status">{t('preview.importing')}</p></div>;
  if (state.status === 'error') {
    return (
      <div class="overlay-panel">
        <h2>{t('preview.error')}</h2>
        <p class="overlay-body is-error" role="alert">{state.message}</p>
        <div class="overlay-actions">
          {state.retry && <button {...focusProps(`ov${id}-retry`, 1, 0)} class="text-action" onClick={() => importFlow.retry()}>{t('preview.retry')}</button>}
          <button {...focusProps(`ov${id}-close`, 1, 1)} class="text-action" onClick={close}>{t('preview.close')}</button>
        </div>
      </div>
    );
  }
  if (state.status === 'done') {
    const counts = state.kind === 'portable' ? { songs: state.summary.added.songs, playlists: state.summary.added.playlists, likes: state.summary.added.likes } : { songs: state.csv.playlistSongs, playlists: state.csv.playlists, likes: state.csv.likes };
    return (
      <div class="overlay-panel">
        <h2>{t('preview.done')}</h2>
        <p class="overlay-body" role="status">{t('preview.doneBody', counts)}</p>
        <div class="overlay-actions"><button {...focusProps(`ov${id}-close`, 1, 0)} class="text-action" onClick={close}>{t('preview.close')}</button></div>
      </div>
    );
  }
  if (state.status !== 'ready') return <div class="overlay-panel"><h2>{t('preview.title')}</h2><div class="overlay-actions"><button {...focusProps(`ov${id}-close`, 1, 0)} class="text-action" onClick={close}>{t('preview.close')}</button></div></div>;

  const lines = state.kind === 'portable' ? summaryLines(state.summary, t) : [
    t('preview.likes', { added: state.csv.likes, total: state.csv.likes }), t('preview.playlists', { added: state.csv.playlists, songs: state.csv.playlistSongs }),
  ].filter((_, i) => (i === 0 ? state.csv.likes > 0 : state.csv.playlists > 0));
  const nothing = state.kind === 'portable' && state.mode === 'merge' && Object.values(state.summary.added).every((n) => n === 0);
  const replace = state.kind === 'portable' && state.mode === 'replace';
  let row = 0;
  const apply = () => {
    if (replace) { openOverlay('confirm', { props: { title: t('preview.confirmReplace'), body: t('preview.confirmReplaceBody'), confirmLabel: t('preview.applyReplace'), onConfirm: () => { void importFlow.apply().then(() => toast(t('preview.done'))); } } }); return; }
    void importFlow.apply().then(() => toast(t('preview.done')));
  };
  return (
    <div class="overlay-panel">
      <h2>{t('preview.title')}</h2>
      <p class="studio-hint">{t('preview.from', { source: sourceName(state.source, t) })}</p>
      {state.kind === 'portable' && (
        <div class="overlay-list" role="group" aria-label={t('preview.mode')}>
          <Row id={`ov${id}-merge`} row={(row += 1)} label={t('preview.merge')} selected={state.mode === 'merge'} note={t('preview.mergeHint')} onSelect={() => void importFlow.setMode('merge')} />
          <Row id={`ov${id}-replace`} row={(row += 1)} label={t('preview.replace')} selected={state.mode === 'replace'} note={t('preview.replaceHint')} onSelect={() => void importFlow.setMode('replace')} />
        </div>
      )}
      <ul class="preview-lines">{lines.map((line) => <li key={line}>{line}</li>)}</ul>
      {nothing && <p class="overlay-body">{t('preview.nothing')}</p>}
      {replace && <p class="overlay-body is-error">{t('preview.removed', { songs: state.summary.removed.songs, likes: state.summary.removed.likes, playlists: state.summary.removed.playlists, history: state.summary.removed.history })}</p>}
      {state.kind === 'portable' && state.summary.needsTransfer > 0 && <p class="studio-hint">{t('preview.needsTransfer', { count: state.summary.needsTransfer })}</p>}
      {state.kind === 'portable' && state.summary.skipped > 0 && <p class="studio-hint">{t('preview.skipped', { count: state.summary.skipped })}</p>}
      {state.kind === 'csv' && state.csv.unresolved > 0 && <p class="studio-hint">{t('preview.csvUnresolved', { count: state.csv.unresolved })}</p>}
      <div class="overlay-actions">
        <button {...focusProps(`ov${id}-apply`, 10, 0, nothing)} class="text-action" onClick={apply}>{replace ? t('preview.applyReplace') : t('preview.apply')}</button>
        <button {...focusProps(`ov${id}-discard`, 10, 1)} class="text-action" onClick={close}>{t('preview.discard')}</button>
      </div>
    </div>
  );
}

registerOverlay('pairing', (overlay, { close }) => <PairingOverlay id={overlay.id} close={close} />);
registerOverlay('importPreview', (overlay, { close }) => <PreviewOverlay id={overlay.id} close={close} />);
