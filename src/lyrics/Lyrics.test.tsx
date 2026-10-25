// @vitest-environment jsdom
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContextValue } from '../app/AppContext';
import type { PlayerPort } from '../app/engine';
import { openServices, type Services } from '../app/services';
import App from '../app/Shell';
import { fakeGateway } from '../features/home/testkit';
import { createMemoryDb } from '../library/db';
import type { PlaybackSnapshot, Track } from '../model';
import type { RequestLyrics, SourceLyricsDocument } from './types';

class FakePlayer implements PlayerPort {
  listener: (snapshot: PlaybackSnapshot) => void = () => undefined;
  sequence = 0;
  subscribe(listener: (snapshot: PlaybackSnapshot) => void) { this.listener = listener; return () => undefined; }
  async load(track: Track) { this.sequence += 1; this.emit({ status: 'loading', positionMs: 0, durationMs: track.durationMs }); return this.sequence; }
  async play() { this.emit({ status: 'paused', positionMs: 0, durationMs: 200_000 }); }
  pause() { /* nothing */ }
  seekTo(positionMs: number) { const audio = document.querySelector('audio'); if (audio) audio.currentTime = positionMs / 1000; this.emit({ status: 'paused', positionMs, durationMs: 200_000 }); }
  dispose() { /* nothing */ }
  emit(snapshot: Omit<PlaybackSnapshot, 'loadId'>) { this.listener({ ...snapshot, loadId: this.sequence }); }
}

const song = (id: string): Track => ({ id, title: `Lagu ${id}`, artist: 'Senja', durationMs: 200_000 });
const synced = (source: string, texts: string[], extra: Partial<SourceLyricsDocument> = {}): SourceLyricsDocument => ({ type: 'synced', source, lines: texts.map((text, i) => ({ timeMs: i * 2000, text })), ...extra } as SourceLyricsDocument);
let host: HTMLElement;
let services: Services;
let api: () => AppContextValue;
let answers: Record<string, SourceLyricsDocument>;
let translate: ReturnType<typeof vi.fn>;

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 8)); });
const byFocus = (id: string) => document.querySelector<HTMLElement>(`[data-focus-id="${id}"]`);
const top = () => document.querySelector('.overlay-layer.is-top');
const overlayItem = (suffix: string) => top()?.querySelector<HTMLElement>(`[data-focus-id$="-${suffix}"]`) ?? null;
const clickOverlay = async (suffix: string) => { const el = overlayItem(suffix); if (!el) throw new Error(`no ${suffix}`); await act(() => { el.click(); }); await flush(); };
const lineTexts = () => Array.from(document.querySelectorAll('.lyrics-line')).map((el) => el.firstChild?.textContent ?? '');
const subs = (cls: string) => Array.from(document.querySelectorAll(`.${cls}`)).map((el) => el.textContent);

async function mount(tracks = [song('a')]) {
  host = document.createElement('div');
  document.body.appendChild(host);
  const player = new FakePlayer();
  const lyricsRequest: RequestLyrics = async (id) => answers[id] ?? { type: 'missing', source: id };
  await act(() => { render(h(App, { services, catalog: fakeGateway(), lyricsRequest, translate: translate as never, playerFactory: () => player, onReady: (getter) => { api = getter; } }), host); });
  await flush();
  await act(() => { api().playTracks(tracks, 0, 'manual'); });
  await flush();
  await act(() => { api().goTab('player'); });
  await flush();
}
const unmount = () => { render(null, host); host.remove(); };
const openOther = async () => {
  await act(() => { document.querySelector<HTMLDetailsElement>('details.player-menu')!.open = true; });
  await act(() => { byFocus('player-menu-OTHER_MENU')!.click(); });
  await flush();
};

beforeEach(async () => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) { return (this.closest('[hidden]') ? [] : [{}]) as unknown as DOMRectList; });
  const opened = await openServices({ db: createMemoryDb(), storage: { getItem: () => null } });
  if (!opened.ok) throw opened.error;
  services = opened.services;
  await services.prefs.set('ui.language', 'id');
  await services.prefs.set('onboarding.done', true);
  answers = { LrcLib: synced('LrcLib', ['halo dunia', 'selamat malam']), Deezer: synced('Deezer', ['beda satu', 'beda dua']) };
  translate = vi.fn(async (lines: string[], _s: string, target: string) => lines.map((line) => `${target.toUpperCase()}: ${line}`));
});
afterEach(() => { unmount(); vi.restoreAllMocks(); });

