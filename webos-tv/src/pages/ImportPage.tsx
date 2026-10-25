import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../app/AppContext';
import { focusProps } from '../app/format';
import { Icon } from '../components/Icon';
import { providerLabel } from '../importers/overlays';
import type { ImportLogRecord } from '../library/types';

const MAX_FILE = 64 * 1024 * 1024;

/** FileReader rather than Blob.text(): older webOS browsers do not have the latter. */
const readText = (file: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result ?? ''));
  reader.onerror = () => reject(reader.error ?? new Error('read failed'));
  reader.readAsText(file);
});

/** Where music comes in from and where the collection goes out: the phone, a file, a backup. */
export function ImportPage() {
  const { t, services, importFlow, openOverlay, toast } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [history, setHistory] = useState<ImportLogRecord[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => { void services.repo.importLog().then((log) => { if (alive) setHistory(log); }).catch(() => {}); };
    load();
    const stop = services.repo.subscribe(load);
    return () => { alive = false; stop(); };
  }, [services]);

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_FILE) { toast(t('import.tooBig')); return; }
    let text: string;
    try { text = await readText(file); } catch { toast(t('import.readFailed')); return; }
    const csv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
    await importFlow.receive(csv ? 'csv' : 'portable', text, { from: 'file', name: file.name });
    openOverlay('importPreview', { openerFocusId: 'import-file' });
  }

  return (
    <section class="detail-view import-view" aria-labelledby="import-heading">
      <h1 id="import-heading">{t('import.title')}</h1>
      <div class="lib-sources">
        <button {...focusProps('import-phone', 1, 0)} class="lib-source-card" onClick={() => openOverlay('pairing', { openerFocusId: 'import-phone' })}>
          <span class="result-title"><Icon name="qr-code" /> {t('import.phone')}</span><span class="result-artist">{t('import.phoneHint')}</span>
        </button>
        <button {...focusProps('import-link', 1, 1)} class="lib-source-card" onClick={() => openOverlay('linkImport', { openerFocusId: 'import-link' })}>
          <span class="result-title"><Icon name="link" /> {t('import.link')}</span><span class="result-artist">{t('import.linkHint')}</span>
        </button>
        <button {...focusProps('import-file', 2, 0)} class="lib-source-card" onClick={() => input.current?.click()}>
          <span class="result-title"><Icon name="file-music" /> {t('import.file')}</span><span class="result-artist">{t('import.fileHint')}</span>
        </button>
        <input ref={input} class="visually-hidden" type="file" accept=".json,.csv,application/json,text/csv" tabIndex={-1} aria-hidden="true" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void readFile(file); }} />
        <div class="lib-source-card is-unavailable" role="note">
          <span class="result-title"><Icon name="circle-alert" /> {t('import.account')}</span><span class="result-artist">{t('import.accountHint')}</span>
        </div>
      </div>
      <p class="detail-note">{t('import.zipNote')}</p>
      <h2 class="section-heading">{t('import.history')}</h2>
      {history.length === 0 ? <p class="message-state">{t('import.historyEmpty')}</p> : (
        <>
          <ul class="link-history">
            {history.slice(0, 12).map((entry, index) => (
              <li key={entry.id}>
                <div>
                  <span class="result-title">{entry.name}</span>
                  <span class="result-artist">{providerLabel(entry.provider, t)} · {t(`import.status.${entry.status}` as 'import.status.done')} · {new Date(entry.at).toLocaleDateString()} · {t('import.historyLine', { matched: entry.matched, total: entry.total, unmatched: entry.unmatched })}</span>
                </div>
                {entry.url && entry.playlistId && <button {...focusProps(`import-refresh-${index}`, 4 + index, 0)} class="text-action" onClick={() => openOverlay('linkImport', { openerFocusId: `import-refresh-${index}`, props: { refreshPlaylistId: entry.playlistId } })}>{t('import.refresh')}</button>}
              </li>
            ))}
          </ul>
          <button {...focusProps('import-clear-log', 20, 0)} class="text-action" onClick={() => void services.repo.clearImportLog()}>{t('import.historyClear')}</button>
        </>
      )}
    </section>
  );
}
