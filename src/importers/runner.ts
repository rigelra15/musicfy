import { tr } from '../app/i18n';
import type { CatalogGateway } from '../catalog/gateway';
import { trackKeyOf } from '../domain/entity';
import type { LibraryRepository } from '../library/repository';
import type { ImportLogRecord, LibraryRecord, PlaylistEntryRecord, PlaylistRecord, StoredTrack } from '../library/types';
import type { Track } from '../model';
import { LinkImportError, readLink, type LinkPreview, type LinkTrack } from './link';
import { MatchSearchError, TrackMatcher } from './matcher';

const PARALLEL = 4;
const MAX_LISTED = 50;

/** What happened to one song: found, searched without a match, or the search itself failed (worth another try). */
export type SongOutcome = { state: 'matched'; track: Track; exact: boolean } | { state: 'none' } | { state: 'failed' };

export interface UnmatchedSong { label: string; reason: 'none' | 'failed' }
export interface ImportResult {
  provider: LinkPreview['provider'];
  kind: LinkPreview['kind'];
  name: string;
  playlistId: string;
  mode: 'new' | 'resync';
  total: number;
  matched: number;
  /** New entries in the TV playlist (a refresh adds only what was not there). */
  added: number;
  alreadyThere: number;
  none: number;
  failed: number;
  unmatched: UnmatchedSong[];
  warnings: string[];
  /** Written before every song was tried (stopped early). */
  partial: boolean;
}

export type RunState =
  | { status: 'idle' }
  | { status: 'reading' }
  | { status: 'preview'; preview: LinkPreview; mode: 'new' | 'resync'; existing?: { playlistId: string; name: string; songs: number } }
  | { status: 'matching'; preview: LinkPreview; done: number; matched: number; none: number; failed: number; current?: string }
  | { status: 'paused'; preview: LinkPreview; done: number; matched: number; none: number; failed: number }
  | { status: 'saving'; preview: LinkPreview }
  | { status: 'done'; result: ImportResult }
  | { status: 'error'; message: string; retry: boolean };

export const playlistIdFor = (preview: Pick<LinkPreview, 'provider' | 'kind' | 'remoteId'>) => `import:${preview.provider}:${preview.kind}:${preview.remoteId}`;
const labelOf = (song: LinkTrack) => (song.artist ? `${song.title} · ${song.artist}` : song.title);

/**
 * Reads a share link, finds each song on YouTube, and writes one playlist. Nothing is written until
 * the person has seen what was read; a stopped run keeps what it found and can be resumed, and the
 * write is all-or-nothing. A refresh reads the same link again and adds only the songs that are new:
 * nothing is ever removed from the TV copy and nothing is written back to the service.
 */
export class ImportRunner {
  private state: RunState = { status: 'idle' };
  private readonly listeners = new Set<() => void>();
  private preview: LinkPreview | undefined;
  private mode: 'new' | 'resync' = 'new';
  private outcomes: Array<SongOutcome | undefined> = [];
  private matcher: TrackMatcher;
  private abort: AbortController | undefined;
  private generation = 0;

