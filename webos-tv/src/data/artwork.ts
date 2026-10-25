export type ArtworkSize = 'small' | 'large';

function safeArtworkUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Match the mobile cover requests without rewriting unrelated image providers. */
export function resizeArtwork(value: string, pixels: number): string {
  const valid = safeArtworkUrl(value);
  if (!valid) return value;
  const url = new URL(valid);
  const host = url.hostname.toLowerCase();
  if (host === 'i.ytimg.com' || host === 'img.youtube.com') {
    const quality = pixels >= 1200 ? 'maxresdefault.jpg' : 'hqdefault.jpg';
    url.pathname = url.pathname.replace('/vi_webp/', '/vi/').replace(
      /(?:default|mqdefault|hqdefault|sddefault|maxresdefault)\.(?:jpg|webp)$/i, quality,
    );
    return url.href;
  }
  if (host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com')) {
    url.pathname = `${url.pathname.split('=')[0]}=w${pixels}-h${pixels}-p-l90-rj`;
    return url.href;
  }
  if (host === 'yt3.ggpht.com') {
    url.pathname = `${url.pathname.split('=')[0]}=s${pixels}`;
    return url.href;
  }
  return value;
}

export function artworkCandidates(value: string | undefined, size: ArtworkSize): string[] {
  const original = safeArtworkUrl(value);
  return Array.from(new Set(original
    ? [resizeArtwork(original, size === 'large' ? 1200 : 256), original, './icon.png']
    : ['./icon.png']));
}

export interface ArtworkState {
  key: string;
  candidates: string[];
  index: number;
}

export function createArtworkState(
  track: { id: string; artworkUrl?: string }, size: ArtworkSize,
): ArtworkState {
  return {
    key: JSON.stringify([track.id, track.artworkUrl ?? '', size]),
    candidates: artworkCandidates(track.artworkUrl, size),
    index: 0,
  };
}

/** An old image's asynchronous error must never skip the next track's source. */
export function advanceArtworkFallback(state: ArtworkState, failedUrl: string): ArtworkState {
  if (state.candidates[state.index] !== failedUrl || state.index >= state.candidates.length - 1) return state;
  return { ...state, index: state.index + 1 };
}
