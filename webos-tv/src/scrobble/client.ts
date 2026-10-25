import { runtimeFetch } from '../platform/runtime';
import type { Track } from '../model';
import { tr } from '../app/i18n';

export interface ScrobbleSiteStatus { id: 'lastfm' | 'librefm'; label: string; configured: boolean; signedIn: boolean; username?: string; enabled: boolean; profileUrl?: string }
export interface ScrobbleStatus { sites: ScrobbleSiteStatus[]; pending: number }
export type FinishResult = { state: 'waiting' } | { state: 'expired' } | { state: 'signedIn'; username: string };

export class ScrobbleRequestError extends Error {
  constructor(readonly kind: string, message: string) { super(message); this.name = 'ScrobbleRequestError'; }
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/** What a scrobbling service wants of a song: the first artist only, since "A, B" would become an artist of its own. */
export function scrobbleTrackOf(track: Track): { artist: string; track: string; album?: string; durationSeconds?: number } | undefined {
  const artist = (track.artists?.[0]?.name ?? track.artist.split(/\s*(?:,|&)\s*/)[0] ?? '').trim();
  const title = track.title.trim();
  if (!artist || !title) return undefined;
  const album = track.album?.trim();
  return { artist, track: title, ...(album ? { album } : {}), ...(track.durationMs > 0 ? { durationSeconds: Math.round(track.durationMs / 1000) } : {}) };
}

/** The screen's side of scrobbling: sessions, keys and the retry queue all live in the service, which this only asks. */
export class ScrobbleClient {
  constructor(private readonly fetcher: Fetcher = runtimeFetch) {}

  private async call<T>(path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher('/api/scrobble/' + path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (error) {
      throw new ScrobbleRequestError('network', tr('err.service.unreachable'));
    }
    let data: unknown; try { data = await response.json(); } catch { data = undefined; }
    if (!response.ok) {
      const payload = (data && typeof data === 'object' ? data : {}) as { error?: string; kind?: string };
      throw new ScrobbleRequestError(payload.kind ?? 'upstream', payload.kind === 'notConfigured' ? tr('err.scrobble.notConfigured') : tr('err.service.status', { status: response.status }));
    }
    return data as T;
  }

  status = () => this.call<ScrobbleStatus>('status');
  begin = (site: string) => this.call<{ authUrl: string }>('begin', { site });
  finish = (site: string) => this.call<FinishResult>('finish', { site });
  signOut = (site: string) => this.call<ScrobbleStatus>('signout', { site });
  setEnabled = (site: string, enabled: boolean) => this.call<ScrobbleStatus>('enable', { site, enabled });
  flush = () => this.call<ScrobbleStatus>('flush', {});
  nowPlaying = (track: Track) => { const t = scrobbleTrackOf(track); return t ? this.call('nowplaying', { track: t }) : Promise.resolve(); };
  scrobble = (track: Track, startedAtSeconds: number) => { const t = scrobbleTrackOf(track); return t ? this.call('scrobble', { track: t, startedAt: startedAtSeconds }) : Promise.resolve(); };
  love = (track: Track, loved: boolean) => { const t = scrobbleTrackOf(track); return t ? this.call('love', { artist: t.artist, track: t.track, love: loved }) : Promise.resolve(); };
}