  constructor(
    private readonly repo: LibraryRepository,
    private readonly catalog: Pick<CatalogGateway, 'search' | 'playlist' | 'album' | 'more'>,
    private readonly options: { fetcher?: Parameters<typeof readLink>[1]['fetcher']; now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
  ) {
    this.matcher = new TrackMatcher(catalog, options.sleep);
  }

  getSnapshot = (): RunState => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(state: RunState) { this.state = state; this.listeners.forEach((listener) => listener()); }
  private now() { return this.options.now ? this.options.now() : Date.now(); }

  /** Reads the link and shows what it holds. */
  async read(text: string): Promise<void> {
    const generation = ++this.generation;
    this.abort?.abort();
    this.abort = new AbortController();
    this.set({ status: 'reading' });
    try {
      const preview = await readLink(text, { catalog: this.catalog, fetcher: this.options.fetcher, signal: this.abort.signal });
      if (generation !== this.generation) return;
      await this.show(preview);
    } catch (error) {
      if (generation !== this.generation || (error as { name?: string })?.name === 'AbortError') return;
      this.set({ status: 'error', message: error instanceof Error ? error.message : tr('err.link.unreadable'), retry: !(error instanceof LinkImportError) || ['network', 'rateLimited', 'upstream'].includes(error.kind) });
    }
  }

  private async show(preview: LinkPreview) {
    const playlistId = playlistIdFor(preview);
    const existing = (await this.repo.listPlaylists()).find((item) => item.id === playlistId);
    this.preview = preview;
    this.mode = existing ? 'resync' : 'new';
    this.outcomes = new Array(preview.tracks.length).fill(undefined);
    this.matcher = new TrackMatcher(this.catalog, this.options.sleep);
    this.set({ status: 'preview', preview, mode: this.mode, ...(existing ? { existing: { playlistId, name: existing.name, songs: existing.trackCount ?? 0 } } : {}) });
  }

  /** Reads a playlist copy's link again, so "perbarui" can add what is new. */
  async refresh(playlistId: string): Promise<void> {
    const playlist = (await this.repo.listPlaylists()).find((item) => item.id === playlistId);
    const url = playlist?.source?.url;
    if (!playlist || !url) { this.set({ status: 'error', message: tr('err.link.noOrigin'), retry: false }); return; }
    await this.read(url);
  }

  /** Starts matching; also continues a paused run, trying again the songs whose search failed. */
  async start(): Promise<void> {
    const preview = this.preview;
    if (!preview || !['preview', 'paused', 'matching'].includes(this.state.status)) return;
    const generation = ++this.generation;
    const abort = new AbortController();
    this.abort = abort;
    const todo = preview.tracks.map((_, index) => index).filter((index) => !this.outcomes[index] || this.outcomes[index]!.state === 'failed');
    const counts = () => {
      let matched = 0; let none = 0; let failed = 0; let done = 0;
      for (const outcome of this.outcomes) { if (!outcome) continue; done += 1; if (outcome.state === 'matched') matched += 1; else if (outcome.state === 'none') none += 1; else failed += 1; }
      return { done, matched, none, failed };
    };
    this.set({ status: 'matching', preview, ...counts() });
    let cursor = 0;
    const worker = async () => {
      while (!abort.signal.aborted) {
        const index = todo[cursor++];
        if (index === undefined) return;
        const song = preview.tracks[index];
        let outcome: SongOutcome;
        if (song.resolved) outcome = { state: 'matched', track: song.resolved, exact: true };
        else {
          try {
            const found = await this.matcher.match(song, abort.signal);
            outcome = found ? { state: 'matched', track: found.track, exact: false } : { state: 'none' };
          } catch (error) {
            if (abort.signal.aborted || (error as { name?: string })?.name === 'AbortError') return;
            if (!(error instanceof MatchSearchError)) throw error;
            outcome = { state: 'failed' };
          }
        }
        if (abort.signal.aborted) return;
        this.outcomes[index] = outcome;
        if (generation === this.generation) this.set({ status: 'matching', preview, ...counts(), current: labelOf(song) });
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker));
    } catch (error) {
      if (generation === this.generation) this.set({ status: 'error', message: error instanceof Error ? error.message : tr('err.match.failed'), retry: true });
      return;
    }
    if (generation !== this.generation) return;
    if (abort.signal.aborted) { this.set({ status: 'paused', preview, ...counts() }); return; }
    await this.save(false);
  }

  /** Stops matching; what was found stays, and start() continues from there. */
  cancel(): void {
    if (this.state.status !== 'matching') return;
    this.abort?.abort();
    const { preview, done, matched, none, failed } = this.state;
    this.set({ status: 'paused', preview, done, matched, none, failed });
  }

  /** From a paused run: keep the songs found so far and leave out the rest. */
  async saveFound(): Promise<void> {
    if (this.state.status === 'paused') await this.save(true);
  }

  discard(): void {
    this.generation += 1;
    this.abort?.abort();
    this.preview = undefined;
    this.outcomes = [];
    this.set({ status: 'idle' });
  }

  private lastPartial = false;

