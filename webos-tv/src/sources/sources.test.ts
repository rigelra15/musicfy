import { describe, expect, it, vi } from 'vitest';
import { YouTubePlaybackError, type ResolvedStream } from '../data/youtubePlayback';
import type { Track } from '../model';
import { DEFAULT_ENABLED, DEFAULT_ORDER, activeSources, move, parseEnabled, parseOrder, parsePicks, readSettings, type SourceSettings } from './config';
import type { ServiceResolve, SourcesClient } from './client';
import { SourceFailure, classifyPlayerError, describeFailure } from './errors';
import { createStreamResolver, queryOf } from './resolver';

const track: Track = { id: 'abcdefghijk', title: 'Espresso', artist: 'Sabrina Carpenter', durationMs: 175_000, artists: [{ name: 'Sabrina Carpenter' }], album: 'Short n Sweet', isrc: 'USUM72400001' };
const youtubeStream: ResolvedStream = { url: 'https://yt/x', mimeType: 'audio/mp4', source: { provider: 'youtube', label: 'YouTube Music', quality: 'AAC · 128 kbps', codec: 'AAC' } };
const found = (path: string, extra: Partial<Extract<ServiceResolve, { result: 'found' }>['stream']> = {}): ServiceResolve => ({ result: 'found', stream: { format: 'progressive', path, mimeType: 'audio/flac', codec: 'FLAC', qualityLabel: 'FLAC', sourceLabel: 'Monochrome', matched: { id: '1', title: 't', artist: 'a', confidence: 1 }, ...extra } });
const settings = (patch: Partial<SourceSettings> = {}): SourceSettings => ({ order: [...DEFAULT_ORDER], enabled: { ...DEFAULT_ENABLED }, picks: {}, ...patch });
const client = (resolve: SourcesClient['resolve']): SourcesClient => ({ resolve, status: async () => [], diagnose: async () => ({ ...found('/x'), steps: [] }) as never, verify: async () => ({ state: 'ready', label: '' }), signOut: async () => ({ state: 'signedOut', label: '' }) });

