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
import type { DiagnosticStep, ModuleStatus, ServiceResolve, SourcesClient } from './client';

class FakePlayer implements PlayerPort {
  listener: (snapshot: PlaybackSnapshot) => void = () => undefined;
  subscribe(listener: (snapshot: PlaybackSnapshot) => void) { this.listener = listener; return () => undefined; }
  async load() { return 1; }
  async play() { /* nothing */ }
  pause() { /* nothing */ }
  seekTo() { /* nothing */ }
  dispose() { /* nothing */ }
  emit(snapshot: Omit<PlaybackSnapshot, 'loadId'>) { this.listener({ ...snapshot, loadId: 1 }); }
}

let host: HTMLElement;
let services: Services;
let api: () => AppContextValue;
let player: FakePlayer;
let modules: ModuleStatus[];
let client: { [K in keyof SourcesClient]: ReturnType<typeof vi.fn> };
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 8)); });
const byFocus = (id: string) => document.querySelector<HTMLElement>(`[data-focus-id="${id}"]`);
const click = async (id: string) => { const el = byFocus(id); if (!el) throw new Error(`no ${id}`); await act(() => { el.click(); }); await flush(); };
const top = () => document.querySelector('.overlay-layer.is-top');
const rows = () => Array.from(document.querySelectorAll('.module-row strong')).map((el) => el.textContent);

const mono: ModuleStatus = { id: 'monochrome', name: 'Monochrome', description: 'FLAC lossless', needsAccount: false, account: { state: 'ready', label: 'Tanpa akun' }, choices: [] };
const apple = (state: ModuleStatus['account']): ModuleStatus => ({ id: 'applemusic', name: 'Apple Music', description: 'Langganan Apple Music', needsAccount: true, account: state, choices: [{ id: 'quality', label: 'Kualitas', options: [{ id: 'aac256', label: 'AAC 256', description: '' }, { id: 'he64', label: 'HE-AAC 64', description: '' }] }] });

async function mount(options: { route?: { name: 'modules'; moduleId?: string } | { name: 'settings' } } = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  player = new FakePlayer();
  await act(() => { render(h(App, { services, catalog: fakeGateway(), sourcesClient: client as unknown as SourcesClient, lyricsRequest: async (id) => ({ type: 'missing', source: id }), playerFactory: () => player, onReady: (getter) => { api = getter; } }), host); });
  await flush();
  await act(() => { api().navigate(options.route ?? { name: 'modules' }); });
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
  modules = [mono, apple({ state: 'signedOut', label: 'Belum terhubung' })];
  client = {
    status: vi.fn(async () => modules),
    resolve: vi.fn(async (): Promise<ServiceResolve> => ({ result: 'unavailable', kind: 'auth', reason: 'x' })),
    diagnose: vi.fn(async (): Promise<ServiceResolve & { steps: DiagnosticStep[] }> => ({ result: 'notFound', kind: 'matching', reason: 'x', steps: [{ id: 'account', name: 'Akun', ok: true, detail: 'Terhubung' }, { id: 'search', name: 'Cari lagu', ok: false, detail: 'Tidak ada' }] })),
    verify: vi.fn(async () => ({ state: 'signedIn' as const, label: 'Terhubung · United States' })),
    signOut: vi.fn(async () => ({ state: 'signedOut' as const, label: 'Belum terhubung' })),
  };
});
afterEach(() => { unmount(); vi.restoreAllMocks(); });

describe('modules page', () => {
  it('opens from Settings, lists the sources in Android\'s order with only YouTube on', async () => {
    await mount({ route: { name: 'settings' } });
    await click('settings-modules');
    expect(rows()).toEqual(['Monochrome', 'Apple Music', 'YouTube Music']);
    expect(byFocus('module-youtube-toggle')!.getAttribute('aria-pressed')).toBe('true');
    expect(byFocus('module-monochrome-toggle')!.getAttribute('aria-pressed')).toBe('false');
    expect(document.body.textContent).toContain('Belum terhubung');
  });

  it('turning sources on and off and moving them is saved, and the order of rows follows', async () => {
    await mount();
    await click('module-monochrome-toggle');
    expect(services.prefs.get<Record<string, boolean>>('modules.enabled', {}).monochrome).toBe(true);
    await click('module-youtube-up');
    await click('module-youtube-up');
    expect(rows()).toEqual(['YouTube Music', 'Monochrome', 'Apple Music']);
    expect(services.prefs.get('modules.order', [])).toEqual(['youtube', 'monochrome', 'applemusic']);
    expect(byFocus('module-youtube-up')!.hasAttribute('disabled')).toBe(true);
    unmount();
    await mount();
    expect(rows()).toEqual(['YouTube Music', 'Monochrome', 'Apple Music']);
  });

  it('says plainly when every source is off', async () => {
    await mount();
    await click('module-youtube-toggle');
    expect(document.body.textContent).toContain('Semua sumber mati');
    expect(document.querySelector('[role="alert"]')).toBeTruthy();
  });

  it('shows what the service says when it cannot be asked', async () => {
    client.status.mockRejectedValue(new Error('Layanan Musicfy di TV tidak merespons.'));
    await mount();
    expect(document.body.textContent).toContain('Status sumber tidak bisa dibaca');
    expect(rows()).toHaveLength(3);
  });
});

