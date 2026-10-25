// @vitest-environment jsdom
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContextValue } from '../app/AppContext';
import { openServices, type Services } from '../app/services';
import App from '../app/Shell';
import { fakeGateway } from '../features/home/testkit';
import { createMemoryDb } from '../library/db';
import { LibraryRepository } from '../library/repository';
import { PreferencesStore } from '../library/preferences';
import { exportPortable } from './portable';

let host: HTMLElement;
let services: Services;
let api: () => AppContextValue;
const flush = (ms = 8) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const byFocus = (id: string) => document.querySelector<HTMLElement>(`[data-focus-id="${id}"]`);
const top = () => document.querySelector('.overlay-layer.is-top');
const overlayItem = (suffix: string) => top()?.querySelector<HTMLElement>(`[data-focus-id$="-${suffix}"]`) ?? null;
const clickOverlay = async (suffix: string) => { const el = overlayItem(suffix); if (!el) throw new Error(`no ${suffix}`); await act(() => { el.click(); }); await flush(); };
const HEADER = 'Type,Playlist name,Track name,Artist name,Album,Duration (ms),Video ID,Thumbnail';
const csv = [HEADER, 'Favorite,,Lagu A,Senja,,200000,abcdefghijk,', 'Playlist,Santai,Lagu B,Senja,,1000,cdefghijklm,'].join('\n');

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(() => { render(h(App, { services, catalog: fakeGateway(), lyricsRequest: async (id) => ({ type: 'missing', source: id }), playerFactory: () => ({ subscribe: () => () => undefined, load: async () => 1, play: async () => undefined, pause: () => undefined, seekTo: () => undefined, dispose: () => undefined }), onReady: (getter) => { api = getter; } }), host); });
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
afterEach(() => { unmount(); vi.restoreAllMocks(); });

