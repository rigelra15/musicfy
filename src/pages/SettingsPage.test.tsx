// @vitest-environment jsdom
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContextValue } from '../app/AppContext';
import { openServices, type Services } from '../app/services';
import App from '../app/Shell';
import { fakeGateway } from '../features/home/testkit';
import { createMemoryDb } from '../library/db';
import { ScrobbleClient, type FinishResult, type ScrobbleSiteStatus, type ScrobbleStatus } from '../scrobble/client';

let host: HTMLElement;
let services: Services;
let api: () => AppContextValue;
const flush = (ms = 8) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const byFocus = (id: string) => document.querySelector<HTMLElement>(`[data-focus-id="${id}"]`);
const top = () => document.querySelector('.overlay-layer.is-top');
const click = async (id: string) => { const el = byFocus(id); if (!el) throw new Error(`no ${id}`); await act(() => { el.click(); }); await flush(); };
const overlayButton = (label: string) => [...(top()?.querySelectorAll<HTMLElement>('button') ?? [])].find((b) => b.textContent?.includes(label));
const choose = async (label: string) => { const b = overlayButton(label); if (!b) throw new Error(`no overlay button ${label}; have ${top()?.textContent}`); await act(() => { b.click(); }); await flush(); };

/** A stand-in for the service's scrobbling side. */
class FakeScrobble extends ScrobbleClient {
  sites: ScrobbleSiteStatus[] = [
    { id: 'lastfm', label: 'Last.fm', configured: true, signedIn: false, enabled: false },
    { id: 'librefm', label: 'Libre.fm', configured: false, signedIn: false, enabled: false },
  ];
  pending = 2;
  allowed = false;
  calls: string[] = [];
  constructor() { super(async () => { throw new Error('unused'); }); }
  private snapshot = (): ScrobbleStatus => ({ sites: this.sites.map((s) => ({ ...s })), pending: this.pending });
  status = async () => this.snapshot();
  begin = async (site: string) => { this.calls.push('begin:' + site); return { authUrl: `https://www.last.fm/api/auth/?api_key=K&token=T` }; };
  finish = async (site: string): Promise<FinishResult> => {
    this.calls.push('finish:' + site);
    if (!this.allowed) return { state: 'waiting' };
    this.sites[0] = { ...this.sites[0], signedIn: true, enabled: true, username: 'rina' };
    return { state: 'signedIn', username: 'rina' };
  };
  signOut = async (site: string) => { this.calls.push('signout:' + site); this.sites[0] = { ...this.sites[0], signedIn: false, enabled: false, username: undefined }; return this.snapshot(); };
  setEnabled = async (site: string, enabled: boolean) => { this.calls.push(`enable:${site}:${enabled}`); this.sites[0] = { ...this.sites[0], enabled }; return this.snapshot(); };
  love = async (track: { title: string }, loved: boolean) => { this.calls.push(`love:${track.title}:${loved}`); };
  flush = async () => { this.calls.push('flush'); this.pending = 0; return this.snapshot(); };
}

let fake: FakeScrobble;
async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(() => { render(h(App, { services, catalog: fakeGateway(), scrobbleClient: fake, lyricsRequest: async (id) => ({ type: 'missing', source: id }), playerFactory: () => ({ subscribe: () => () => undefined, load: async () => 1, play: async () => undefined, pause: () => undefined, seekTo: () => undefined, dispose: () => undefined }), onReady: (getter) => { api = getter; } }), host); });
  await flush();
  await act(() => { api().navigate({ name: 'settings' }); });
  await flush(20);
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
  fake = new FakeScrobble();
});
afterEach(() => { unmount(); vi.restoreAllMocks(); });