describe('lyrics on the player', () => {
  it('shows lyrics without source credits and opens the provider sheet from Other menu', async () => {
    await mount();
    expect(lineTexts()).toEqual(['halo dunia', 'selamat malam']);
    expect(document.querySelector('.lyrics-source-credit')).toBeNull();
    await openOther(); await clickOverlay('lyprovider');
    expect(top()?.querySelector('h2')?.textContent).toBe('Sumber lirik');
  });

  it('choosing a provider changes the lyrics for this song, is remembered, and does not change the default', async () => {
    await mount();
    await openOther(); await clickOverlay('lyprovider');
    await flush();
    const rows = Array.from(top()!.querySelectorAll('.overlay-item')).map((el) => el.textContent ?? '');
    expect(rows.find((text) => text.startsWith('Deezer'))).toContain('Per baris');
    expect(rows.find((text) => text.startsWith('LrcLib'))).toContain('Dipakai');
    await clickOverlay('p-Deezer');
    expect(lineTexts()).toEqual(['beda satu', 'beda dua']);
    expect(await services.repo.getLyricsChoice('youtube:track:a')).toBe('Deezer');
    expect(services.prefs.get('lyrics.source', 'auto')).toBe('auto');
    unmount();
    await mount();
    expect(lineTexts()).toEqual(['beda satu', 'beda dua']);
  });

  it('a provider with nothing cannot be picked, and the sheet says why', async () => {
    await mount();
    await openOther(); await clickOverlay('lyprovider');
    await flush();
    const kugou = overlayItem('p-Kugou')!;
    expect(kugou.textContent).toContain('Tidak ditemukan');
    await act(() => { kugou.click(); });
    expect(await services.repo.getLyricsChoice('youtube:track:a')).toBeUndefined();
    expect(lineTexts()).toEqual(['halo dunia', 'selamat malam']);
  });

  it('"use for all songs" moves the default', async () => {
    await mount();
    await openOther(); await clickOverlay('lyprovider');
    await flush();
    await clickOverlay('p-Deezer');
    await openOther(); await clickOverlay('lyprovider');
    await flush();
    await clickOverlay('default');
    await vi.waitFor(() => expect(services.prefs.get('lyrics.source', 'auto')).toBe('Deezer'));
  });
});