describe('Apple Music detail', () => {
  const open = async () => { await mount(); await click('module-applemusic-open'); };

  it('says up front that playback on this TV is not proven, and that offline is not supported', async () => {
    await open();
    expect(document.querySelector('h1')!.textContent).toBe('Apple Music');
    expect(document.body.textContent).toContain('Belum terbukti di TV');
    expect(document.body.textContent).toContain('Widevine');
    expect(document.body.textContent).toContain('Tidak mendukung unduhan offline');
  });

  it('connect opens the phone pairing, and a signed-out account offers no sign-out', async () => {
    await open();
    expect(byFocus('module-signout')).toBeNull();
    expect(byFocus('module-verify')).toBeTruthy();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'x' }), { status: 503 })));
    await act(() => { byFocus('module-connect')!.click(); });
    await flush();
    expect(top()?.querySelector('h2')?.textContent).toBe('Hubungkan HP');
    vi.unstubAllGlobals();
  });

  it('check account asks the service and shows the answer', async () => {
    await open();
    modules = [mono, apple({ state: 'signedIn', label: 'Terhubung · United States' })];
    await click('module-verify');
    expect(client.verify).toHaveBeenCalledWith('applemusic');
    expect(document.body.textContent).toContain('Terhubung · United States');
    expect(byFocus('module-signout')).toBeTruthy();
  });

  it('disconnecting asks first, then removes the session through the service', async () => {
    modules = [mono, apple({ state: 'signedIn', label: 'Terhubung' })];
    await open();
    await click('module-signout');
    expect(client.signOut).not.toHaveBeenCalled();
    expect(top()!.textContent).toContain('Putuskan akun Apple Music?');
    const confirm = Array.from(top()!.querySelectorAll<HTMLElement>('button')).find((b) => b.textContent === 'Putuskan akun')!;
    modules = [mono, apple({ state: 'signedOut', label: 'Belum terhubung' })];
    await act(() => { confirm.click(); });
    await flush();
    expect(client.signOut).toHaveBeenCalledWith('applemusic');
  });

  it('quality and region are choices that are saved and sent with every lookup', async () => {
    await open();
    await click('module-choice-quality');
    const option = Array.from(top()!.querySelectorAll<HTMLElement>('.overlay-item')).find((el) => el.textContent?.startsWith('HE-AAC 64'))!;
    await act(() => { option.click(); });
    await flush();
    expect(services.prefs.get<Record<string, { quality: string }>>('modules.picks', {}).applemusic.quality).toBe('he64');
    expect(byFocus('module-choice-quality')!.textContent).toContain('HE-AAC 64');
    await click('module-test');
    expect(client.diagnose).toHaveBeenCalledWith('applemusic', expect.objectContaining({ title: 'Espresso' }), { quality: 'he64' });
  });

  it('the test lists every step, names the step that failed, and never claims the TV plays it', async () => {
    await open();
    await click('module-test');
    expect(document.querySelector('.module-test')!.textContent).toContain('✓ Akun');
    expect(document.querySelector('.module-test')!.textContent).toContain('✗ Cari lagu');
    expect(document.querySelector('.module-test')!.textContent).toContain('Gagal pada: Pencocokan lagu');
    client.diagnose.mockResolvedValueOnce({ result: 'found', steps: [{ id: 'stream', name: 'Stream', ok: true, detail: 'AAC 256' }] });
    await click('module-test');
    expect(document.querySelector('.module-test')!.textContent).toContain('Pemutaran sungguhan di TV belum diuji');
  });

  it('tests with the song that is playing when there is one', async () => {
    await open();
    const song: Track = { id: 'abcdefghijk', title: 'Eastside', artist: 'benny blanco, Halsey', durationMs: 173_000, artists: [{ name: 'benny blanco' }, { name: 'Halsey' }] };
    await act(() => { api().playTracks([song], 0, 'manual'); });
    await flush();
    await click('module-test');
    expect(client.diagnose).toHaveBeenCalledWith('applemusic', expect.objectContaining({ title: 'Eastside', artists: ['benny blanco', 'Halsey'] }), {});
  });
});