  private async save(partial: boolean): Promise<void> {
    const preview = this.preview;
    if (!preview) return;
    this.lastPartial = partial;
    this.set({ status: 'saving', preview });
    const generation = this.generation;
    try {
      const result = await this.write(preview, partial);
      if (generation === this.generation) this.set({ status: 'done', result });
    } catch (error) {
      // The write was all-or-nothing, so the TV is as it was; the matches are kept for another try.
      if (generation === this.generation) this.set({ status: 'error', message: error instanceof Error ? error.message : tr('err.save.failed'), retry: true });
    }
  }

  /** After a failed save: back to where the write can be tried again. */
  retrySave(): void {
    if (this.preview && this.outcomes.some(Boolean)) void this.save(this.lastPartial);
  }

  private async write(preview: LinkPreview, partial: boolean): Promise<ImportResult> {
    const at = this.now();
    const playlistId = playlistIdFor(preview);
    const source = `import:${preview.provider}`;
    const found: Array<{ track: Track; key: string }> = [];
    const unmatched: UnmatchedSong[] = [];
    let none = 0; let failed = 0;
    preview.tracks.forEach((song, index) => {
      const outcome = this.outcomes[index];
      if (outcome?.state === 'matched') found.push({ track: outcome.track, key: trackKeyOf(outcome.track) });
      else if (outcome?.state === 'none') { none += 1; if (unmatched.length < MAX_LISTED) unmatched.push({ label: labelOf(song), reason: 'none' }); }
      else if (outcome?.state === 'failed') { failed += 1; if (unmatched.length < MAX_LISTED) unmatched.push({ label: labelOf(song), reason: 'failed' }); }
    });
    let added = 0;
    let mode: 'new' | 'resync' = 'new';
    await this.repo.transaction(['tracks', 'library', 'playlists', 'playlistEntries', 'importLog'], async (tx) => {
      const existing = await tx.get<PlaylistRecord>('playlists', playlistId);
      mode = existing ? 'resync' : 'new';
      const entries = existing ? await tx.getAllBy<PlaylistEntryRecord>('playlistEntries', 'playlistId', playlistId) : [];
      const known = new Set(entries.map((entry) => entry.entryId));
      let position = entries.reduce((max, entry) => Math.max(max, entry.position + 1), 0);
      const seen = new Map<string, number>();
      for (const { track, key } of found) {
        if (!(await tx.get('tracks', key))) await tx.put('tracks', { trackKey: key, track, updatedAt: at } satisfies StoredTrack);
        if (!(await tx.get('library', key))) await tx.put('library', { trackKey: key, addedAt: at, source } satisfies LibraryRecord);
        // The same song listed twice is two entries; the nth copy always gets the same identity.
        const nth = (seen.get(key) ?? 0) + 1;
        seen.set(key, nth);
        const entryId = `${playlistId}:${key}:${nth}`;
        if (known.has(entryId)) continue;
        known.add(entryId);
        added += 1;
        await tx.put('playlistEntries', { entryId, playlistId, position: position++, trackKey: key, addedAt: at, importKey: entryId } satisfies PlaylistEntryRecord);
      }
      const sourceRecord = { provider: preview.provider, id: preview.remoteId, title: preview.name, importedAt: existing?.source?.importedAt ?? at, reportedTrackCount: preview.tracks.length, ...(preview.url ? { url: preview.url } : {}), syncedAt: at };
      await tx.put('playlists', { ...(existing ?? { id: playlistId, name: preview.name.slice(0, 120), createdAt: at }), updatedAt: at, source: sourceRecord } satisfies PlaylistRecord);
      const log: ImportLogRecord = {
        id: `log:${at}:${Math.random().toString(36).slice(2, 8)}`, at, provider: preview.provider, kind: preview.kind, remoteId: preview.remoteId, url: preview.url || undefined, name: preview.name, playlistId,
        total: preview.tracks.length, matched: found.length, added, unmatched: none + failed, unmatchedTitles: unmatched.map((song) => song.label), warnings: preview.warnings,
        status: mode === 'resync' ? 'resync' : partial ? 'partial' : 'done',
      };
      await tx.put('importLog', log);
    });
    return { provider: preview.provider, kind: preview.kind, name: preview.name, playlistId, mode, total: preview.tracks.length, matched: found.length, added, alreadyThere: found.length - added, none, failed, unmatched, warnings: preview.warnings, partial };
  }
}
