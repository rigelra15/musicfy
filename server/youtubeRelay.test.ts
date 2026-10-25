import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { allowedMediaUrl, createYouTubeRelay } from './youtubeRelay';
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); });
async function start(fetcher: typeof fetch) {
  const handler = createYouTubeRelay(fetcher);
  const server = createServer((req, res) => { void handler(req, res, () => { res.writeHead(404); res.end(); }); });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as {port:number}).port}/api/youtube`;
}
const player = {streamingData: {expiresInSeconds:'3600', adaptiveFormats:[{url:'https://rr1.googlevideo.com/videoplayback', mimeType:'audio/mp4'}]}};
describe('local YouTube relay', () => {
  it('rejects arbitrary destinations', () => {
    for (const value of ['http://rr1.googlevideo.com/x','https://googlevideo.com.evil.test/x','https://user@rr1.googlevideo.com/x','https://127.0.0.1/x','https://rr1.googlevideo.com:999/x']) expect(allowedMediaUrl(value)).toBe(false);
    expect(allowedMediaUrl('https://rr1.googlevideo.com/x')).toBe(true);
  });
  it('rejects foreign origins, invalid bodies and arbitrary URL proxying', async () => {
    const upstream = vi.fn(); const base = await start(upstream);
    expect((await fetch(base+'/sw.js_data', {headers:{Origin:'https://evil.test'}})).status).toBe(403);
    expect((await fetch(base+'/youtubei/v1/search', {method:'POST',body:'{}'})).status).toBe(400);
    expect((await fetch(base+'/youtubei/v1/search', {method:'POST',body:'x'.repeat(33000)})).status).toBe(413);
    expect((await fetch(base+'/media/https://evil.test')).status).toBe(410);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('preserves upstream rate limiting', async () => {
    const base = await start(vi.fn().mockResolvedValue(new Response('{}',{status:429})));
    expect((await fetch(base+'/youtubei/v1/search',{method:'POST',body:JSON.stringify({query:'song'})})).status).toBe(429);
  });
  it('streams a server-issued token with byte ranges and required headers', async () => {
    const upstream = vi.fn().mockResolvedValueOnce(Response.json(player)).mockResolvedValueOnce(new Response('audio',{status:206,headers:{'content-type':'audio/mp4','content-range':'bytes 0-4/100','accept-ranges':'bytes'}}));
    const base = await start(upstream);
    const response = await fetch(base+'/youtubei/v1/player',{method:'POST',body:JSON.stringify({videoId:'test'})});
    const json = await response.json(); const token = json.streamingData.adaptiveFormats[0].relayToken;
    expect(token).toMatch(/^[a-f0-9-]{36}$/);
    const audio = await fetch(base+'/media/'+token,{headers:{Range:'bytes=0-4'}});
    expect(audio.status).toBe(206); expect(audio.headers.get('content-range')).toBe('bytes 0-4/100'); expect(await audio.text()).toBe('audio');
    expect(upstream.mock.calls[1][1].headers).toMatchObject({Range:'bytes=0-4',Origin:'https://www.youtube.com'});
  });
  it('blocks redirected audio outside googlevideo', async () => {
    const upstream = vi.fn().mockResolvedValueOnce(Response.json(player)).mockResolvedValueOnce(new Response(null,{status:302,headers:{Location:'http://127.0.0.1/private'}}));
    const base = await start(upstream);
    const response = await fetch(base+'/youtubei/v1/player',{method:'POST',body:JSON.stringify({videoId:'test'})});
    const json = await response.json();
    expect((await fetch(base+'/media/'+json.streamingData.adaptiveFormats[0].relayToken)).status).toBe(502);
    expect(upstream).toHaveBeenCalledTimes(2);
  });
});
