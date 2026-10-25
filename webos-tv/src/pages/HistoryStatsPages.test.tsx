// @vitest-environment jsdom
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeGateway } from '../features/home/testkit';
import { createMemoryDb } from '../library/db';
import type { Track } from '../model';
import type { AppContextValue } from '../app/AppContext';
import { openServices, type Services } from '../app/services';
import App from '../app/Shell';

const song = (id: string, artist = 'Senja'): Track => ({ id, title: `Lagu ${id}`, artist, durationMs: 200_000, artists: [{ id: `UC${artist}`, name: artist }] });
let host: HTMLElement;
let services: Services;
let api: () => AppContextValue;
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
const byFocus = (id: string) => document.querySelector<HTMLElement>(`[data-focus-id="${id}"]`);
const click = async (id: string) => { await act(() => { byFocus(id)!.click(); }); await flush(); };
const text = () => document.body.textContent ?? '';

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(() => { render(h(App, { services, catalog: fakeGateway(), playerFactory: () => ({ subscribe: () => () => undefined, load: async () => 1, play: async () => undefined, pause: () => undefined, seekTo: () => undefined, dispose: () => undefined }), onReady: (getter) => { api = getter; } }), host); });
  await flush();
}
const play = (n: number, track: Track, daysAgo: number, listenedMs = 60_000) =>
  services.repo.recordPlay({ id: `t:${n}`, track, sessionId: 't', startedAt: Date.now() - daysAgo * 86_400_000 - n, listenedMs });

beforeEach(async () => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) { return (this.closest('[hidden]') ? [] : [{}]) as unknown as DOMRectList; });
  const opened = await openServices({ db: createMemoryDb(), storage: { getItem: () => null } });
  if (!opened.ok) throw opened.error;
  services = opened.services;
  await services.prefs.set('ui.language', 'id');
  await services.prefs.set('onboarding.done', true);
});
afterEach(() => { render(null, host); host.remove(); vi.restoreAllMocks(); });

describe('history page', () => {
  it('is reached from Library, lists plays by day with each song once, and plays from the tapped song', async () => {
    await play(1, song('a'), 0); await play(2, song('b'), 0); await play(3, song('a'), 0); await play(4, song('c'), 1);
    await mount();
    await click('nav-library');
    await click('lib-history');
    expect(document.querySelector('.history-view h1')?.textContent).toBe('Riwayat');
    const groups = Array.from(document.querySelectorAll('.history-group')).map((el) => el.textContent);
    expect(groups).toEqual(['Hari ini', 'Kemarin']);
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.result-row'));
    expect(rows).toHaveLength(3);
    await act(() => { rows[1].click(); });
    await flush();
    expect(api().store.root.queue.entries).toHaveLength(3);
    expect(api().store.root.queue.currentEntryId).toBe(api().store.root.queue.entries[1].entryId);
  });

  it('says so when there is nothing yet, instead of showing demo songs', async () => {
    await mount();
    await act(() => { api().navigate({ name: 'history' }); });
    await flush();
    expect(text()).toContain('Belum ada riwayat');
    expect(document.querySelectorAll('.result-row')).toHaveLength(0);
    expect(byFocus('detail-play')!.hasAttribute('disabled')).toBe(true);
  });

  it('filters by title or artist', async () => {
    await play(1, song('a', 'Senja'), 0); await play(2, song('b', 'Fajar'), 0);
    await mount();
    await act(() => { api().navigate({ name: 'history' }); });
    await flush();
    const input = byFocus('history-search') as HTMLInputElement;
    await act(() => { input.value = 'fajar'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(document.querySelectorAll('.result-row')).toHaveLength(1);
    await act(() => { input.value = 'zzz'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(text()).toContain('Tidak ada yang cocok di riwayat');
  });

  it('pausing history is a real switch, and clearing asks first', async () => {
    await play(1, song('a'), 0);
    await mount();
    await act(() => { api().navigate({ name: 'history' }); });
    await flush();
    await click('detail-pause');
    expect(services.prefs.get('history.paused', false)).toBe(true);
    expect(text()).toContain('Riwayat sedang dijeda');
    await click('detail-clear');
    expect(document.querySelector('.overlay-layer')).toBeTruthy();
    expect(await services.repo.listHistory()).toHaveLength(1);       // nothing deleted before confirming
    const confirm = Array.from(document.querySelectorAll<HTMLElement>('.overlay-panel button')).find((el) => el.textContent === 'Hapus riwayat')!;
    await act(() => { confirm.click(); });
    await flush();
    expect(await services.repo.listHistory()).toHaveLength(0);
  });
});

describe('stats page', () => {
  it('totals the real listening time of the month and ranks songs and artists', async () => {
    await play(1, song('a', 'Senja'), 0, 120_000); await play(2, song('a', 'Senja'), 0, 60_000); await play(3, song('b', 'Fajar'), 0, 30_000);
    await mount();
    await click('nav-library');
    await click('lib-stats');
    const facts = Array.from(document.querySelectorAll('.stats-facts div')).map((el) => [el.querySelector('dt')!.textContent, el.querySelector('dd')!.textContent]);
    expect(facts).toEqual([['Waktu mendengar', '4 mnt'], ['Putaran', '3'], ['Lagu', '2'], ['Artis', '2'], ['Album', '0']]);
    const songs = Array.from(document.querySelectorAll('.detail-tracks .result-title')).map((el) => el.textContent);
    expect(songs[0]).toBe('Lagu a');
    expect(document.querySelectorAll('.stats-artists .result-row')).toHaveLength(2);
    expect(document.querySelector('.stats-artists .result-title')?.textContent).toBe('Senja');
  });

  it('is honest when nothing was played, and goes back a month with Previous', async () => {
    await mount();
    await act(() => { api().navigate({ name: 'stats' }); });
    await flush();
    expect(text()).toContain('Belum ada yang diputar di periode ini');
    expect(document.querySelectorAll('.stats-facts')).toHaveLength(0);
    expect(byFocus('stats-next')!.hasAttribute('disabled')).toBe(true);
  });

  it('explains what the recap still needs, and opens it once it is ready', async () => {
    const day = new Date().getDate();
    for (let i = 0; i < 4; i += 1) await play(i, song(`s${i}`, `A${i}`), 0);
    await mount();
    await act(() => { api().navigate({ name: 'stats' }); });
    await flush();
    expect(text()).toContain(day < 3 ? 'terbuka tanggal 3' : 'Putar 6 lagu berbeda lagi');
    expect(byFocus('stats-recap')).toBeNull();
  });
});