describe('Settings', () => {
  it('lists the sections that do something, and toggles save to the preferences', async () => {
    await mount();
    const text = document.body.textContent!;
    for (const part of ['Umum', 'Pemutaran dan konten', 'Riwayat', 'Integrasi', 'Sumber dan impor', 'Tentang']) expect(text).toContain(part);
    expect(byFocus('set-autoplay')!.textContent).toContain('Aktif');
    await click('set-autoplay');
    expect(services.prefs.get('playback.autoplay', true)).toBe(false);
    expect(byFocus('set-autoplay')!.textContent).toContain('Mati');
    await click('set-explicit');
    expect(services.prefs.get('content.hideExplicit', false)).toBe(true);
    await click('set-history-paused');
    expect(services.prefs.get('history.paused', false)).toBe(true);
  });

  it('chooses the history threshold and the language, and the UI follows', async () => {
    await mount();
    expect(byFocus('set-history-min')!.textContent).toContain('30 detik');
    await click('set-history-min');
    await choose('60 detik');
    expect(services.prefs.get('history.minSeconds', 30)).toBe(60);
    await click('set-language');
    await choose('English');
    expect(document.querySelector('h1')!.textContent).toBe('Settings');
    expect(byFocus('set-history-min')!.textContent).toContain('60 seconds');
  });

  it('clears history only after confirming, and the name is saved from its own field', async () => {
    await mount();
    await services.repo.recordPlay({ id: 'p1', track: { id: 'a', title: 'Lagu', artist: 'X', durationMs: 1000 }, sessionId: 's', startedAt: 1, listenedMs: 40000 });
    await click('set-clear-history');
    expect(await services.repo.listHistory()).toHaveLength(1);              // nothing yet: asked first
    await choose('Hapus');
    expect(await services.repo.listHistory()).toHaveLength(0);
    await click('set-name');
    const input = top()!.querySelector<HTMLInputElement>('input')!;
    await act(() => { input.value = '  Rina '; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await choose('Simpan');
    expect(services.prefs.get('profile.name', '')).toBe('Rina');
  });

  it('replays the introduction by clearing the flag and going Home', async () => {
    await mount();
    await click('set-onboarding');
    expect(services.prefs.get('onboarding.done', true)).toBe(false);
    expect(document.querySelector('[data-focus-id="onb-primary"]')).not.toBeNull();
  });
});

describe('Scrobbling in Settings', () => {
  it('shows the accounts, says a site without keys is not set up, and never fakes a sign-in', async () => {
    await mount();
    expect(byFocus('set-lastfm')!.textContent).toContain('belum masuk');
    expect(byFocus('set-librefm')!.textContent).toContain('belum diatur');
    expect(byFocus('set-librefm')!.textContent).toContain('kunci API belum dipasang');
    await click('set-librefm');
    expect(top()!.querySelector('[role="alert"]')!.textContent).toContain('kunci API belum dipasang');
    expect(top()!.querySelector('svg.qr-code')).toBeNull();
    expect(fake.calls).toEqual([]);
  });

  it('signs in through a QR code, waits until allowed, then shows the account', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      await mount();
      await click('set-lastfm');
      expect(top()!.querySelector('svg.qr-code')).not.toBeNull();
      expect(top()!.textContent).toContain('Menunggu izin');
      await act(async () => { vi.advanceTimersByTime(3100); await Promise.resolve(); });
      expect(fake.calls.filter((c) => c === 'finish:lastfm').length).toBeGreaterThan(0);
      expect(top()!.querySelector('svg.qr-code')).not.toBeNull();             // still waiting
      fake.allowed = true;
      await act(async () => { vi.advanceTimersByTime(3100); await Promise.resolve(); await Promise.resolve(); });
      await flush(20);
      expect(top()).toBeNull();
      await act(async () => { vi.advanceTimersByTime(5100); await Promise.resolve(); });
      await flush(20);
      expect(byFocus('set-lastfm')!.textContent).toContain('rina');
    } finally { vi.useRealTimers(); }
  });

  it('pauses, signs out after confirming, and sends what is waiting', async () => {
    fake.sites[0] = { ...fake.sites[0], signedIn: true, enabled: true, username: 'rina' };
    await mount();
    expect(byFocus('set-pending')!.textContent).toContain('Menunggu terkirim: 2');
    await click('set-lastfm');
    await choose('Jeda scrobble');
    expect(fake.calls).toContain('enable:lastfm:false');
    await click('set-lastfm');
    await choose('Keluar');
    expect(fake.calls).not.toContain('signout:lastfm');                     // confirm first
    await choose('Hapus');
    expect(fake.calls).toContain('signout:lastfm');
    await click('set-pending');
    expect(fake.calls).toContain('flush');
    expect(byFocus('set-pending')!.textContent).toContain('Menunggu terkirim: 0');
    await click('set-likes');
    expect(services.prefs.get('scrobble.likes', false)).toBe(true);
  });

  it('says the service cannot be reached instead of showing dead controls', async () => {
    fake.status = async () => { throw new Error('down'); };
    await mount();
    expect(document.body.textContent).toContain('tidak bisa dihubungi');
    expect(byFocus('set-lastfm')).toBeNull();
  });
});