describe('import from a file', () => {
  const pick = async (file: File) => {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(() => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await flush(20);
  };

  it('a CSV shows its preview, imports on Impor, and the songs are in the collection', async () => {
    await mount();
    await pick(new File([csv], 'playlist.csv', { type: 'text/csv' }));
    expect(top()?.querySelector('h2')?.textContent).toBe('Impor ke TV');
    expect(top()!.textContent).toContain('file playlist.csv');
    expect(await services.repo.listLiked()).toHaveLength(0);                       // nothing written yet
    await clickOverlay('apply');
    expect(top()!.textContent).toContain('Impor selesai');
    expect(await services.repo.listLiked()).toHaveLength(1);
    expect((await services.repo.listPlaylists()).map((p) => p.name)).toEqual(['Santai']);
  });

  it('a portable backup defaults to merge, replace asks for confirmation before anything is deleted, and Back drops the data', async () => {
    const source = new LibraryRepository(createMemoryDb()); const prefs = new PreferencesStore(source); await prefs.hydrate();
    await source.setLiked({ id: 'abcdefghijk', title: 'Lagu A', artist: 'Senja', durationMs: 1000, provider: 'youtube' }, true);
    const backup = JSON.stringify(await exportPortable(source, prefs, { app: 'musicfy-android', version: '8.1.0' }));
    await services.repo.addToLibrary({ id: 'zzzzzzzzzzz', title: 'Lokal TV', artist: 'X', durationMs: 1, provider: 'youtube' });
    await mount();
    await pick(new File([backup], 'cadangan.musicfy.json', { type: 'application/json' }));
    expect(overlayItem('merge')?.getAttribute('aria-current')).toBe('true');
    await clickOverlay('replace');
    expect(top()!.textContent).toContain('Akan dihapus: 1 lagu');
    await clickOverlay('apply');
    expect(top()!.textContent).toContain('Ganti seluruh koleksi?');
    expect(await services.repo.listLibrary()).toHaveLength(1);                     // still the TV's own song
    await act(() => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    await flush();
    await clickOverlay('discard');
    expect(api().importFlow.getSnapshot().status).toBe('idle');
    expect((await services.repo.listLibrary()).map((r) => r.trackKey)).toEqual(['youtube:track:zzzzzzzzzzz']);
  });

  it('a file that is not a backup says so', async () => {
    await mount();
    await pick(new File(['{"hello":1}'], 'x.json', { type: 'application/json' }));
    expect(top()!.textContent).toContain('bukan backup Musicfy');
  });

  it('a very large file is refused before it is read', async () => {
    await mount();
    const big = new File(['x'], 'big.json');
    Object.defineProperty(big, 'size', { value: 65 * 1024 * 1024 });
    await pick(big);
    expect(top()).toBeNull();
    expect(document.querySelector('.toast')?.textContent).toContain('terlalu besar');
  });
});

describe('connect a phone', () => {
  type Reply = { status?: number; body: unknown };
  function mockService(handlers: Record<string, (init?: RequestInit) => Reply>) {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).replace('/api/transfer/', '');
      calls.push(`${init?.method ?? 'GET'} ${path}`);
      const reply = handlers[path]?.(init) ?? { status: 404, body: {} };
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
    }));
    return calls;
  }
  const qr = 'musicfy://pair?v=1&h=192.168.1.20&p=45000&s=abc&k=AAAAAAAAAAAAAAAAAAAAAA&t=BBBB&n=TV';
  afterEach(() => vi.unstubAllGlobals());

  it('shows a QR code and instructions, then the preview once the phone has sent a file; leaving never leaves the listener open', async () => {
    let phase = 'waiting';
    const calls = mockService({
      start: () => ({ body: { qr, expiresAt: Date.now() + 300_000 } }),
      status: () => ({ body: { phase, device: 'Pixel', expiresAt: Date.now() + 200_000 } }),
      payload: () => ({ body: { kind: 'csv', device: 'Pixel', text: csv } }),
      cancel: () => ({ body: { phase: 'cancelled' } }),
    });
    await mount();
    await act(() => { byFocus('import-phone')!.click(); });
    await flush();
    expect(top()?.querySelector('h2')?.textContent).toBe('Hubungkan HP');
    expect(top()?.querySelector('svg.qr-code')).toBeTruthy();
    expect(top()!.textContent).toContain('Transfer ke TV');
    expect(top()!.textContent).toMatch(/Kode berlaku \d:\d\d/);
    expect(top()!.textContent).not.toContain('AAAAAAAA');                              // the code itself is never printed
    phase = 'received';
    await flush(1100);
    expect(top()?.querySelector('h2')?.textContent).toBe('Impor ke TV');
    expect(top()!.textContent).toContain('HP Pixel');
    await clickOverlay('apply');
    expect(await services.repo.listLiked()).toHaveLength(1);
    expect(calls.filter((call) => call === 'POST cancel')).toHaveLength(0);
  });

  it('Back while waiting closes the listener on the TV', async () => {
    const calls = mockService({
      start: () => ({ body: { qr, expiresAt: Date.now() + 300_000 } }),
      status: () => ({ body: { phase: 'waiting' } }),
      cancel: () => ({ body: { phase: 'cancelled' } }),
    });
    await mount();
    await act(() => { byFocus('import-phone')!.click(); });
    await flush();
    await act(() => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    await flush();
    expect(top()).toBeNull();
    expect(calls).toContain('POST cancel');
  });

  it('hiding the app (the TV suspends it) cancels the session', async () => {
    const calls = mockService({
      start: () => ({ body: { qr, expiresAt: Date.now() + 300_000 } }),
      status: () => ({ body: { phase: 'waiting' } }),
      cancel: () => ({ body: { phase: 'cancelled' } }),
    });
    await mount();
    await act(() => { byFocus('import-phone')!.click(); });
    await flush();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    await act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await flush();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    expect(calls).toContain('POST cancel');
    expect(top()!.textContent).toContain('dibatalkan');
  });

  it('a TV with no network shows the reason instead of a code', async () => {
    mockService({ start: () => ({ status: 503, body: { error: 'TV tidak terhubung ke jaringan Wi-Fi atau Ethernet.', code: 'noNetwork' } }) });
    await mount();
    await act(() => { byFocus('import-phone')!.click(); });
    await flush();
    expect(top()?.querySelector('svg.qr-code')).toBeNull();
    expect(top()!.textContent).toContain('tidak terhubung ke jaringan');
  });
});

describe('entry points', () => {
  it('Library offers it, and the first-run setup offers the phone transfer', async () => {
    await mount();
    await act(() => { api().goTab('library'); });
    await flush();
    expect(document.querySelector('[data-focus-id="lib-import"]')).toBeTruthy();
  });
});
