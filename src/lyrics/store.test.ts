import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryDb } from '../library/db';
import { PreferencesStore } from '../library/preferences';
import { LibraryRepository } from '../library/repository';
import type { Track } from '../model';
import { LyricsStore, documentKey } from './store';
import type { RequestLyrics, SourceLyricsDocument } from './types';

const track = (id: string): Track => ({ id, title: `Lagu ${id}`, artist: 'Senja', durationMs: 180_000 });
const synced = (source: string, ...texts: string[]): SourceLyricsDocument => ({ type: 'synced', source, lines: texts.map((text, i) => ({ timeMs: i * 1000, text })) });
const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); };

let repo: LibraryRepository;
let prefs: PreferencesStore;
let answers: Record<string, SourceLyricsDocument>;
let request: ReturnType<typeof vi.fn>;
let translate: ReturnType<typeof vi.fn>;
let store: LyricsStore;

const make = () => new LyricsStore({ repo, prefs, request: request as unknown as RequestLyrics, translate: translate as never, language: () => 'id' });

beforeEach(async () => {
  repo = new LibraryRepository(createMemoryDb());
  prefs = new PreferencesStore(repo);
  await prefs.hydrate();
  answers = { LrcLib: synced('LrcLib', 'halo', '', 'dunia'), Deezer: synced('Deezer', 'beda satu', 'beda dua', 'beda tiga') };
  request = vi.fn(async (id: string) => answers[id] ?? { type: 'missing', source: id });
  translate = vi.fn(async (lines: string[], _source: string, target: string) => lines.map((line) => `${target}:${line}`));
  store = make();
});

describe('provider choice', () => {
  it('follows the default until a song gets its own choice, and the choice is saved for that song only', async () => {
    await prefs.set('lyrics.source', 'Deezer');
    store.load(track('a'));
    await flush();
    expect(store.getSnapshot().snapshot.source).toBe('Deezer');
    await store.selectSource('LrcLib');
    expect(store.getSnapshot().snapshot.document?.source).toBe('LrcLib');
    expect(await repo.getLyricsChoice('youtube:track:a')).toBe('LrcLib');
    store.load(track('b'));
    await flush();
    expect(store.getSnapshot().snapshot.source).toBe('Deezer');       // another song: the default again
    expect(prefs.get('lyrics.source', 'auto')).toBe('Deezer');         // choosing for one song did not move the default
    store.load(track('a'));
    await flush();
    expect(store.getSnapshot().snapshot.source).toBe('LrcLib');       // coming back restores the song's own choice
    expect(store.getSnapshot().songChoice).toBe('LrcLib');
  });

  it('"use for all songs" changes the default; following the default drops the song\'s choice', async () => {
    store.load(track('a'));
    await flush();
    await store.selectSource('Deezer', { asDefault: true });
    expect(prefs.get('lyrics.source', 'auto')).toBe('Deezer');
    await store.followDefault();
    expect(await repo.getLyricsChoice('youtube:track:a')).toBeUndefined();
    expect(store.getSnapshot().songChoice).toBeUndefined();
  });

  it('a saved choice does not override one the user made while it was loading, and unknown ids are ignored', async () => {
    await repo.setLyricsChoice('youtube:track:a', 'Deezer');
    store.load(track('a'));
    await store.selectSource('LrcLib');                                // before the saved choice arrives
    await flush();
    expect(store.getSnapshot().snapshot.source).toBe('LrcLib');
    await store.selectSource('Nonsense');
    expect(store.getSnapshot().snapshot.source).toBe('LrcLib');
  });

  it('a slow answer never replaces the provider picked by hand', async () => {
    let release: (doc: SourceLyricsDocument) => void = () => undefined;
    request.mockImplementation((id: string) => id === 'LrcLib' ? new Promise((resolve) => { release = resolve; }) : Promise.resolve(answers[id] ?? { type: 'missing', source: id }));
    store.load(track('a'));
    await flush();
    await store.selectSource('Deezer');
    release(answers.LrcLib);
    await flush();
    expect(store.getSnapshot().snapshot.document?.source).toBe('Deezer');
  });
});

describe('own edit', () => {
  it('saves, shows at once, is chosen for the song, and survives loading the song again', async () => {
    store.load(track('a'));
    await flush();
    expect(store.editorRows().map((row) => row.text)).toEqual(['halo', '', 'dunia']);   // starts from what is showing
    await store.saveEdit([{ timeMs: 0, text: 'halo!' }, { timeMs: 2000, text: 'dunia!' }]);
    expect(store.getSnapshot().snapshot.document).toMatchObject({ source: 'UserEdited', lines: [{ timeMs: 0, text: 'halo!' }, { timeMs: 2000, text: 'dunia!' }] });
    expect((await repo.getLyricsEdit('youtube:track:a'))?.lrc).toBe('[00:00.00]halo!\n[00:02.00]dunia!');
    store.load(track('a'));
    await flush();
    expect(store.getSnapshot().snapshot.document?.source).toBe('UserEdited');
    expect(store.editorRows().map((row) => row.text)).toEqual(['halo!', 'dunia!']);       // the editor reopens on the user's version
  });

  it('an automatic pick never replaces it, even when providers answer later', async () => {
    await repo.saveLyricsEdit('youtube:track:a', '[00:00.00]milikku');
    store.load(track('a'));
    await flush();
    expect(store.getSnapshot().snapshot.document?.source).toBe('UserEdited');
    await store.selectSource('auto');
    expect(store.getSnapshot().snapshot.document?.source).toBe('UserEdited');
  });

  it('refuses to save nothing, and reverting goes back to the providers', async () => {
    store.load(track('a'));
    await flush();
    await expect(store.saveEdit([{ timeMs: 0, text: '   ' }])).rejects.toThrow(/kosong/);
    expect(await repo.getLyricsEdit('youtube:track:a')).toBeUndefined();
    await store.saveEdit([{ timeMs: 0, text: 'x' }]);
    await store.revertEdit();
    expect(await repo.getLyricsEdit('youtube:track:a')).toBeUndefined();
    expect(await repo.getLyricsChoice('youtube:track:a')).toBeUndefined();
    expect(store.getSnapshot().snapshot.document?.source).not.toBe('UserEdited');
  });

  it('does not save when the storage write fails', async () => {
    store.load(track('a'));
    await flush();
    vi.spyOn(repo, 'saveLyricsEdit').mockRejectedValueOnce(new Error('penuh'));
    await expect(store.saveEdit([{ timeMs: 0, text: 'x' }])).rejects.toThrow('penuh');
    expect(store.getSnapshot().snapshot.document?.source).not.toBe('UserEdited');
  });
});

