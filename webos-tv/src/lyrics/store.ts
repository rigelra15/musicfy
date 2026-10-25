import { tr } from '../app/i18n';
import { PREF_LYRICS_DETAIL, PREF_LYRICS_MOTION, PREF_LYRICS_SOURCE } from '../library/migrations';
import type { PreferencesStore } from '../library/preferences';
import type { LibraryRepository } from '../library/repository';
import type { Track } from '../model';
import { trackKeyOf } from '../domain/entity';
import { documentFromLrc, editorLines, lrcFromLines, textLines, type EditorLine } from './edit';
import { LyricsController, USER_EDITED, isKnownSource, type LyricsSnapshot } from './selection';
import { dropUnchanged, translationKey, type TranslateFn } from './translation';
import type { LyricsDetail, RequestLyrics, SourceLyricsDocument } from './types';

export const PREF_TRANSLATE_TARGET = 'lyrics.translate.target';
export const PREF_TRANSLATE_SOURCE = 'lyrics.translate.source';
export const PREF_TRANSLATE_SESSION = 'lyrics.translate.session';
export const PREF_READINGS = 'lyrics.readings';

export interface TranslationState {
  status: 'idle' | 'translating' | 'ready' | 'error';
  /** Which lyrics these lines belong to; they are shown only while those lyrics are showing. */
  docKey: string | null;
  /** One entry per line of the lyrics; null where a line needs none (blank, or already in the target language). */
  lines: Array<string | null> | null;
  source: string;
  target: string;
  error?: string;
}

export interface LyricsViewState {
  track: Track | null;
  snapshot: LyricsSnapshot;
  /** A choice made for this song (saved), or undefined while it follows the default. */
  songChoice: string | undefined;
  translation: TranslationState;
}

const idleTranslation = (source = 'auto', target = 'en'): TranslationState => ({ status: 'idle', docKey: null, lines: null, source, target });
const emptySnapshot: LyricsSnapshot = { trackId: null, source: 'auto', results: [], document: null, complete: false };

/** A short fingerprint of what the lyrics say, so a translation is only ever shown over the text it was made from. */
export function documentKey(document: SourceLyricsDocument | null): string | null {
  if (!document || document.type === 'missing') return null;
  const text = textLines(document).join('\n');
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return `${document.source}:${text.length}:${(hash >>> 0).toString(36)}`;
}

export interface LyricsStoreDeps {
  repo: LibraryRepository;
  prefs: PreferencesStore;
  request: RequestLyrics;
  translate: TranslateFn;
  /** The language the TV's interface uses; the default translation target. */
  language(): string;
}

/**
 * Everything about the lyrics of the song that is playing: which provider is shown (chosen per
 * song, with a separate default), the user's own edit, translation and its cache. The view only
 * reads this; the overlays (provider, editor, translate) change it.
 */
export class LyricsStore {
  private state: LyricsViewState = { track: null, snapshot: emptySnapshot, songChoice: undefined, translation: idleTranslation() };
  private readonly listeners = new Set<() => void>();
  private readonly controller: LyricsController;
  private loadGeneration = 0;
  private translateGeneration = 0;
  private abort: AbortController | undefined;
  private touched = false;
  private disposed = false;
  private draft: { trackKey: string; rows: EditorLine[] } | null = null;

  constructor(private readonly deps: LyricsStoreDeps) {
    this.controller = new LyricsController(deps.request, (snapshot) => this.onSnapshot(snapshot), 'auto');
  }

  getSnapshot = (): LyricsViewState => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  get detail(): LyricsDetail {
    const value = this.deps.prefs.get<string>(PREF_LYRICS_DETAIL, 'auto');
    return value === 'line' || value === 'word' || value === 'syllable' ? value : 'auto';
  }
  get motion(): 'MOTION' | 'LEGACY' { return this.deps.prefs.get<string>(PREF_LYRICS_MOTION, 'MOTION') === 'LEGACY' ? 'LEGACY' : 'MOTION'; }
  get defaultSource(): string {
    const value = this.deps.prefs.get<string>(PREF_LYRICS_SOURCE, 'auto');
    return isKnownSource(value) && value !== USER_EDITED ? value : 'auto';
  }
  get sessionWide(): boolean { return this.deps.prefs.get<boolean>(PREF_TRANSLATE_SESSION, false) === true; }
  get readings(): boolean { return this.deps.prefs.get<boolean>(PREF_READINGS, true) !== false; }
  get target(): string { return this.deps.prefs.get<string>(PREF_TRANSLATE_TARGET, '') || this.deps.language(); }
  get translateSource(): string { return this.deps.prefs.get<string>(PREF_TRANSLATE_SOURCE, 'auto') || 'auto'; }

