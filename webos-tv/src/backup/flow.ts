import type { PreferencesStore } from '../library/preferences';
import type { LibraryRepository } from '../library/repository';
import { parseCsv, importCsv, previewCsv, MAX_CSV_BYTES, type CsvSummary, type ParsedCsv } from './csv';
import { BackupError, importPortable, parsePortable, previewPortable, type ImportMode, type ImportSummary, type ParsedBackup } from './portable';
import { tr } from '../app/i18n';

export type ImportKind = 'portable' | 'csv';
export type ImportSource = { from: 'phone'; device?: string } | { from: 'file'; name: string };

export type ImportState =
  | { status: 'idle' }
  | { status: 'ready'; kind: 'portable'; source: ImportSource; mode: ImportMode; summary: ImportSummary }
  | { status: 'ready'; kind: 'csv'; source: ImportSource; mode: 'merge'; csv: CsvSummary }
  | { status: 'importing'; kind: ImportKind }
  | { status: 'done'; kind: 'portable'; summary: ImportSummary }
  | { status: 'done'; kind: 'csv'; csv: CsvSummary }
  | { status: 'error'; message: string; retry: boolean };

/**
 * What happens to something that arrived (from the phone, or from a file): it is read and checked,
 * the user sees what it would do and chooses merge or replace, and only then is anything written.
 * Closing the preview throws the data away.
 */
export class ImportFlow {
  private state: ImportState = { status: 'idle' };
  private readonly listeners = new Set<() => void>();
  private pending: { kind: 'portable'; backup: ParsedBackup; source: ImportSource } | { kind: 'csv'; csv: ParsedCsv; source: ImportSource } | undefined;
  private generation = 0;

  constructor(private readonly repo: LibraryRepository, private readonly prefs: PreferencesStore) {}

  getSnapshot = (): ImportState => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(state: ImportState) { this.state = state; this.listeners.forEach((listener) => listener()); }

  /** Reads and checks `text`, then shows what importing would do. Nothing is written yet. */
  async receive(kind: ImportKind, text: string, source: ImportSource): Promise<void> {
    const generation = ++this.generation;
    try {
      if (kind === 'csv') {
        if (text.length > MAX_CSV_BYTES) throw new BackupError('File CSV terlalu besar (maksimal 10 MiB).');
        const csv = parseCsv(text);
        if (csv.liked.length === 0 && csv.playlists.length === 0) throw new BackupError(tr('err.backup.csvEmpty'));
        const summary = await previewCsv(this.repo, csv);
        if (generation !== this.generation) return;
        this.pending = { kind: 'csv', csv, source };
        this.set({ status: 'ready', kind: 'csv', source, mode: 'merge', csv: summary });
        return;
      }
      const backup = parsePortable(text);
      const summary = await previewPortable(this.repo, backup, 'merge');
      if (generation !== this.generation) return;
      this.pending = { kind: 'portable', backup, source };
      this.set({ status: 'ready', kind: 'portable', source, mode: 'merge', summary });
    } catch (error) {
      if (generation !== this.generation) return;
      this.pending = undefined;
      this.set({ status: 'error', message: error instanceof BackupError ? error.message : tr('err.backup.dataFail'), retry: false });
    }
  }

  /** Merge keeps what is on the TV; replace swaps the collection (the preview then lists what goes). */
  async setMode(mode: ImportMode): Promise<void> {
    const pending = this.pending;
    if (!pending || pending.kind !== 'portable' || this.state.status !== 'ready') return;
    const generation = ++this.generation;
    const summary = await previewPortable(this.repo, pending.backup, mode);
    if (generation !== this.generation || this.pending !== pending) return;
    this.set({ status: 'ready', kind: 'portable', source: pending.source, mode, summary });
  }

  async apply(): Promise<void> {
    const pending = this.pending;
    const state = this.state;
    if (!pending || state.status !== 'ready') return;
    this.set({ status: 'importing', kind: pending.kind });
    try {
      if (pending.kind === 'csv') this.set({ status: 'done', kind: 'csv', csv: await importCsv(this.repo, pending.csv) });
      else this.set({ status: 'done', kind: 'portable', summary: await importPortable(this.repo, this.prefs, pending.backup, { mode: (state as { mode: ImportMode }).mode }) });
      this.pending = undefined;
    } catch (error) {
      // The write was all-or-nothing, so the TV is as it was and the same file can be tried again.
      this.set({ status: 'error', message: error instanceof Error ? error.message : tr('err.import.failed'), retry: true });
    }
  }

  /** Back to the preview after a failed write. */
  retry(): void {
    const pending = this.pending;
    if (this.state.status === 'error' && this.state.retry && pending) void (pending.kind === 'portable' ? this.receiveAgain(pending.backup, pending.source) : this.receiveCsvAgain(pending.csv, pending.source));
  }
  private async receiveAgain(backup: ParsedBackup, source: ImportSource) {
    const summary = await previewPortable(this.repo, backup, 'merge');
    this.set({ status: 'ready', kind: 'portable', source, mode: 'merge', summary });
  }
  private async receiveCsvAgain(csv: ParsedCsv, source: ImportSource) {
    this.set({ status: 'ready', kind: 'csv', source, mode: 'merge', csv: await previewCsv(this.repo, csv) });
  }

  /** Throws away what arrived. */
  discard(): void {
    this.generation += 1;
    this.pending = undefined;
    this.set({ status: 'idle' });
  }
}