describe('what is playing', () => {
  it('the player says where the audio comes from, and never lists what a fallback skipped', async () => {
    await mount();
    const song: Track = { id: 'abcdefghijk', title: 'Eastside', artist: 'X', durationMs: 1000 };
    await act(() => { api().playTracks([song], 0, 'manual'); });
    await act(() => { api().goTab('player'); });
    await flush();
    await act(() => { player.emit({ status: 'playing', positionMs: 0, durationMs: 1000, source: { provider: 'youtube', label: 'YouTube Music', quality: 'AAC · 128 kbps', skipped: [{ provider: 'Monochrome', kind: 'matching', reason: 'Tidak ada di Monochrome.' }] } }); });
    expect(document.querySelector('.format-badge')!.textContent).toBe('AAC');
    expect(document.querySelector('.format-badge')!.getAttribute('title')).toBe('YouTube Music · AAC · 128 kbps');
    expect(document.querySelector('.source-skipped')).toBeNull();
    expect(document.querySelector('.player-view')!.textContent).not.toMatch(/Monochrome \(|Not available|Belum bisa dipakai/);
  });

  it('shows a Hi-Res rate only when the source reported one', async () => {
    await mount();
    const song: Track = { id: 'abcdefghijk', title: 'Eastside', artist: 'X', durationMs: 1000 };
    await act(() => { api().playTracks([song], 0, 'manual'); });
    await act(() => { api().goTab('player'); });
    await act(() => { player.emit({ status: 'playing', positionMs: 0, durationMs: 1000, source: { provider: 'monochrome', label: 'Monochrome', quality: 'Hi-Res FLAC', codec: 'FLAC', sampleRateHz: 96000 } }); });
    expect(document.querySelector('.format-badge')!.textContent).toBe('FLAC');
    expect(document.querySelector('.format-badge')!.getAttribute('title')).toBe('Monochrome · Hi-Res FLAC · 96 kHz');
    await act(() => { player.emit({ status: 'playing', positionMs: 0, durationMs: 1000, source: { provider: 'monochrome', label: 'Monochrome', quality: 'FLAC', codec: 'FLAC', sampleRateHz: 44100 } }); });
    expect(document.querySelector('.format-badge')!.getAttribute('title')).toBe('Monochrome · FLAC · 44.1 kHz');
  });

  it('puts the format tag beside the artist while keeping the title in its own scroll area', async () => {
    await mount();
    const song: Track = { id: 'abcdefghijk', title: 'care less', artist: 'LANY', durationMs: 1000 };
    await act(() => { api().playTracks([song], 0, 'manual'); });
    await act(() => { api().goTab('player'); });
    await act(() => { player.emit({ status: 'playing', positionMs: 0, durationMs: 1000 }); });
    expect(document.querySelector('.format-badge')).toBeNull();
    await act(() => { player.emit({ status: 'playing', positionMs: 0, durationMs: 1000, source: { provider: 'youtube', label: 'YouTube Music', quality: 'Opus · 131 kbps', codec: 'Opus' } }); });
    expect(document.querySelector('.player-title-row .format-badge')).toBeNull();
    expect(document.querySelector('.player-artist-row .format-badge')!.textContent).toBe('OPUS');
    expect(document.querySelector('.player-title-row .scroll-text')?.getAttribute('title')).toBe('care less');
    expect(document.querySelector('.player-details h2')!.textContent).toBe('care less');
    // no second line of source text under the artist
    expect(document.querySelector('.player-source')).toBeNull();
    await act(() => { player.emit({ status: 'playing', positionMs: 0, durationMs: 1000, source: { provider: 'applemusic', label: 'Apple Music', quality: 'AAC 256' } }); });
    expect(document.querySelector('.format-badge')!.textContent).toBe('AAC');
  });
});