  private set(patch: Partial<LyricsViewState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  // ---- loading ------------------------------------------------------------------------------

  /** Called when the song changes (null when nothing is playing). */
  load(track: Track | null): void {
    const generation = ++this.loadGeneration;
    this.cancelTranslation();
    this.touched = false;
    if (this.draft && (!track || this.draft.trackKey !== trackKeyOf(track))) this.draft = null;
    if (!track) {
      this.controller.cancel();
      this.set({ track: null, snapshot: emptySnapshot, songChoice: undefined, translation: idleTranslation(this.translateSource, this.target) });
      return;
    }
    this.state = { ...this.state, track, songChoice: undefined, translation: idleTranslation(this.translateSource, this.target) };
    this.controller.setEdited(null);
    this.controller.start(track, this.defaultSource);
    // The saved choice and the user's own version arrive a moment later; nothing the user did in the
    // meantime is overridden.
    const key = trackKeyOf(track);
    void Promise.all([this.deps.repo.getLyricsChoice(key), this.deps.repo.getLyricsEdit(key)]).then(([choice, edit]) => {
      if (generation !== this.loadGeneration || this.disposed) return;
      const edited = edit ? documentFromLrc(edit.lrc) : null;
      if (edited) this.controller.setEdited(edited);
      if (choice && !this.touched && isKnownSource(choice) && (choice !== USER_EDITED || edited)) this.controller.select(choice);
      this.set({ songChoice: choice && isKnownSource(choice) ? choice : undefined });
    }).catch(() => undefined);
  }

  /** Looks everything up again (after an error, or to refresh). */
  retry(): void {
    if (this.state.track) this.load(this.state.track);
  }

  dispose(): void {
    this.disposed = true;
    this.controller.cancel();
    this.cancelTranslation();
    this.listeners.clear();
  }

  private onSnapshot(snapshot: LyricsSnapshot) {
    const key = documentKey(snapshot.document);
    const translation = this.state.translation;
    const stale = translation.docKey !== null && translation.docKey !== key;
    if (stale) this.cancelTranslation();
    this.set({ snapshot, translation: stale ? idleTranslation(this.translateSource, this.target) : this.state.translation });
    if (this.sessionWide && snapshot.document && key && (snapshot.complete || snapshot.source !== 'auto')) {
      const current = this.state.translation;
      if (current.docKey !== key && !(current.status === 'translating')) void this.translate();
    }
  }

  // ---- provider choice ----------------------------------------------------------------------

  /** The choice is for this song only; `asDefault` also makes it what every song starts on. */
  async selectSource(source: string, options: { asDefault?: boolean } = {}): Promise<void> {
    const track = this.state.track;
    if (!track || !isKnownSource(source)) return;
    this.touched = true;
    this.controller.select(source);
    this.set({ songChoice: source });
    await this.deps.repo.setLyricsChoice(trackKeyOf(track), source);
    if (options.asDefault && source !== USER_EDITED) await this.deps.prefs.set(PREF_LYRICS_SOURCE, source);
  }

  /** Back to following the default for this song. */
  async followDefault(): Promise<void> {
    const track = this.state.track;
    if (!track) return;
    this.touched = true;
    this.controller.select(this.defaultSource);
    this.set({ songChoice: undefined });
    await this.deps.repo.setLyricsChoice(trackKeyOf(track), null);
  }

  // ---- the user's own version ---------------------------------------------------------------

  /** The rows the editor starts from: an unsaved draft of this song, else the user's version, else what is showing. */
  editorRows(): EditorLine[] {
    const track = this.state.track;
    if (track && this.draft?.trackKey === trackKeyOf(track)) return this.draft.rows.map((row) => ({ ...row }));
    return editorLines(this.state.snapshot.edited ?? this.state.snapshot.document);
  }
  /** Keeps what has been typed so leaving the editor with Back does not lose it. */
  saveDraft(rows: readonly EditorLine[]): void {
    const track = this.state.track;
    if (track) this.draft = { trackKey: trackKeyOf(track), rows: rows.map((row) => ({ ...row })) };
  }
  discardDraft(): void { this.draft = null; }
  get hasDraft(): boolean { return this.draft !== null && this.state.track !== null && this.draft.trackKey === trackKeyOf(this.state.track); }

  /** Saves the rows as this song's lyrics (UserEdited) and shows them. Throws if nothing is left or the write fails. */
  async saveEdit(rows: readonly EditorLine[]): Promise<void> {
    const track = this.state.track;
    if (!track) return;
    const lrc = lrcFromLines(rows);
    const document = documentFromLrc(lrc);
    if (!document) throw new Error(tr('err.lyrics.empty'));
    const key = trackKeyOf(track);
    await this.deps.repo.saveLyricsEdit(key, lrc);
    await this.deps.repo.setLyricsChoice(key, USER_EDITED);
    this.draft = null;
    this.touched = true;
    this.controller.setEdited(document);
    this.controller.select(USER_EDITED);
    this.set({ songChoice: USER_EDITED });
  }

  async revertEdit(): Promise<void> {
    const track = this.state.track;
    if (!track) return;
    const key = trackKeyOf(track);
    await this.deps.repo.deleteLyricsEdit(key);
    this.draft = null;
    if (this.state.songChoice === USER_EDITED) await this.deps.repo.setLyricsChoice(key, null);
    this.controller.setEdited(null);
    this.set({ songChoice: this.state.songChoice === USER_EDITED ? undefined : this.state.songChoice });
  }

  // ---- translation --------------------------------------------------------------------------

  async setTranslateOptions(options: { source?: string; target?: string; sessionWide?: boolean }): Promise<void> {
    if (options.source !== undefined) await this.deps.prefs.set(PREF_TRANSLATE_SOURCE, options.source);
    if (options.target !== undefined) await this.deps.prefs.set(PREF_TRANSLATE_TARGET, options.target);
    if (options.sessionWide !== undefined) await this.deps.prefs.set(PREF_TRANSLATE_SESSION, options.sessionWide);
    if (options.sessionWide === false) this.cancelTranslation();
    if (options.sessionWide === true && this.state.translation.status === 'idle') void this.translate();
  }

  /** Translates the lyrics now showing. An earlier answer for the same lyrics and languages is reused. */
  async translate(): Promise<void> {
    const { track, snapshot } = this.state;
    const document = snapshot.document;
    const docKey = documentKey(document);
    if (!track || !document || !docKey) return;
    const source = this.translateSource;
    const target = this.target;
    const lines = textLines(document);
    const generation = ++this.translateGeneration;
    this.abort?.abort();
    this.abort = undefined;
    const base = { docKey, source, target };
    const cacheKey = `${translationKey(trackKeyOf(track), source, target)}:${docKey}`;
    this.set({ translation: { ...base, status: 'translating', lines: null } });
    try {
      const cached = await this.deps.repo.getMeta<Array<string | null>>(cacheKey).catch(() => undefined);
      if (generation !== this.translateGeneration) return;
      if (cached && cached.length === lines.length) { this.set({ translation: { ...base, status: 'ready', lines: cached } }); return; }
      const wanted = lines.map((text, index) => ({ text, index })).filter((entry) => entry.text.trim());
      if (wanted.length === 0) { this.set({ translation: { ...base, status: 'ready', lines: lines.map(() => null) } }); return; }
      const controller = new AbortController();
      this.abort = controller;
      const translated = await this.deps.translate(wanted.map((entry) => entry.text), source, target, controller.signal);
      if (generation !== this.translateGeneration) return;
      const shown = dropUnchanged(wanted.map((entry) => entry.text), translated);
      const full: Array<string | null> = lines.map(() => null);
      wanted.forEach((entry, i) => { full[entry.index] = shown[i]; });
      this.set({ translation: { ...base, status: 'ready', lines: full } });
      void this.deps.repo.setMeta(cacheKey, full).catch(() => undefined);
    } catch (error) {
      if (generation !== this.translateGeneration || (error as { name?: string })?.name === 'AbortError') return;
      this.set({ translation: { ...base, status: 'error', lines: null, error: error instanceof Error ? error.message : tr('err.translate.failedShort') } });
    }
  }

  /** Stops a translation that is running (the lines already shown stay). */
  stopTranslation(): void {
    if (this.state.translation.status !== 'translating') return;
    this.cancelTranslation();
    this.set({ translation: idleTranslation(this.translateSource, this.target) });
  }

  /** Back to the original lyrics only; also ends "whole session" so the next song is not translated. */
  async showOriginal(): Promise<void> {
    this.cancelTranslation();
    this.set({ translation: idleTranslation(this.translateSource, this.target) });
    if (this.sessionWide) await this.deps.prefs.set(PREF_TRANSLATE_SESSION, false);
  }

  private cancelTranslation() {
    this.translateGeneration += 1;
    this.abort?.abort();
    this.abort = undefined;
  }
}