describe('Likes become loves only when asked', () => {
  const track = { id: 'a', title: 'Lagu', artist: 'X', durationMs: 1000 };
  it('stays quiet by default and sends once turned on', async () => {
    await mount();
    await services.repo.setLiked(track, true);
    expect(fake.calls.filter((c) => c.startsWith('love'))).toEqual([]);
    await services.prefs.set('scrobble.likes', true);
    await services.repo.setLiked(track, false);
    await services.repo.setLiked(track, true);
    expect(fake.calls.filter((c) => c.startsWith('love'))).toEqual(['love:Lagu:false', 'love:Lagu:true']);
  });
});

describe('Diagnostics', () => {
  it('lists the capabilities with their real state', async () => {
    await mount();
    await click('set-diagnostics');
    expect(top()!.textContent).toContain('Versi aplikasi');
    expect(top()!.textContent).toContain('terhubung');
    expect(top()!.textContent).toMatch(/belum terbukti|didukung/);
  });
});

describe('Settings kept from the phone app', () => {
  it('saves each toggle and shows the new state', async () => {
    await mount();
    for (const [id, key, now] of [['set-savequeue', 'playback.saveQueue', false], ['set-dontskip', 'playback.dontSkipOnFailure', true], ['set-badge', 'appearance.formatBadge', false], ['set-samplerate', 'appearance.formatSampleRate', true], ['set-blur', 'appearance.blur', false], ['set-showsource', 'playback.showSource', true]] as const) {
      await click(id);
      expect(services.prefs.get(key, undefined)).toBe(now);
    }
  });
  it('picks how long to wait before skipping a failed song', async () => {
    await mount();
    await click('set-failtimeout');
    await choose('15');
    expect(services.prefs.get('playback.failureTimeout', undefined)).toBe(15);
  });
  it('turns blur off for the whole app', async () => {
    await mount();
    await click('set-blur');
    expect(document.documentElement.classList.contains('no-blur')).toBe(true);
    await click('set-blur');
    expect(document.documentElement.classList.contains('no-blur')).toBe(false);
  });
});

describe('Profile', () => {
  it('greets by name, shows all-time listening, and leads to stats and settings', async () => {
    await services.prefs.set('profile.name', 'Rina');
    await mount();
    await click('set-profile');
    expect(document.querySelector('.profile-name')!.textContent).toBe('Rina');
    expect(document.querySelector('.profile-version')!.textContent).toBe('0.4.0');
    await click('profile-stats');
    const stack = api().store.nav.stacks[api().store.nav.tab];
    expect(stack[stack.length - 1].route.name).toBe('stats');
  });
  it('calls an unnamed profile a guest', async () => {
    await mount();
    await click('set-profile');
    expect(document.querySelector('.profile-name')!.textContent).toBe('Tamu');
  });
});
