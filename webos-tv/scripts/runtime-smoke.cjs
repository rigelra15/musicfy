'use strict';
// Runs the actual packaged runtime; only the upstream address is replaced for a simulation.
const http=require('http');
const {startRuntime}=require('../service/runtime.cjs');
const simulation=process.env.MUSICFY_SIMULATION_BASE_URL;
const injected=simulation ? (url,options={})=>new Promise((resolve,reject)=>{
 const source=new URL(url);const target=new URL((source.hostname==='lrclib.net'?'/lrclib':'/youtube-music')+source.pathname+source.search,simulation);
 const req=http.request(target,{method:options.method || 'GET',headers:options.headers},resolve);req.on('error',reject);req.end(options.body);
}) : undefined;
function call(url,body,headers={}){return new Promise((resolve,reject)=>{
 const req=http.request(url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...headers}},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{const body=Buffer.concat(chunks);resolve({status:response.statusCode,text:body.toString(),bytes:body.length});});});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
});}
(async()=>{
 const runtime=await startRuntime({request:injected});
 try {
 const base=runtime.baseUrl+'/api/youtube';
 const search=await call(base+'/youtubei/v1/search',{context:{client:{clientName:'WEB_REMIX',clientVersion:'1.20260707.12.00',hl:'id',gl:'ID'},user:{onBehalfOfUser:null}},query:'Coldplay Yellow',params:'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D'});
 if(search.status!==200 || !JSON.parse(search.text).contents)throw new Error('Search failed: '+search.status);
 const session=await call(base+'/sw.js_data');const payload=JSON.parse(session.text.slice(5).trim());const visitor=payload[0][2].find(value=>typeof value==='string'&&/^Cg[ts]/.test(value));
 const player=await call(base+'/youtubei/v1/player',{context:{client:{clientName:'VISIONOS',clientVersion:'0.1',hl:'id',gl:'ID',visitorData:visitor,deviceMake:'Apple',deviceModel:'RealityDevice14,1',osName:'visionOS',osVersion:'1.3.21O771'},user:{onBehalfOfUser:null}},videoId:'yKNxeF4KMsY',contentCheckOk:true,racyCheckOk:true},{'X-Goog-Visitor-Id':visitor,'X-YouTube-Client-Name':'101','X-YouTube-Client-Version':'0.1'});
 const parsed=JSON.parse(player.text);const format=parsed.streamingData?.adaptiveFormats?.find(value=>value.mimeType?.startsWith('audio/mp4')&&value.relayToken);
 if(!format)throw new Error('Player failed: '+(parsed.playabilityStatus?.status || player.status));
 console.log(JSON.stringify({node:process.version,mode:simulation?'simulation':'live',search:search.status,session:session.status,player:player.status,mediaToken:!!format.relayToken}));
 if(!simulation){
 const audio=await call(base+'/media/'+format.relayToken,undefined,{Range:'bytes=0-65535'});
 if(audio.status!==206 || audio.text.length<1000)throw new Error('Audio failed '+audio.status);
 console.log(JSON.stringify({audio:audio.status,bytes:audio.bytes}));
 }
 } finally {runtime.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
