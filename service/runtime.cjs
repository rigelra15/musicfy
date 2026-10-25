'use strict';
// Shared by the packaged Node16 webOS service and desktop Vite adapter.
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { pipeline } = require('stream');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const API = 'https://music.youtube.com';
const redirects = new Set([301,302,303,307,308]);
function allowedMediaUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname.endsWith('.googlevideo.com') && !u.username && !u.password && (!u.port || u.port === '443'); } catch { return false; }
}
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: options.method || 'GET', headers: {'Accept-Encoding':'identity', ...options.headers} }, response => {
      response.on('error', () => {});
      resolve(response);
    });
    req.setTimeout(20000, () => req.destroy(new Error('Upstream timeout')));
    req.on('error', reject);
    if (options.signal) {
      const abort = () => req.destroy(new Error('Request cancelled'));
      if (options.signal.aborted) {abort();return;}
      options.signal.addEventListener('abort', abort, {once:true});
      req.on('close', () => options.signal.removeEventListener('abort', abort));
    }
    req.end(options.body);
  });
}
async function readBody(stream, limit) {
  let size=0; const chunks=[];
  const timer=setTimeout(()=>stream.destroy(new Error('Body timeout')),20000);
  try { for await (const chunk of stream) {
    size+=chunk.length; if (size>limit) {const error=new Error('Body too large'); error.status=413; throw error;} chunks.push(chunk);
  } return Buffer.concat(chunks).toString('utf8'); } finally { clearTimeout(timer); }
}
const {createTransferManager}=require('./transfer.cjs');
const {createScrobbler,loadKeys,allowedScrobbleUrl}=require('./scrobble.cjs');
const {createSources,createFileStorage,createMemoryStorage,allowedSourceUrl,allowedMediaUrl:allowedSourceMedia}=require('./sources.cjs');
const fs=require('fs');const nodePath=require('path');const os=require('os');
/** Where credentials live: the service's own folder on the TV's internal storage (webOS), a temp folder in development. */
function dataDirectory(){return process.env.MUSICFY_DATA_DIR||(fs.existsSync('/media/internal')?'/media/internal/musicfy-service':nodePath.join(os.tmpdir(),'musicfy-dev'));}
/** Whole body as bytes (the FLAC header is binary), optionally only the first `maxBytes`. */
async function readBuffer(stream,limit,maxBytes){
  let size=0;const chunks=[];
  const timer=setTimeout(()=>stream.destroy(new Error('Body timeout')),20000);
  try{for await(const chunk of stream){size+=chunk.length;chunks.push(chunk);if(maxBytes&&size>=maxBytes){stream.destroy();break;}if(size>limit){const e=new Error('Body too large');e.status=413;throw e;}}return Buffer.concat(chunks).subarray(0,maxBytes||undefined);}
  catch(error){if(maxBytes&&size>=maxBytes)return Buffer.concat(chunks).subarray(0,maxBytes);throw error;}
  finally{clearTimeout(timer);}
}
function createHandler(options = {}) {
  const fetchStream = options.request || request;
  const sourceStorage = options.sourceStorage || (options.sourceDir===false?createMemoryStorage():createFileStorage(fs,nodePath,nodePath.join(options.sourceDir||dataDirectory(),'sources.json')));
  const sourceHttp = async (url,init)=>{
    for(let hop=0;hop<4;hop++){
      if(!allowedSourceUrl(url)&&!allowedSourceMedia(url))throw new Error('Source destination refused');
      const response=await fetchStream(url,{method:init.method,headers:init.headers,body:init.body,signal:init.signal});
      if(redirects.has(response.statusCode)){const location=response.headers.location;response.destroy();if(!location||hop===3)throw new Error('Source redirect refused');url=new URL(location,url).href;continue;}
      return {status:response.statusCode,body:await readBuffer(response,4*1024*1024,init.maxBytes)};
    }
  };
  const sources = options.sources || createSources({http:sourceHttp,storage:sourceStorage});
  const scrobbleDir = options.sourceDir||dataDirectory();
  const scrobbleHttp = async (url,init)=>{
    if(!allowedScrobbleUrl(url))throw new Error('Scrobble destination refused');
    const response=await fetchStream(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'Musicfy'},body:init.body});
    if(redirects.has(response.statusCode)){response.destroy();throw new Error('Scrobble redirect refused');}
    return {status:response.statusCode,body:await readBody(response,1024*1024)};
  };
  const scrobbler = options.scrobbler || createScrobbler({
    http:scrobbleHttp,
    storage:options.sourceDir===false?createMemoryStorage():createFileStorage(fs,nodePath,nodePath.join(scrobbleDir,'scrobble.json')),
    keys:options.scrobbleKeys || loadKeys(process.env,()=>fs.readFileSync(nodePath.join(scrobbleDir,'scrobble-keys.json'),'utf8')),
  });
  const transfer = options.transfer || createTransferManager({...options.transferOptions,onSession:(kind,text)=>{
    if(kind!=='applemusic-session')return false;
    let session;try{session=JSON.parse(text);}catch(error){return false;}
    try{sources.setSession('applemusic',session);return true;}catch(error){return false;}
  }});
  const streams = new Map();
  const sessionPrefix = options.sessionToken ? '/s/'+options.sessionToken : '';
  const handler = async function handler(req,res,next = () => {res.writeHead(404);res.end();}) {
    const rawPath=(req.url || '').split('?')[0];
    if (options.sessionToken && !rawPath.startsWith(sessionPrefix+'/')) {res.writeHead(403);res.end();return;}
    const path=rawPath.slice(sessionPrefix.length);
    if (!path.startsWith('/api/')) return next();
    const reply=(status,error,code)=>{if(!res.headersSent&&!res.destroyed){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(code?{error,code}:{error}));}};
    const origin=req.headers.origin;
    if (origin && origin!=='null' && origin!==`http://${req.headers.host}` && origin!==`https://${req.headers.host}`) return reply(403,'Origin rejected');
    if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
    if(req.method==='OPTIONS'){
      res.setHeader('Access-Control-Allow-Methods','GET, HEAD, POST');
      res.setHeader('Access-Control-Allow-Headers','Content-Type, Range, X-Goog-Api-Format-Version, X-Goog-Visitor-Id, X-YouTube-Client-Name, X-YouTube-Client-Version, X-Origin');
      res.writeHead(204);res.end();return;
    }
    const controller=new AbortController();
    res.on('close',()=>controller.abort());
    try {
      if(path.startsWith('/api/youtube/media/')){
        if(!['GET','HEAD'].includes(req.method))return reply(405,'Method not allowed');
        const token=path.slice('/api/youtube/media/'.length); const entry=streams.get(token);
        if(!entry || entry.expires<=Date.now()){streams.delete(token);return reply(410,'Stream expired');}
        const range=req.headers.range;
        if(range&&!/^bytes=(?:\d+-\d*|-\d+)$/.test(range))return reply(416,'Invalid range');
        let url=entry.url; let upstream;
        for(let hop=0;hop<4;hop++){
          if(!allowedMediaUrl(url))return reply(502,'Invalid media destination');
          upstream=await fetchStream(url,{method:req.method,signal:controller.signal,headers:{'User-Agent':UA,Origin:'https://www.youtube.com',Referer:'https://www.youtube.com/',...(range?{Range:range}:{})}});
          if(!redirects.has(upstream.statusCode))break;
          const location=upstream.headers.location;upstream.destroy();
          if(!location || hop===3)return reply(502,'Invalid media redirect');
          url=new URL(location,url).href;
        }
        for(const key of ['content-type','content-length','content-range','accept-ranges'])if(upstream.headers[key])res.setHeader(key,upstream.headers[key]);
        res.statusCode=upstream.statusCode;
        if(req.method==='HEAD'){upstream.destroy();res.end();return;}
        pipeline(upstream,res,()=>{}); return;
      }
      if(path.startsWith('/api/lyrics/')){
        if(req.method!=='POST')return reply(405,'Method not allowed');
        let track;try{track=JSON.parse(await readBody(req,32768));}catch(error){return reply(error.status || 400,'Invalid request');}
        if(!track || typeof track.title!=='string' || !track.title.trim() || track.title.length>500 || typeof track.artist!=='string' || track.artist.length>500 || typeof track.id!=='string' || track.id.length>200 || !Number.isFinite(track.durationMs) || track.durationMs<0)return reply(400,'Invalid track');
        const {lookupLyrics,allowedLyricsUrl}=options.lyrics || require('./lyrics.cjs');
        let count=0;
        const lyricsRequest=async (url,init={})=>{
          if(++count>16)throw new Error('Provider request limit');
          for(let hop=0;hop<4;hop++){
            if(!allowedLyricsUrl(url))throw new Error('Invalid lyrics destination');
            const response=await fetchStream(url,{...init,signal:controller.signal,headers:{'User-Agent':UA,...init.headers}});
            if(redirects.has(response.statusCode)){
              const location=response.headers.location;response.destroy();
              if(!location || hop===3)throw new Error('Invalid lyrics redirect');
              url=new URL(location,url).href;continue;
            }
            return {status:response.statusCode,body:await readBody(response,4*1024*1024)};
          }
        };
        const document=await lookupLyrics(decodeURIComponent(path.slice('/api/lyrics/'.length)),track,lyricsRequest);
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(document));return;
      }
      if(path.startsWith('/api/sources/')||path==='/api/sources'){
        const action=path.slice('/api/sources/'.length);
        const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
        try{
          if((action===''||action==='status')&&req.method==='GET'){send(200,sources.status());return;}
          if(req.method!=='POST'||!['resolve','diagnose','verify','signout'].includes(action))return reply(action==='status'?405:404,'Unknown route');
          let input;try{input=JSON.parse(await readBody(req,16384));}catch(error){return reply(error.status||400,'Invalid request');}
          if(!input||typeof input.provider!=='string')return reply(400,'Provider required');
          if(action==='resolve'){send(200,await sources.resolve(input.provider,input.track,input.picks));return;}
          if(action==='diagnose'){send(200,await sources.diagnose(input.provider,input.track,input.picks));return;}
          if(action==='verify'){send(200,await sources.verify(input.provider));return;}
          send(200,sources.signOut(input.provider));return;
        }catch(error){
          if(error&&error.name==='SourceError')return reply(error.status||400,error.message);
          throw error;
        }
      }
      if(path.startsWith('/api/source/')){
        const [kind,token]=path.slice('/api/source/'.length).split('/');
        if(!token||!/^[a-f0-9]{8,64}$|^tok\d+$/.test(token))return reply(404,'Unknown route');
        if(kind==='manifest'){
          const entry=sources.entry(token);if(!entry||entry.kind!=='manifest')return reply(410,'Expired');
          if(!['GET','HEAD'].includes(req.method))return reply(405,'Method not allowed');
          res.writeHead(200,{'Content-Type':'application/vnd.apple.mpegurl','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:entry.body);return;
        }
        if(kind==='license'){
          if(req.method!=='POST')return reply(405,'Method not allowed');
          const chunks=[];let size=0;
          for await(const chunk of req){size+=chunk.length;if(size>65536)return reply(413,'Body too large');chunks.push(chunk);}
          try{const license=await sources.license(token,Buffer.concat(chunks));res.writeHead(200,{'Content-Type':'application/octet-stream','Cache-Control':'no-store'});res.end(license);return;}
          catch(error){
            if(error&&error.name==='SourceError'){res.writeHead(error.status||502,{'Content-Type':'application/json','Cache-Control':'no-store','X-Source-Error':error.kind});res.end(JSON.stringify({error:error.message,kind:error.kind}));return;}
            throw error;
          }
        }
        if(kind==='media'){
          if(!['GET','HEAD'].includes(req.method))return reply(405,'Method not allowed');
          const entry=sources.entry(token);if(!entry||entry.kind!=='media')return reply(410,'Stream expired');
          const range=req.headers.range;
          if(range&&!/^bytes=(?:\d+-\d*|-\d+)$/.test(range))return reply(416,'Invalid range');
          let url=entry.url;let upstream;
          for(let hop=0;hop<4;hop++){
            if(!allowedSourceMedia(url))return reply(502,'Invalid media destination');
            upstream=await fetchStream(url,{method:req.method,signal:controller.signal,headers:{...entry.headers,...(range?{Range:range}:{})}});
            if(!redirects.has(upstream.statusCode))break;
            const location=upstream.headers.location;upstream.destroy();
            if(!location||hop===3)return reply(502,'Invalid media redirect');
            url=new URL(location,url).href;
          }
          for(const key of ['content-type','content-length','content-range','accept-ranges'])if(upstream.headers[key])res.setHeader(key,upstream.headers[key]);
          res.statusCode=upstream.statusCode;
          if(req.method==='HEAD'){upstream.destroy();res.end();return;}
          pipeline(upstream,res,()=>{});return;
        }
        return reply(404,'Unknown route');
      }
      if(path.startsWith('/api/transfer/')){
        const action=path.slice('/api/transfer/'.length);
        const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
        try{
          if(action==='status'&&req.method==='GET'){send(200,transfer.status());return;}
          if(action==='payload'&&req.method==='GET'){send(200,transfer.takePayload());return;}
          if(action==='start'&&req.method==='POST'){
            let input={};try{const raw=await readBody(req,1024);input=raw?JSON.parse(raw):{};}catch(error){return reply(error.status || 400,'Invalid request');}
            send(200,await transfer.start({deviceName:input&&typeof input.deviceName==='string'?input.deviceName:undefined}));return;
          }
          if(action==='cancel'&&req.method==='POST'){transfer.cancel('Dibatalkan di TV.','cancelled');send(200,transfer.status());return;}
          return reply(action==='status'||action==='payload'||action==='start'||action==='cancel'?405:404,'Unknown route');
        }catch(error){
          if(error&&error.name==='TransferError')return reply(error.status || 500,error.message,error.code);
          throw error;
        }
      }
      if(path==='/api/translate'){
        if(req.method!=='POST')return reply(405,'Method not allowed');
        let input;try{input=JSON.parse(await readBody(req,65536));}catch(error){return reply(error.status || 400,'Invalid request');}
        const {translateLines,allowedTranslateUrl,TranslateError}=options.translate || require('./translate.cjs');
        let count=0;
        const translateRequest=async (url)=>{
          if(++count>200 || !allowedTranslateUrl(url))throw new Error('Translation request refused');
          const response=await fetchStream(url,{signal:controller.signal,headers:{'User-Agent':UA}});
          if(redirects.has(response.statusCode)){response.destroy();throw new Error('Translation redirect rejected');}
          return {status:response.statusCode,body:await readBody(response,1024*1024)};
        };
        try{
          const result=await translateLines(input,translateRequest);
          res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));return;
        }catch(error){
          if(error && error.name==='TranslateError'){res.writeHead(error.status || 502,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:error.message}));return;}
          throw error;
        }
      }
      if(path.startsWith('/api/scrobble/')){
        const action=path.slice('/api/scrobble/'.length);
        const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
        const GET=new Set(['status']);const POST=new Set(['begin','finish','signout','enable','nowplaying','scrobble','love','flush']);
        if(!GET.has(action)&&!POST.has(action))return reply(404,'Unknown route');
        if(req.method!==(GET.has(action)?'GET':'POST'))return reply(405,'Method not allowed');
        let input={};
        if(POST.has(action)){try{const raw=await readBody(req,16384);input=raw?JSON.parse(raw):{};}catch(error){return reply(error.status || 400,'Invalid request');}if(!input||typeof input!=='object')return reply(400,'Invalid request');}
        try{
          if(action==='status'){send(200,scrobbler.status());return;}
          if(action==='begin'){send(200,await scrobbler.begin(input.site));return;}
          if(action==='finish'){send(200,await scrobbler.finish(input.site));return;}
          if(action==='signout'){scrobbler.signOut(input.site);send(200,scrobbler.status());return;}
          if(action==='enable'){scrobbler.setEnabled(input.site,input.enabled===true);send(200,scrobbler.status());return;}
          if(action==='nowplaying'){await scrobbler.nowPlaying(input.track);send(200,{ok:true});return;}
          if(action==='scrobble'){send(200,scrobbler.scrobble(input.track,input.startedAt));return;}
          if(action==='love'){await scrobbler.love(input.artist,input.track,input.love===true);send(200,{ok:true});return;}
          if(action==='flush'){await scrobbler.flush();send(200,scrobbler.status());return;}
        }catch(error){
          if(error&&error.name==='ScrobbleError'){send(error.status || 502,{error:error.message,kind:error.kind});return;}
          throw error;
        }
      }
      if(path==='/api/import/link'){
        if(req.method!=='POST')return reply(405,'Method not allowed');
        let input;try{input=JSON.parse(await readBody(req,4096));}catch(error){return reply(error.status || 400,'Invalid request');}
        if(!input||typeof input.link!=='string'||input.link.length>2000)return reply(400,'Invalid request');
        const links=options.links || require('./links.cjs');
        let count=0;
        const linkRequest=async (url,opts)=>{
          if(++count>120)throw new Error('Too many link requests');
          const response=await fetchStream(url,{signal:controller.signal,headers:{'User-Agent':UA,'Accept-Language':'en-US,en;q=0.8'}});
          if(redirects.has(response.statusCode)){
            response.destroy();
            if(opts&&opts.manual)return {status:response.statusCode,location:response.headers.location,body:''};
            // Share pages answer with a redirect to their canonical page (same allowlist applies to the next hop).
            const next=new URL(response.headers.location||'',url).href;
            if(!links.allowedLinkUrl(next))throw new Error('Link redirect rejected');
            const again=await fetchStream(next,{signal:controller.signal,headers:{'User-Agent':UA}});
            if(redirects.has(again.statusCode)){again.destroy();throw new Error('Link redirect rejected');}
            return {status:again.statusCode,body:await readBody(again,6*1024*1024)};
          }
          return {status:response.statusCode,body:await readBody(response,6*1024*1024)};
        };
        try{
          const result=await links.fetchLink(input.link,linkRequest);
          res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));return;
        }catch(error){
          if(error&&error.name==='LinkError'){res.writeHead(error.status || 502,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:error.message,kind:error.kind}));return;}
          throw error;
        }
      }
      if(path.startsWith('/api/catalog/')){
        if(req.method!=='POST')return reply(405,'Method not allowed');
        let params;try{const raw=await readBody(req,32768);params=raw?JSON.parse(raw):{};}catch(error){return reply(error.status || 400,'Invalid request');}
        const {runCatalog}=options.catalog || require('./catalog.cjs');
        try{
          const page=await runCatalog(decodeURIComponent(path.slice('/api/catalog/'.length)),params,async (upstreamPath,body)=>{
            const upstream=await fetchStream(API+upstreamPath+'?prettyPrint=false',{method:'POST',signal:controller.signal,body:JSON.stringify(body),headers:{'Content-Type':'application/json','User-Agent':UA,Origin:API,Referer:API+'/','X-Goog-Api-Format-Version':'1','X-YouTube-Client-Name':'67','X-YouTube-Client-Version':'1.20260707.12.00'}});
            if(redirects.has(upstream.statusCode)){upstream.destroy();return {status:502,body:''};}
            return {status:upstream.statusCode,body:await readBody(upstream,4*1024*1024)};
          });
          res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(page));return;
        }catch(error){
          if(error && error.name==='CatalogError'){res.writeHead(error.status || 502,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:error.message,kind:error.kind}));return;}
          throw error;
        }
      }
      const route=path.slice('/api/youtube'.length);
      const isSession=route==='/sw.js_data'; const isPlayer=route==='/youtubei/v1/player';
      if(!path.startsWith('/api/youtube/')||(!isSession&&!isPlayer&&route!=='/youtubei/v1/search'))return reply(404,'Unknown route');
      if(req.method!==(isSession?'GET':'POST'))return reply(405,'Method not allowed');
      let body;
      if(!isSession){
        body=await readBody(req,32768);
        let payload;try{payload=JSON.parse(body);}catch{return reply(400,'Invalid JSON');}
        const value=isPlayer?payload?.videoId:payload?.query;
        if(typeof value!=='string'||!value.trim()||value.length>200)return reply(400,'Invalid request');
      }
      const headers={'Content-Type':'application/json','User-Agent':UA,Origin:API,Referer:API+'/'};
      for(const key of ['x-goog-visitor-id','x-goog-api-format-version','x-youtube-client-name','x-youtube-client-version'])if(typeof req.headers[key]==='string')headers[key]=req.headers[key];
      const upstream=await fetchStream(API+route+(isSession?'':'?prettyPrint=false'),{method:req.method,headers,body,signal:controller.signal});
      if(redirects.has(upstream.statusCode)){upstream.destroy();return reply(502,'API redirect rejected');}
      let text=await readBody(upstream,4*1024*1024);
      if(isPlayer && upstream.statusCode===200){
        const payload=JSON.parse(text);
        for(const [key,value] of streams)if(value.expires<=Date.now())streams.delete(key);
        for(const format of payload.streamingData?.adaptiveFormats || []){
          if(!String(format.mimeType).startsWith('audio/')||!allowedMediaUrl(format.url))continue;
          const token=crypto.randomUUID(); const exp=Number(new URL(format.url).searchParams.get('expire'))*1000;const ttl=Number(payload.streamingData.expiresInSeconds)*1000;
          const expires=Math.min(Number.isFinite(exp)&&exp>0?exp:Infinity,Date.now()+(ttl>0?ttl:3600000),Date.now()+3600000);
          if(expires<=Date.now())continue;
          streams.set(token,{url:format.url,expires});while(streams.size>256)streams.delete(streams.keys().next().value);
          format.relayToken=token;
        }
        text=JSON.stringify(payload);
      }
      res.writeHead(upstream.statusCode,{'Content-Type':upstream.headers['content-type'] || 'application/json','Cache-Control':'no-store'});res.end(text);
    }catch(error){reply(error.status || 502,'Upstream unavailable');}
  };
  handler.dispose = () => transfer.dispose();
  handler.sources = sources;
  return handler;
}
async function startRuntime(options = {}) {
  const sessionToken=crypto.randomBytes(24).toString('hex');
  const handler=createHandler({...options,sessionToken});
  const server=http.createServer(handler);
  server.requestTimeout=25000;server.headersTimeout=10000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const sockets=new Set(); server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  const close=()=>{handler.dispose();for(const socket of sockets)socket.destroy();server.close();};
  const origin='http://127.0.0.1:'+server.address().port;
  return {server,origin,baseUrl:origin+'/s/'+sessionToken,close};
}
module.exports={createHandler,startRuntime,request,allowedMediaUrl};
