import type { ResolvedStream } from '../data/youtubePlayback';
import { SourceFailure, classifyPlayerError } from '../sources/errors';
import { tr } from '../app/i18n';

/** What is attached to the audio element for one HLS song; `destroy` lets go of it. */
export interface HlsSession { destroy(): Promise<void> | void }
export type HlsLoader = (audio: HTMLAudioElement, stream: ResolvedStream, onError: (failure: SourceFailure) => void) => Promise<HlsSession>;

interface ShakaPlayer {
  attach(element: HTMLMediaElement): Promise<void>;
  configure(config: unknown): boolean;
  load(uri: string): Promise<void>;
  destroy(): Promise<void>;
  addEventListener(type: 'error', listener: (event: { detail: { category?: number; code?: number; data?: unknown[] } }) => void): void;
}
interface ShakaNamespace { polyfill: { installAll(): void }; Player: { new (): ShakaPlayer; isBrowserSupported(): boolean } }

let loaded: Promise<ShakaNamespace> | undefined;
/** The player library is only fetched when a protected or adaptive song is played; progressive audio never loads it. */
function loadShaka(): Promise<ShakaNamespace> {
  loaded ??= import('shaka-player/dist/shaka-player.compiled.js').then((module) => {
    const shaka = ((module as unknown as { default?: ShakaNamespace }).default ?? (module as unknown as ShakaNamespace));
    shaka.polyfill.installAll();
    return shaka;
  });
  return loaded;
}

/**
 * Shaka Player without its UI: the TV's MSE and EME do the work, the license goes to the Musicfy
 * service (never to the internet from the page), and every error is mapped to what failed.
 * Whether a particular TV decodes or licenses a stream is proven on the TV, not by this code.
 */
export const shakaLoader: HlsLoader = async (audio, stream, onError) => {
  const provider = stream.source?.label;
  let shaka: ShakaNamespace;
  try { shaka = await loadShaka(); } catch { throw new SourceFailure('decode', tr('err.hls.load'), provider); }
  if (!shaka.Player.isBrowserSupported()) throw new SourceFailure('decode', tr('err.hls.unsupported'), provider);
  const player = new shaka.Player();
  player.addEventListener('error', (event) => onError(classifyPlayerError(event.detail, provider)));
  const session: HlsSession = { destroy: () => player.destroy().catch(() => undefined) };
  try {
    await player.attach(audio);
    player.configure({
      drm: stream.drm ? { servers: { 'com.widevine.alpha': stream.drm.licenseUrl }, retryParameters: { maxAttempts: 1, timeout: 15000 } } : {},
      streaming: { retryParameters: { maxAttempts: 2, timeout: 15000 } },
      manifest: { retryParameters: { maxAttempts: 2, timeout: 15000 } },
    });
    await player.load(stream.url);
    return session;
  } catch (error) {
    await session.destroy();
    throw classifyPlayerError(error as { category?: number; code?: number; data?: unknown[] }, provider);
  }
};