describe('source settings', () => {
  it('starts like Android: Monochrome, Apple Music, YouTube in that order, only YouTube on', () => {
    const initial = readSettings({ get: <T,>(_k: string, fallback: T) => fallback });
    expect(initial.order).toEqual(['monochrome', 'applemusic', 'youtube']);
    expect(initial.enabled).toEqual({ monochrome: false, applemusic: false, youtube: true });
    expect(activeSources(initial)).toEqual(['youtube']);
  });
  it('keeps a saved order and flags, repairs what is damaged, and never loses a source', () => {
    expect(parseOrder(['youtube', 'nonsense', 'youtube', 'monochrome'])).toEqual(['youtube', 'monochrome', 'applemusic']);
    expect(parseOrder('x')).toEqual(['monochrome', 'applemusic', 'youtube']);
    expect(parseEnabled({ youtube: false, applemusic: 'yes', monochrome: true })).toEqual({ youtube: false, applemusic: false, monochrome: true });
    expect(parsePicks({ applemusic: { quality: 'he64', region: '../x' }, bogus: {} })).toEqual({ applemusic: { quality: 'he64' } });
  });
  it('only enabled sources are active, in the saved order', () => {
    expect(activeSources(settings({ order: ['youtube', 'applemusic', 'monochrome'], enabled: { youtube: true, applemusic: false, monochrome: true } }))).toEqual(['youtube', 'monochrome']);
  });
  it('moves a source one place, and stops at the ends', () => {
    expect(move(['a', 'b', 'c'] as never, 'b' as never, -1)).toEqual(['b', 'a', 'c']);
    expect(move(['a', 'b', 'c'] as never, 'a' as never, -1)).toEqual(['a', 'b', 'c']);
    expect(move(['a', 'b', 'c'] as never, 'c' as never, 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('what the service is asked for', () => {
  it('sends the song as the services know it: every artist, album, length and ISRC', () => {
    expect(queryOf(track)).toEqual({ title: 'Espresso', artists: ['Sabrina Carpenter'], album: 'Short n Sweet', durationMs: 175_000, isrc: 'USUM72400001' });
    expect(queryOf({ id: 'x', title: 'Eastside', artist: 'benny blanco, Halsey & Khalid', durationMs: 0 }).artists).toEqual(['benny blanco', 'Halsey', 'Khalid']);
  });
});

describe('choosing the audio', () => {
  it('with only YouTube on it plays YouTube and never asks the service', async () => {
    const resolve = vi.fn();
    const out = await createStreamResolver({ settings: () => settings(), youtube: async () => youtubeStream, service: client(resolve) })(track);
    expect(out.source?.provider).toBe('youtube');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('tries the sources in the order set, and the first that opens wins, with honest labels', async () => {
    const resolve = vi.fn(async () => found('/api/source/media/tok1', { sampleRateHz: 96000 }));
    const youtube = vi.fn(async () => youtubeStream);
    const out = await createStreamResolver({ settings: () => settings({ enabled: { monochrome: true, applemusic: false, youtube: true } }), youtube, service: client(resolve), now: () => 1000 })(track);
    expect(out).toMatchObject({ format: 'progressive', mimeType: 'audio/flac', expiresAtMs: 1000 + 50 * 60_000, source: { provider: 'monochrome', label: 'Monochrome', quality: 'FLAC', codec: 'FLAC', sampleRateHz: 96000 } });
    expect(youtube).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledWith('monochrome', expect.objectContaining({ title: 'Espresso' }), undefined);
  });

  it('a protected stream carries its license address, never a credential', async () => {
    const resolve = async () => found('/api/source/manifest/tok9', { format: 'hls', mimeType: 'application/vnd.apple.mpegurl', codec: 'AAC', qualityLabel: 'AAC 256', sourceLabel: 'Apple Music', drm: { system: 'com.widevine.alpha', licensePath: '/api/source/license/tok10' } });
    const out = await createStreamResolver({ settings: () => settings({ enabled: { monochrome: false, applemusic: true, youtube: false } }), youtube: async () => youtubeStream, service: client(resolve) })(track);
    expect(out).toMatchObject({ format: 'hls', drm: { licenseUrl: '/api/source/license/tok10' }, source: { provider: 'applemusic', quality: 'AAC 256' } });
  });

  it('passes the picks for that source (quality, region)', async () => {
    const resolve = vi.fn(async () => found('/x'));
    await createStreamResolver({ settings: () => settings({ enabled: { monochrome: false, applemusic: true, youtube: false }, picks: { applemusic: { quality: 'he64', region: 'id' } } }), youtube: async () => youtubeStream, service: client(resolve) })(track);
    expect(resolve).toHaveBeenCalledWith('applemusic', expect.anything(), { quality: 'he64', region: 'id' });
  });

  it('when a higher source did not play, the stream says which and why (a fallback is never silent)', async () => {
    const resolve = async (): Promise<ServiceResolve> => ({ result: 'notFound', kind: 'matching', reason: 'Tidak ada di Monochrome.' });
    const out = await createStreamResolver({ settings: () => settings({ enabled: { monochrome: true, applemusic: false, youtube: true } }), youtube: async () => youtubeStream, service: client(resolve) })(track);
    expect(out.source).toMatchObject({ provider: 'youtube', skipped: [{ provider: 'Monochrome', kind: 'matching', reason: 'Lagu ini tidak ditemukan di sumber ini.' }] });
  });

  it('with YouTube off, a failing source does NOT fall back to YouTube: the failure names the step', async () => {
    const youtube = vi.fn(async () => youtubeStream);
    const resolve = async (): Promise<ServiceResolve> => ({ result: 'unavailable', kind: 'auth', reason: 'Hubungkan akun Apple Music dari HP dulu.' });
    const run = createStreamResolver({ settings: () => settings({ enabled: { monochrome: false, applemusic: true, youtube: false } }), youtube, service: client(resolve) });
    await expect(run(track)).rejects.toMatchObject({ name: 'SourceFailure', kind: 'auth', provider: 'Apple Music', message: expect.stringMatching(/Akun · Apple Music: Akun belum terhubung/) });
    expect(youtube).not.toHaveBeenCalled();
  });

  it('everything off is an explicit message, not a silent YouTube', async () => {
    const youtube = vi.fn();
    const run = createStreamResolver({ settings: () => settings({ enabled: { monochrome: false, applemusic: false, youtube: false } }), youtube, service: client(vi.fn()) });
    await expect(run(track)).rejects.toMatchObject({ kind: 'disabled' });
    expect(youtube).not.toHaveBeenCalled();
  });

  it('when several fail, the message walks through each source and each step', async () => {
    const resolve = async (): Promise<ServiceResolve> => ({ result: 'notFound', kind: 'matching', reason: 'Tidak ada.' });
    const youtube = async () => { throw new YouTubePlaybackError('unplayable', 'Lagu ini belum bisa diputar oleh pemutar TV.'); };
    const run = createStreamResolver({ settings: () => settings({ enabled: { monochrome: true, applemusic: false, youtube: true } }), youtube, service: client(resolve) });
    await expect(run(track)).rejects.toMatchObject({ kind: 'stream', message: 'Monochrome: pencocokan lagu (Lagu ini tidak ditemukan di sumber ini.) → YouTube Music: stream (Lagu ini belum bisa diputar oleh pemutar TV.)' });
  });

  it('a service that cannot be reached is a network failure of that source, then the next source is tried', async () => {
    const resolve = async (): Promise<ServiceResolve> => { throw new SourceFailure('network', 'Layanan Musicfy di TV tidak merespons.'); };
    const out = await createStreamResolver({ settings: () => settings({ enabled: { monochrome: true, applemusic: false, youtube: true } }), youtube: async () => youtubeStream, service: client(resolve) })(track);
    expect(out.source?.skipped?.[0]).toMatchObject({ provider: 'Monochrome', kind: 'network' });
  });

  it('YouTube errors keep their meaning: a missing connection is network, an unsupported format is decode', async () => {
    const run = (error: YouTubePlaybackError) => createStreamResolver({ settings: () => settings(), youtube: async () => { throw error; }, service: client(vi.fn()) })(track);
    await expect(run(new YouTubePlaybackError('network', 'x'))).rejects.toMatchObject({ kind: 'network' });
    await expect(run(new YouTubePlaybackError('unsupported-format', 'x'))).rejects.toMatchObject({ kind: 'decode' });
    await expect(run(new YouTubePlaybackError('expired', 'x'))).rejects.toMatchObject({ kind: 'stream' });
  });

  it('local files are not looked up online', async () => {
    const resolve = vi.fn();
    const run = createStreamResolver({ settings: () => settings({ enabled: { monochrome: true, applemusic: true, youtube: true } }), youtube: vi.fn(), service: client(resolve) });
    await expect(run({ ...track, provider: 'local' })).rejects.toMatchObject({ kind: 'matching' });
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('player library errors', () => {
  const drm = (code: number, data?: unknown[]) => ({ category: 6, code, data });
  it('tells an expired account from a refused license from a missing Widevine', () => {
    expect(classifyPlayerError(drm(6007, [{ category: 1, code: 1001, data: ['u', 401] }]), 'Apple Music')).toMatchObject({ kind: 'auth' });
    expect(classifyPlayerError(drm(6007, [{ category: 1, code: 1001, data: ['u', 502] }]), 'Apple Music')).toMatchObject({ kind: 'license', message: expect.stringContaining('502') });
    expect(classifyPlayerError(drm(6008))).toMatchObject({ kind: 'license' });
    expect(classifyPlayerError(drm(6001))).toMatchObject({ kind: 'license', message: expect.stringMatching(/Widevine/) });
  });
  it('separates decode, network and stream problems', () => {
    expect(classifyPlayerError({ category: 3, code: 3016 })).toMatchObject({ kind: 'decode' });
    expect(classifyPlayerError({ category: 1, code: 1002 })).toMatchObject({ kind: 'network' });
    expect(classifyPlayerError({ category: 1, code: 1001, data: ['u', 404] })).toMatchObject({ kind: 'stream', message: expect.stringContaining('404') });
    expect(classifyPlayerError({ category: 1, code: 1001, data: ['u', 403] })).toMatchObject({ kind: 'auth' });
    expect(classifyPlayerError({ category: 4, code: 4000 })).toMatchObject({ kind: 'stream' });
    expect(classifyPlayerError({ category: 5, code: 5000 })).toMatchObject({ kind: 'stream' });
  });
  it('describes one failure as a line with the step and the source', () => {
    expect(describeFailure(new SourceFailure('license', 'Lisensi ditolak (502).', 'Apple Music'))).toBe('Lisensi · Apple Music: Lisensi ditolak (502).');
  });
});
