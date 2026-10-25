// @vitest-environment jsdom
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContextValue } from '../app/AppContext';
import { openServices, type Services } from '../app/services';
import App from '../app/Shell';
import { fakeGateway } from '../features/home/testkit';
import { createMemoryDb } from '../library/db';
import { playlistIdFor } from './runner';

let host: HTMLElement;
let services: Services;
let api: () => AppContextValue;
const flush = (ms = 8) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const top = () => document.querySelector('.overlay-layer.is-top');
const overlayItem = (suffix: string) => top()?.querySelector<HTMLElement>(`[data-focus-id$="-${suffix}"]`) ?? null;
const clickOverlay = async (suffix: string) => { const el = overlayItem(suffix); if (!el) throw new Error(`no ${suffix}; have ${top()?.textContent}`); await act(() => { el.click(); }); await flush(20); };
const byFocus = (id: string) => document.querySelector<HTMLElement>(`[data-focus-id="${id}"]`);

const LISTED = [{ title: 'Lagu Satu', artist: 'Senja', durationMs: 200000 }, { title: 'Tidak Ada', artist: 'Antah', durationMs: 100000 }];
const reply = (tracks = LISTED, warnings: string[] = []) => ({ source: 'spotify', kind: 'playlist', remoteId: '37i9dQZF1DXcBWIGoYBM5M', url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', name: 'Mix Harian', warnings, tracks });
const catalog = () => ({
  ...fakeGateway(),
  search: async (query: string, filter = 'all') => ({ filter: filter as 'songs', sections: [], skipped: 0, items: query.startsWith('Lagu Satu') && filter === 'songs' ? [{ kind: 'track' as const, id: 'yt1', title: 'Lagu Satu', artists: [{ name: 'Senja' }], durationMs: 200000 }] : [] }),
});

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(() => { render(h(App, { services, catalog: catalog(), lyricsRequest: async (id) => ({ type: 'missing', source: id }), playerFactory: () => ({ subscribe: () => () => undefined, load: async () => 1, play: async () => undefined, pause: () => undefined, seekTo: () => undefined, dispose: () => undefined }), onReady: (getter) => { api = getter; } }), host); });
  await flush();
  await act(() => { api().navigate({ name: 'import' }); });
  await flush();
}
const unmount = () => { render(null, host); host.remove(); };

beforeEach(async () => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) { return (this.closest('[hidden]') ? [] : [{}]) as unknown as DOMRectList; });
  const opened = await openServices({ db: createMemoryDb(), storage: { getItem: () => null } });
  if (!opened.ok) throw opened.error;
  services = opened.services;
  await services.prefs.set('ui.language', 'id');
  await services.prefs.set('onboarding.done', true);
});
afterEach(() => { unmount(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function paste(text: string) {
  const input = overlayItem('link') as HTMLInputElement;
  await act(() => { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await clickOverlay('read');
}

describe('import from a link', () => {
  it('reads, previews with the provider limit, imports and lists what did not match', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(reply(LISTED, ['Spotify hanya membagikan 100 lagu pertama sebuah playlist lewat tautan.'])), { status: 200 })));
    await mount();
    expect(document.body.textContent).toContain('Impor dari akun');
    await act(() => { byFocus('import-link')!.click(); });
    await flush();
    expect(top()?.querySelector('h2')?.textContent).toBe('Impor dari tautan');
    await paste('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
    expect(top()?.querySelector('h2')?.textContent).toBe('Mix Harian');
    expect(top()!.textContent).toContain('Spotify');
    expect(top()!.textContent).toContain('100 lagu pertama');            // provider limit is shown before importing
    expect(await services.repo.listPlaylists()).toHaveLength(0);          // nothing written yet
    await clickOverlay('go');
    await flush(50);
    expect(top()?.querySelector('h2')?.textContent).toBe('Impor selesai');
    expect(top()!.textContent).toContain('1 dari 2 lagu cocok');
    expect(top()!.textContent).toContain('1 lagu tidak ditemukan');
    expect(top()!.textContent).toContain('Tidak Ada · Antah');
    const list = (await services.repo.listPlaylists())[0];
    expect(list).toMatchObject({ id: playlistIdFor({ provider: 'spotify', kind: 'playlist', remoteId: '37i9dQZF1DXcBWIGoYBM5M' }), name: 'Mix Harian', trackCount: 1 });
    await clickOverlay('close');
    expect(document.body.textContent).toContain('Mix Harian');             // history on the import page
    expect(document.body.textContent).toContain('1 dari 2 lagu cocok');
    expect(byFocus('import-refresh-0')).not.toBeNull();
    // the copy opens like any playlist, says where it came from and that it is partial, and can be refreshed from there
    await act(() => { api().navigate({ name: 'playlist', id: list.id, origin: 'local' }); });
    await flush(30);
    expect(document.querySelector('h1')?.textContent).toBe('Mix Harian');
    expect(document.body.textContent).toContain('Spotify');
    expect(byFocus('detail-refresh')).not.toBeNull();
  });

  it('shows a plain error for a private link and keeps the field for another try', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Spotify playlist itu privat atau tidak ada.', kind: 'private' }), { status: 404 })));
    await mount();
    await act(() => { byFocus('import-link')!.click(); });
    await flush();
    await paste('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
    expect(top()!.querySelector('[role="alert"]')?.textContent).toContain('privat');
    expect((overlayItem('link') as HTMLInputElement).value).toContain('spotify.com');
  });

  it('refreshes a copy from its link and adds only what is new', async () => {
    const first = vi.fn(async () => new Response(JSON.stringify(reply()), { status: 200 }));
    vi.stubGlobal('fetch', first);
    await mount();
    await act(() => { byFocus('import-link')!.click(); });
    await flush();
    await paste('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
    await clickOverlay('go'); await flush(50);
    await clickOverlay('close');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(reply([...LISTED, { title: 'Lagu Satu', artist: 'Senja', durationMs: 200000 }])), { status: 200 })));
    await act(() => { byFocus('import-refresh-0')!.click(); });
    await flush(30);
    expect(top()!.textContent).toContain('Salinan ini sudah ada');
    await clickOverlay('go'); await flush(50);
    expect(top()!.textContent).toContain('1 lagu baru ditambahkan');       // the repeated song is a second entry; the first stays
    expect((await services.repo.listPlaylists())[0].trackCount).toBe(2);
  });
});
