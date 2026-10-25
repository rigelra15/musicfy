import { afterEach, expect, it } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let servers: Server[] = [];
afterEach(async()=> { await Promise.all(servers.splice(0).map(s=>new Promise<void>(resolve=>{s.closeAllConnections();s.close(()=>resolve());}))); });
it('packages a Node16 runtime which serves authorized ranged audio and shuts down', async () => {
  const { startRuntime } = require('../service/runtime.cjs');
  const upstream = createServer((req,res)=> {
    if(req.url==='/youtubei/v1/player?prettyPrint=false') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({streamingData:{expiresInSeconds:'3600',adaptiveFormats:[{url:'https://rr1.googlevideo.com/audio',mimeType:'audio/mp4'}]}}));}
    else { expect(req.headers.range).toBe('bytes=0-4');res.writeHead(206,{'Content-Type':'audio/mp4','Content-Range':'bytes 0-4/100'});res.end('audio'); }
  });
  servers.push(upstream); await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const requester=(url:string,options:any)=>new Promise((resolve,reject)=> {const target=new URL(url); const req=httpRequest({hostname:'127.0.0.1',port:(upstream.address() as any).port,path:target.pathname+target.search,method:options.method,headers:options.headers},resolve);req.on('error',reject);req.end(options.body);});
  const runtime=await startRuntime({request:requester}); servers.push(runtime.server);
  expect(new URL(runtime.baseUrl).hostname).toBe('127.0.0.1');
  expect((await fetch(runtime.origin+'/api/youtube/sw.js_data')).status).toBe(403);
  expect((await fetch(runtime.baseUrl+'/api/youtube/sw.js_data',{headers:{Origin:'https://evil.test'}})).status).toBe(403);
  const player=await (await fetch(runtime.baseUrl+'/api/youtube/youtubei/v1/player',{method:'POST',body:JSON.stringify({videoId:'abc'})})).json();
  const token=player.streamingData.adaptiveFormats[0].relayToken;
  const audio=await fetch(runtime.baseUrl+'/api/youtube/media/'+token,{headers:{Range:'bytes=0-4'}});
  expect(audio.status).toBe(206);expect(audio.headers.get('content-range')).toBe('bytes 0-4/100');expect(await audio.text()).toBe('audio');
  expect((await fetch(runtime.baseUrl+'/api/youtube/media/missing')).status).toBe(410);
});
it('rejects malicious redirect destinations and enforces request limits', async()=>{
  const {startRuntime}=require('../service/runtime.cjs');
  let calls=0;
  const upstream=createServer((req,res)=>{calls++;res.writeHead(302,{Location:'http://127.0.0.1/private'});res.end();});
  servers.push(upstream);await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const requester=()=>new Promise(resolve=>{httpRequest({hostname:'127.0.0.1',port:(upstream.address() as any).port},resolve).end();});
  const runtime=await startRuntime({request:requester});servers.push(runtime.server);
  expect((await fetch(runtime.baseUrl+'/api/youtube/sw.js_data')).status).toBe(502);expect(calls).toBe(1);
  expect((await fetch(runtime.baseUrl+'/api/youtube/youtubei/v1/search',{method:'POST',body:'x'.repeat(33000)})).status).toBe(413);
});
