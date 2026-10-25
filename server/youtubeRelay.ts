import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Plugin } from 'vite';

const prefix = '/api/youtube';
const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
export function allowedMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith('.googlevideo.com') && !url.username && !url.password && (!url.port || url.port === '443');
  } catch { return false; }
}
export function createYouTubeRelay(fetcher: typeof fetch = fetch) {
  const streams = new Map<string, { url: string; expires: number }>();
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = (req.url || '').split('?')[0];
    if (!path.startsWith(prefix + '/')) return next();
    const reply = (status: number, error: string) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error })); };
    const origin = req.headers.origin;
    const allowedOrigin = process.env.MUSICFY_TV_ORIGIN;
    if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}` && origin !== allowedOrigin) return reply(403, 'Origin rejected');
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, X-Goog-Api-Format-Version, X-Goog-Visitor-Id, X-YouTube-Client-Name, X-YouTube-Client-Version, X-Origin');
      res.writeHead(204); res.end(); return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    res.on('close', () => controller.abort());
    try {
      const token = path.startsWith(prefix + '/media/') ? path.slice((prefix + '/media/').length) : undefined;
      if (token !== undefined) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return reply(405, 'Method not allowed');
        const entry = streams.get(token);
        if (!entry || entry.expires <= Date.now()) { streams.delete(token); return reply(410, 'Stream expired'); }
        const range = req.headers.range;
        if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return reply(416, 'Invalid range');
        let url = entry.url;
        let upstream: Response | undefined;
        for (let hop = 0; hop < 4; hop++) {
          if (!allowedMediaUrl(url)) return reply(502, 'Invalid media destination');
          upstream = await fetcher(url, { method: req.method, redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': ua, Origin: 'https://www.youtube.com', Referer: 'https://www.youtube.com/', ...(range ? { Range: range } : {}) } });
          if (![301, 302, 303, 307, 308].includes(upstream.status)) break;
          const location = upstream.headers.get('location');
          await upstream.body?.cancel();
          if (!location || hop === 3) return reply(502, 'Invalid media redirect');
          url = new URL(location, url).href;
        }
        clearTimeout(timer);
        if (!upstream) return reply(502, 'No media response');
        for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
          const value = upstream.headers.get(header); if (value) res.setHeader(header, value);
        }
        res.statusCode = upstream.status;
        if (req.method === 'HEAD' || !upstream.body) { res.end(); return; }
        await pipeline(Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream), res);
        return;
      }
      const route = path.slice(prefix.length);
      const isSession = route === '/sw.js_data';
      const isPlayer = route === '/youtubei/v1/player';
      if (!isSession && !isPlayer && route !== '/youtubei/v1/search') return reply(404, 'Unknown route');
      if (req.method !== (isSession ? 'GET' : 'POST')) return reply(405, 'Method not allowed');
      let body: string | undefined;
      if (!isSession) {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 32768) return reply(413, 'Request too large');
          chunks.push(Buffer.from(chunk));
        }
        body = Buffer.concat(chunks).toString();
        let payload;
        try { payload = JSON.parse(body); } catch { return reply(400, 'Invalid JSON'); }
        const value = isPlayer ? payload?.videoId : payload?.query;
        if (typeof value !== 'string' || !value.trim() || value.length > 200) return reply(400, 'Invalid request');
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': ua, Origin: 'https://music.youtube.com', Referer: 'https://music.youtube.com/' };
      for (const key of ['x-goog-visitor-id', 'x-goog-api-format-version', 'x-youtube-client-name', 'x-youtube-client-version']) {
        const value = req.headers[key]; if (typeof value === 'string') headers[key] = value;
      }
      const upstream = await fetcher(`https://music.youtube.com${route}${isSession ? '' : '?prettyPrint=false'}`, { method: req.method, headers, body, signal: controller.signal, redirect: 'error' });
      const chunks: Uint8Array[] = []; let size = 0;
      if (upstream.body) for await (const chunk of upstream.body) {
        size += chunk.length; if (size > 4 * 1024 * 1024) throw new Error('Response too large'); chunks.push(chunk);
      }
      let text = Buffer.concat(chunks).toString();
      if (isPlayer && upstream.ok) {
        const payload = JSON.parse(text);
        for (const [key, value] of streams) if (value.expires <= Date.now()) streams.delete(key);
        for (const format of payload.streamingData?.adaptiveFormats || []) {
          if (typeof format.url !== 'string' || !String(format.mimeType).startsWith('audio/') || !allowedMediaUrl(format.url)) continue;
          const token = randomUUID();
          const expires = Number(new URL(format.url).searchParams.get('expire')) * 1000;
          const ttl = Number(payload.streamingData.expiresInSeconds) * 1000;
          streams.set(token, { url: format.url, expires: Math.min(expires || Infinity, Date.now() + (ttl > 0 ? ttl : 3600000), Date.now() + 3600000) });
          while (streams.size > 256) streams.delete(streams.keys().next().value!);
          format.relayToken = token;
        }
        text = JSON.stringify(payload);
      }
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
      res.end(text);
    } catch {
      if (!res.headersSent && !res.destroyed) reply(502, 'Upstream unavailable');
      else res.destroy();
    } finally { clearTimeout(timer); }
  };
}
export function youtubeRelayPlugin(): Plugin {
  const {createHandler} = createRequire(import.meta.url)('../service/runtime.cjs');
  return { name: 'musicfy-on-device-runtime', configureServer(server) { server.middlewares.use(createHandler()); }, configurePreviewServer(server) { server.middlewares.use(createHandler()); } };
}