describe('editing lyrics', () => {
  const openEditor = async () => { await openOther(); await clickOverlay('lyedit'); };

  it('edits the text of a line, keeps its time, saves, and the new text shows at once and after a relaunch', async () => {
    await mount();
    await openEditor();
    const inputs = () => Array.from(top()!.querySelectorAll<HTMLInputElement>('.editor-row input'));
    expect(inputs().map((input) => input.value)).toEqual(['halo dunia', 'selamat malam']);
    expect(Array.from(top()!.querySelectorAll('.editor-time')).map((el) => el.textContent)).toEqual(['00:00.00', '00:02.00']);
    await act(() => { inputs()[1].value = 'selamat tidur'; inputs()[1].dispatchEvent(new Event('input', { bubbles: true })); });
    await clickOverlay('save');
    expect(top()).toBeNull();
    expect(lineTexts()).toEqual(['halo dunia', 'selamat tidur']);
    expect(api().lyrics.getSnapshot().snapshot.document?.source).toBe('UserEdited');
    expect((await services.repo.getLyricsEdit('youtube:track:a'))?.lrc).toBe('[00:00.00]halo dunia\n[00:02.00]selamat tidur');
    unmount();
    await mount();
    expect(lineTexts()).toEqual(['halo dunia', 'selamat tidur']);
  });

  it('keeps an unsaved draft when the editor is left with Back, and Remove my edit clears everything', async () => {
    await mount();
    await openEditor();
    const input = top()!.querySelector<HTMLInputElement>('.editor-row input')!;
    await act(() => { input.value = 'draf saya'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(() => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(top()).toBeNull();
    expect(lineTexts()[0]).toBe('halo dunia');
    await openOther();
    await clickOverlay('lyedit');
    expect(top()!.querySelector<HTMLInputElement>('.editor-row input')!.value).toBe('draf saya');
    await clickOverlay('revert');
    expect(api().lyrics.hasDraft).toBe(false);
    expect(await services.repo.getLyricsEdit('youtube:track:a')).toBeUndefined();
  });

  it('warns that word timing is lost, only when the lyrics have it', async () => {
    answers.LrcLib = { type: 'synced', source: 'LrcLib', lines: [{ timeMs: 0, text: 'halo', words: [{ text: 'halo', startMs: 0, endMs: 500 }] }] };
    await mount();
    await openEditor();
    expect(top()!.textContent).toContain('waktu per kata');
    await clickOverlay('cancel');
    answers.LrcLib = synced('LrcLib', ['halo']);
    unmount();
    await mount();
    await openEditor();
    expect(top()!.textContent).not.toContain('waktu per kata');
  });

  it('a saved edit is not replaced by a provider that answers later', async () => {
    await services.repo.saveLyricsEdit('youtube:track:a', '[00:00.00]punyaku');
    await mount();
    expect(lineTexts()).toEqual(['punyaku']);
  });
});

describe('translation', () => {
  const openTranslate = async () => { await openOther(); await clickOverlay('lytranslate'); };

  it('shows the translation under each line and the original stays', async () => {
    await mount();
    await openTranslate();
    await clickOverlay('to');
    const english = Array.from(top()!.querySelectorAll<HTMLElement>('.overlay-item')).find((el) => el.textContent?.startsWith('English'))!;
    await act(() => { english.click(); });
    await flush();
    await clickOverlay('go');
    expect(translate).toHaveBeenCalledWith(['halo dunia', 'selamat malam'], 'auto', 'en', expect.anything());
    expect(subs('lyric-translation')).toEqual(['EN: halo dunia', 'EN: selamat malam']);
    expect(lineTexts()).toEqual(['halo dunia', 'selamat malam']);
    expect(top()!.textContent).toContain('Terjemahan tampil');
  });

  it('the quick action translates with the saved languages and a second press shows the original', async () => {
    await services.prefs.set('player.menuSlots', 'TRANSLATE_LYRICS,SHUFFLE,QUEUE,SPEED');
    await services.prefs.set('lyrics.translate.target', 'es');
    await mount();
    await act(() => { document.querySelector<HTMLDetailsElement>('details.player-menu')!.open = true; });
    await act(() => { byFocus('player-menu-TRANSLATE_LYRICS')!.click(); });
    await flush();
    expect(subs('lyric-translation')[0]).toBe('ES: halo dunia');
    await act(() => { document.querySelector<HTMLDetailsElement>('details.player-menu')!.open = true; });
    await act(() => { byFocus('player-menu-TRANSLATE_LYRICS')!.click(); });
    await flush();
    expect(subs('lyric-translation')).toEqual([]);
  });

  it('shows the failure and lets the user try again', async () => {
    translate.mockRejectedValueOnce(new Error('Terjemahan gagal. Coba lagi.'));
    await mount();
    await openTranslate();
    await clickOverlay('go');
    expect(top()!.textContent).toContain('Terjemahan gagal');
    expect(subs('lyric-translation')).toEqual([]);
    await clickOverlay('go');
    expect(subs('lyric-translation')).toHaveLength(2);
  });

  it('the translation disappears when another provider is chosen, because it no longer matches', async () => {
    await mount();
    await openTranslate();
    await clickOverlay('go');
    expect(subs('lyric-translation')).toHaveLength(2);
    await act(() => { api().lyrics.selectSource('Deezer'); });
    await flush();
    expect(subs('lyric-translation')).toEqual([]);
    expect(lineTexts()).toEqual(['beda satu', 'beda dua']);
  });
});

describe('readings', () => {
  it('shows a reading under kana lyrics, can be switched off, and skips lines it cannot read', async () => {
    answers.LrcLib = synced('LrcLib', ['さくら', '君の声']);
    await mount();
    expect(subs('lyric-reading')).toEqual(['sakura']);
    await openOther();
    await clickOverlay('lyreadings');
    expect(services.prefs.get('lyrics.readings', true)).toBe(false);
    await flush();
    expect(subs('lyric-reading')).toEqual([]);
  });
});

describe('frame work', () => {
  it('only the line being sung changes class as time moves; the others keep their elements', async () => {
    answers.LrcLib = { type: 'synced', source: 'LrcLib', lines: Array.from({ length: 40 }, (_, i) => ({ timeMs: i * 1000, text: `baris ${i}`, words: [{ text: `baris ${i}`, startMs: i * 1000, endMs: i * 1000 + 800 }] })) };
    await mount();
    const before = Array.from(document.querySelectorAll('.lyrics-line'));
    expect(before).toHaveLength(40);
    await act(() => { api().controls.seekTo(5500); });
    await flush();
    const after = Array.from(document.querySelectorAll('.lyrics-line'));
    expect(after.every((el, i) => el === before[i])).toBe(true);          // no line was re-created
  });

  it('stops asking for frames when paused, runs them while playing, and follows a seek made while paused', async () => {
    answers.LrcLib = { type: 'synced', source: 'LrcLib', lines: Array.from({ length: 6 }, (_, i) => ({ timeMs: i * 1000, text: `baris ${i}` })) };
    const frames = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    await mount();
    await flush();
    const whilePaused = frames.mock.calls.length;
    await flush();
    expect(frames.mock.calls.length).toBe(whilePaused);                     // nothing is scheduled while paused
    await act(() => { api().controls.seekTo(3500); });
    await flush();
    expect(document.querySelector('.lyric-group.is-active')?.textContent).toBe('baris 3');
    frames.mockRestore();
  });

  it('a line that has been sung stops being active in the pause before the next one, and the next one takes over when it starts', async () => {
    const piece = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs });
    answers.LrcLib = { type: 'synced', source: 'LrcLib', lines: [
      { timeMs: 0, text: 'baris 0', words: [piece('baris', 0, 800), piece('0', 800, 1500)] },
      { timeMs: 6000, text: 'baris 1', words: [piece('baris', 6000, 6800), piece('1', 6800, 7500)] },
    ] };
    const frames = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    await mount();
    await flush();
    await act(() => { api().controls.seekTo(1000); });
    await flush();
    expect(document.querySelector('.lyric-group.is-active')?.textContent).toBe('baris 0');
    await act(() => { api().controls.seekTo(4000); });                      // past its last word, before the next line
    await flush();
    expect(document.querySelector('.lyric-group.is-active')).toBeNull();
    expect(document.querySelectorAll('.lyric-group.is-past')).toHaveLength(1);
    await act(() => { api().controls.seekTo(6200); });
    await flush();
    expect(document.querySelector('.lyric-group.is-active')?.textContent).toBe('baris 1');
    await act(() => { api().controls.seekTo(500); });                       // seeking back lights the first again, and the second is upcoming
    await flush();
    expect(document.querySelector('.lyric-group.is-active')?.textContent).toBe('baris 0');
    expect(document.querySelectorAll('.lyric-group.is-upcoming')).toHaveLength(1);
    frames.mockRestore();
  });

  it('blurs the lines around the one being sung, more the further away they are, and leaves the sung line sharp', async () => {
    answers.LrcLib = { type: 'synced', source: 'LrcLib', lines: Array.from({ length: 8 }, (_, i) => ({ timeMs: i * 1000, text: `baris ${i}` })) };
    const frames = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    await mount();
    await flush();
    await act(() => { api().controls.seekTo(3500); });
    await flush();
    const lines = Array.from(document.querySelectorAll<HTMLElement>('.lyric-group'));
    const blur = (line: HTMLElement) => Number(/blur\(([\d.]+)px\)/.exec(line.getAttribute('style') ?? '')?.[1] ?? 0);
    expect(lines[3].classList.contains('is-active')).toBe(true);
    expect(blur(lines[3])).toBe(0);                                          // the line being sung is sharp
    const before = lines.slice(0, 3).map(blur);                                // sung lines are blurred too, more the older they are
    expect(before.every((value) => value > 0)).toBe(true);
    expect(before[0]).toBeGreaterThanOrEqual(before[1]);
    expect(before[1]).toBeGreaterThanOrEqual(before[2]);
    const ahead = lines.slice(4).map(blur);
    expect(ahead[0]).toBeGreaterThan(0);
    for (let i = 1; i < ahead.length; i += 1) expect(ahead[i]).toBeGreaterThanOrEqual(ahead[i - 1]);
    expect(Math.max(...ahead, ...before)).toBeLessThanOrEqual(5);
    expect(lines.slice(4).every((line) => line.classList.contains('is-upcoming'))).toBe(true);
    frames.mockRestore();
  });

  it('the card at the bottom edge offers the page that is not showing: the line being sung under the queue, the next song under the lyrics', async () => {
    answers.LrcLib = { type: 'synced', source: 'LrcLib', lines: Array.from({ length: 6 }, (_, i) => ({ timeMs: i * 1000, text: `baris ${i}` })) };
    const frames = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    await mount();
    await flush();
    const deck = () => document.querySelector<HTMLElement>('.player-deck')!;
    expect(deck().dataset.front).toBe('next');                                         // lyrics are showing → the next song waits at the bottom
    expect(deck().querySelector('.deck-next-label')!.textContent).toBe('Lagu berikutnya');
    await act(() => { api().playerPanel.set('queue'); });
    await flush();
    expect(document.querySelector('.queue-panel')).not.toBeNull();
    expect(deck().dataset.front).toBe('lyric');
    await act(() => { api().controls.seekTo(2500); });
    await flush();
    expect(deck().querySelector('.deck-lyric-line')?.textContent).toBe('baris 2');
    await act(() => { api().controls.seekTo(4200); });
    await flush();
    expect(deck().querySelector('.deck-lyric-line')?.textContent).toBe('baris 4');
    await act(() => { deck().querySelector<HTMLElement>('.deck-preview')!.click(); });  // select the card: that page opens
    expect(api().playerPanel.getSnapshot()).toBe('lyrics');
    expect(deck().dataset.front).toBe('next');
    frames.mockRestore();
  });

  it('the deck paints the line the way the chosen source times it: words fill as they are sung, a plain line does not', async () => {
    answers.LrcLib = { type: 'synced', source: 'LrcLib', lines: [
      { timeMs: 0, text: 'satu dua tiga', words: [{ text: 'satu', startMs: 0, endMs: 1000 }, { text: 'dua', startMs: 1000, endMs: 2000 }, { text: 'tiga', startMs: 2000, endMs: 3000 }] },
      { timeMs: 4000, text: 'baris biasa' },
    ] };
    const frames = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    await mount();
    await flush();
    await act(() => { api().playerPanel.set('queue'); });
    await act(() => { api().controls.seekTo(1500); });
    await flush();
    const pieces = [...document.querySelectorAll<HTMLElement>('.deck-lyric .lyric-piece')];
    expect(pieces.map((el) => el.textContent)).toEqual(['satu', 'dua', 'tiga']);
    expect(pieces.map((el) => el.style.getPropertyValue('--sung'))).toEqual(['100%', '50%', '0%']);   // sung, being sung, still to come
    expect(document.querySelector('.deck-lyric')!.classList.contains('lyrics-motion-motion')).toBe(true);
    await act(() => { api().controls.seekTo(4500); });
    await flush();
    expect(document.querySelectorAll('.deck-lyric .lyric-piece')).toHaveLength(0);
    expect(document.querySelector('.deck-lyric-line')!.textContent).toBe('baris biasa');
    expect(document.querySelectorAll('.deck-back')).toHaveLength(0);                                 // one card only
    frames.mockRestore();
  });
});


describe('lyrics intro and live settings', () => {
  it('shows the same three-dot intro before the first timed line in the lyrics and deck, including after seeking back', async () => {
    answers.LrcLib = { type: 'synced', source: 'LrcLib', lines: [{ timeMs: 5000, text: 'bait pertama' }, { timeMs: 9000, text: 'bait kedua' }] };
    await mount();
    expect(document.querySelector('.lyrics-intro-line.is-active .lyrics-intro')).not.toBeNull();
    const dots = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(`${selector} .lyrics-intro > span`)).map((dot) => dot.style.getPropertyValue('--sung'));
    expect(dots('.lyrics-rail')).toEqual(['0%', '0%', '0%']);
    await act(() => { api().controls.seekTo(2500); });
    await flush();
    expect(dots('.lyrics-rail')).toEqual(['100%', '50%', '0%']);
    expect(document.querySelector('#lyrics-retry')).toBeNull();
    await act(() => { api().playerPanel.set('queue'); });
    expect(document.querySelector('.deck-lyric .lyrics-intro')).not.toBeNull();
    expect(dots('.deck-lyric')).toEqual(['100%', '50%', '0%']);
    await act(() => { api().controls.seekTo(6000); });
    await flush();
    expect(document.querySelector('.deck-lyric-line')?.textContent).toBe('bait pertama');
    expect(document.querySelector('.deck-lyric .lyrics-intro')).toBeNull();
    await act(() => { api().controls.seekTo(0); });
    await flush();
    expect(document.querySelector('.deck-lyric .lyrics-intro')).not.toBeNull();
    expect(dots('.deck-lyric')).toEqual(['0%', '0%', '0%']);
    await act(() => { api().playerPanel.set('lyrics'); });
    expect(document.querySelector('.lyrics-intro-line.is-active')).not.toBeNull();
  });

  it('applies detail and animation preferences to the paused deck immediately without reloading lyrics', async () => {
    answers.LrcLib = { type: 'synced', source: 'LrcLib', lines: [{ timeMs: 0, text: 'satu dua', words: [{ text: 'satu', startMs: 0, endMs: 1000 }, { text: 'dua', startMs: 1000, endMs: 2000 }] }] };
    await mount();
    await act(() => { api().playerPanel.set('queue'); });
    expect(document.querySelectorAll('.deck-lyric .lyric-piece').length).toBe(2);
    await act(async () => { await services.prefs.set('lyrics.detail', 'line'); await services.prefs.set('lyrics.motion', 'LEGACY'); });
    expect(document.querySelectorAll('.deck-lyric .lyric-piece').length).toBe(0);
    expect(document.querySelector('.deck-lyric')?.classList.contains('lyrics-motion-legacy')).toBe(true);
  });
});
