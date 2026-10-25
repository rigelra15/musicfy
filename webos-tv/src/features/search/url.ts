export type ParsedYouTubeUrl = { kind: 'video'; id: string } | { kind: 'artist'; id: string };

const HOSTS = /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)$/i;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^(?:UC|MPLA)[A-Za-z0-9_-]{8,}$/;

/** A pasted YouTube / YouTube Music link, as in Android's YouTubeUrlParser: videos and artists only. */
export function parseYouTubeUrl(input: string): ParsedYouTubeUrl | undefined {
  const text = input.trim();
  if (!text || /\s/.test(text)) return undefined;
  let url: URL;
  try { url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`); } catch { return undefined; }
  if (!HOSTS.test(url.hostname)) return undefined;
  if (url.hostname.toLowerCase() === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return VIDEO_ID.test(id) ? { kind: 'video', id } : undefined;
  }
  const watch = url.searchParams.get('v');
  if (url.pathname === '/watch' && watch && VIDEO_ID.test(watch)) return { kind: 'video', id: watch };
  const parts = url.pathname.split('/').filter(Boolean);
  if ((parts[0] === 'channel' || parts[0] === 'browse') && parts[1] && CHANNEL_ID.test(parts[1])) return { kind: 'artist', id: parts[1] };
  if (parts[0] === 'shorts' && parts[1] && VIDEO_ID.test(parts[1])) return { kind: 'video', id: parts[1] };
  return undefined;
}