describe('translation', () => {
  it('translates the lines that have text, keeps blank lines blank, and leaves the original untouched', async () => {
    store.load(track('a'));
    await flush();
    await store.setTranslateOptions({ target: 'en' });
    await store.translate();
    expect(translate).toHaveBeenCalledWith(['halo', 'dunia'], 'auto', 'en', expect.anything());
    const { translation } = store.getSnapshot();
    expect(translation).toMatchObject({ status: 'ready', target: 'en', lines: ['en:halo', null, 'en:dunia'] });
    expect(store.getSnapshot().snapshot.document).toMatchObject({ lines: [{ text: 'halo' }, { text: '' }, { text: 'dunia' }] });
  });

  it('a line that comes back unchanged is not shown twice', async () => {
    translate.mockImplementation(async (lines: string[]) => lines.map((line) => (line === 'halo' ? 'HALO' : 'dunia lain')));
    store.load(track('a'));
    await flush();
    await store.translate();
    expect(store.getSnapshot().translation.lines).toEqual([null, null, 'dunia lain']);
  });

  it('reuses a saved translation instead of asking again, per target language', async () => {
    store.load(track('a'));
    await flush();
    await store.setTranslateOptions({ target: 'en' });
    await store.translate();
    await flush();
    await store.showOriginal();
    expect(store.getSnapshot().translation.status).toBe('idle');
    await store.translate();
    expect(translate).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().translation.lines).toEqual(['en:halo', null, 'en:dunia']);
    await store.setTranslateOptions({ target: 'es' });
    await store.translate();
    expect(translate).toHaveBeenCalledTimes(2);
  });

  it('reports a failure and can be tried again', async () => {
    translate.mockRejectedValueOnce(new Error('Terjemahan gagal. Coba lagi.'));
    store.load(track('a'));
    await flush();
    await store.translate();
    expect(store.getSnapshot().translation).toMatchObject({ status: 'error', error: 'Terjemahan gagal. Coba lagi.', lines: null });
    await store.translate();
    expect(store.getSnapshot().translation.status).toBe('ready');
  });

  it('stop cancels a running translation and a late answer is dropped', async () => {
    let release: (lines: string[]) => void = () => undefined;
    translate.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    store.load(track('a'));
    await flush();
    const running = store.translate();
    await flush();
    expect(store.getSnapshot().translation.status).toBe('translating');
    store.stopTranslation();
    expect(store.getSnapshot().translation.status).toBe('idle');
    release(['x', 'y']);
    await running;
    expect(store.getSnapshot().translation.status).toBe('idle');
  });

  it('a translation never sits over lyrics it was not made from (provider switch, new song)', async () => {
    store.load(track('a'));
    await flush();
    await store.translate();
    expect(store.getSnapshot().translation.status).toBe('ready');
    await store.selectSource('Deezer');
    expect(store.getSnapshot().translation.status).toBe('idle');
    await store.translate();
    store.load(track('b'));
    expect(store.getSnapshot().translation).toMatchObject({ status: 'idle', lines: null });
  });

  it('"whole session" translates each song as its lyrics arrive; Show original ends it', async () => {
    store.load(track('a'));
    await flush();
    await store.setTranslateOptions({ target: 'en', sessionWide: true });
    await flush();
    expect(store.getSnapshot().translation.status).toBe('ready');
    store.load(track('b'));
    await flush();
    await flush();
    expect(store.getSnapshot().translation.status).toBe('ready');
    expect(translate).toHaveBeenCalledTimes(2);
    await store.showOriginal();
    expect(store.sessionWide).toBe(false);
    store.load(track('c'));
    await flush();
    expect(store.getSnapshot().translation.status).toBe('idle');
  });

  it('does nothing when there are no lyrics', async () => {
    answers = {};
    store.load(track('a'));
    await flush();
    await store.translate();
    expect(translate).not.toHaveBeenCalled();
    expect(store.getSnapshot().translation.status).toBe('idle');
  });
});

describe('document key', () => {
  it('changes with the text and the source, not with timing', () => {
    expect(documentKey(synced('A', 'x'))).toBe(documentKey(synced('A', 'x')));
    expect(documentKey(synced('A', 'x'))).not.toBe(documentKey(synced('B', 'x')));
    expect(documentKey(synced('A', 'x'))).not.toBe(documentKey(synced('A', 'y')));
    expect(documentKey(null)).toBeNull();
    expect(documentKey({ type: 'missing', source: 'A' })).toBeNull();
  });
});
