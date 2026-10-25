'use strict';
// Native artwork only: never substitute a music video or an artist's unrelated animation.
const INSTANCES = ['eu-central.monochrome.tf','us-west.monochrome.tf','arran.monochrome.tf','api.monochrome.tf'];
const normalized = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\([^)]*(?:official|audio|video|lyrics)[^)]*\)|\[[^\]]*(?:official|audio|video|lyrics)[^\]]*\]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function matches(track, title, artists) {
  return normalized(track.title) === normalized(title) && artists.some(a => normalized(a) === normalized(track.artist));
}
function allowedCanvasUrl(value) {
  try { const u=new URL(value); return u.protocol==='https:' && !u.username && !u.password && (!u.port || u.port==='443') && ((INSTANCES.includes(u.hostname)&&u.pathname==='/search/') || (u.hostname==='resources.tidal.com'&&/^\/videos\/(?:[a-f0-9]+\/){5}1280x1280\.mp4$/i.test(u.pathname))); } catch { return false; }
}
function findTracks(root) {
  if (!root || typeof root!=='object') return [];
  if(root.tracks && Array.isArray(root.tracks.items)) return root.tracks.items;
  for(const v of Object.values(root)) { const found=findTracks(v); if(found.length)return found; }
  return [];
}
function createCanvas({http,apple,now=Date.now}) {
  const cache=new Map();
  return async function lookup(track,signal) {
    const key=JSON.stringify([normalized(track.title),normalized(track.artist)]);
    const saved=cache.get(key); if(saved && saved.until>now())return saved.result;
    let result={result:'notFound'};
    for(const host of INSTANCES){
      if(signal?.aborted)break;
      try{
        const response=await http('https://'+host+'/search/?s='+encodeURIComponent(track.artist+' - '+track.title),{signal});
        if(response.status!==200)continue;
        for(const song of findTracks(JSON.parse(String(response.body)))){
          const artists=(song.artists||[]).map(a=>a.name);
          const id=song.album?.videoCover;
          if(matches(track,song.title,artists) && typeof id==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)){
            result={result:'found',url:'https://resources.tidal.com/videos/'+id.replace(/-/g,'/')+'/1280x1280.mp4',provider:'monochrome'};break;
          }
        }
        if(result.result==='found')break;
      }catch{}
    }
    if(result.result!=='found'&&!signal?.aborted&&apple){try{result=await apple(track,signal)||result;}catch{}}
    if(!signal?.aborted){if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(key,{result,until:now()+(result.result==='found'?86400000:600000)});}
    return result;
  };
}
module.exports={createCanvas,allowedCanvasUrl,matches};
