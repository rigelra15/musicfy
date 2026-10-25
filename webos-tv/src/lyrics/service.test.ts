import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const service = () => require('../../service/lyrics.cjs');
const track = { id: 'abcdefghijk', title: 'Fixture Song', artist: 'Fixture Artist', durationMs: 180000 };

describe('mobile lyrics contracts', () => {
  it('preserves actual TTML syllables, words, voices and background timing', () => {
    const doc = service().parseTtml('<tt><body><div><p begin="1s" end="4s" ttm:agent="v2"><span begin="1s" end="1.3s">Fix</span><span begin="1.3s" end="2s">ture</span> <span begin="2s" end="3s">text</span><span ttm:role="x-bg" begin="3s" end="4s"><span begin="3s" end="4s">echo</span></span></p></div></body></tt>', 'BetterLyrics');
    expect(doc.type).toBe('synced');
    expect(doc.lines[0]).toMatchObject({ timeMs: 1000, text: 'Fixture text', agent: 'v2' });
    expect(doc.lines[0].words).toEqual([{ text: 'Fixture', startMs: 1000, endMs: 2000 }, { text: 'text', startMs: 2000, endMs: 3000 }]);
    expect(doc.lines[0].syllables).toHaveLength(3);
    expect(doc.lines[1]).toMatchObject({ timeMs: 3000, text: 'echo', isBackground: true });
  });
  it('preserves rich LRC and explicit word end timestamps without inventing syllables', () => {
    const doc = service().parseLrc('[00:01.000]{agent:v1}Fixture text\n<Fixture:1:2|text:2:3>\n[00:04.000]{bg}echo', 'Paxsenix');
    expect(doc.lines[0].words).toHaveLength(2);
    expect(doc.lines[0].words[1].endMs).toBe(3000);
    expect(doc.lines[0].syllables).toBeUndefined();
    expect(doc.lines[1].isBackground).toBe(true);
  });
  it('uses actual NetEase YRC milliseconds and drops service credits', async () => {
    const request = async (url: string) => ({ status: 200, body: JSON.stringify(url.includes('/search/')
      ? { result: { songs: [{ id: 5, name: track.title, artists: [{ name: track.artist }], duration: 180000 }] } }
      : { yrc: { lyric: '[1000,3000](1000,500,0)Fixture (1500,500,0)text' } }) });
    const doc = await service().lookupLyrics('NetEase', track, request);
    expect(doc.lines[0].words[1]).toMatchObject({ text: 'text', startMs: 1500, endMs: 2000 });
  });
  it('filters SimpMusic recordings by duration and prefers rich sync', async () => {
    const request = async () => ({ status: 200, body: JSON.stringify({ type: 'success', data: [
      { durationSeconds: 240, richSyncLyrics: '[00:01.00]Wrong recording' },
      { durationSeconds: 180, richSyncLyrics: '[00:01.00]<00:01.00>Fixture <00:02.00>text', plainLyric: 'Fixture text' },
    ] }) });
    const doc = await service().lookupLyrics('SimpMusic', track, request);
    expect(doc.lines[0].text).toBe('Fixture text');
    expect(doc.lines[0].words).toHaveLength(2);
  });
  it('rejects dynamic subtitle URLs outside YouTube timedtext', () => {
    const allowed = service().allowedLyricsUrl;
    expect(allowed('https://www.youtube.com/api/timedtext?v=abcdefghijk')).toBe(true);
    for (const url of ['http://www.youtube.com/api/timedtext', 'https://youtube.com.attacker.test/api/timedtext', 'https://127.0.0.1/api/timedtext', 'https://www.youtube.com/redirect', 'https://user:pass@www.youtube.com/api/timedtext']) expect(allowed(url)).toBe(false);
  });
  it('registers all mobile sources and reports an unavailable source honestly', async () => {
    expect(service().providerDefinitions).toHaveLength(12);
    await expect(service().lookupLyrics('BetterLyrics', track, async () => ({ status: 503, body: '' }))).rejects.toThrow(/503/);
    await expect(service().lookupLyrics('unknown', track, async () => ({ status: 200, body: '{}' }))).rejects.toThrow(/Unknown/);
  });
});

it('tries the SimpMusic fallback when the primary answers 404', async () => {
  const calls:string[]=[];
  const doc=await service().lookupLyrics('SimpMusic',track,async(url:string)=>{
    calls.push(url);
    return url.includes('api-lyrics.simpmusic.org')?{status:404,body:''}:{status:200,body:JSON.stringify({type:'success',data:[{durationSeconds:180,syncedLyrics:'[00:01.00]Fixture text'}]})};
  });
  expect(calls).toHaveLength(2);expect(doc.type).toBe('synced');
});

it('keeps Paxsenix supplied word spaces while preserving real syllables', async () => {
  const doc=await service().lookupLyrics('Paxsenix',track,async(url:string)=>({status:200,body:JSON.stringify(url.includes('/search')?[{id:'match',trackName:track.title,artistName:track.artist,duration:180000}]:{type:'Syllable',content:[{timestamp:1000,text:[{text:'wa',timestamp:1000,endtime:1200},{text:'nt ',timestamp:1200,endtime:1500},{text:'you',timestamp:1500,endtime:2000}]}]})}));
  expect(doc.lines[0].text).toBe('want you');expect(doc.lines[0].words).toHaveLength(2);expect(doc.lines[0].syllables).toHaveLength(3);
});

it('ignores TTML formatting newlines between timed syllables as mobile does', () => {
 const doc=service().parseTtml('<tt><body><p begin="1s"><span begin="1s" end="1.2s">Fix</span>\n<span begin="1.2s" end="2s">ture</span> <span begin="2s" end="3s">text</span></p></body></tt>','BetterLyrics');
 expect(doc.lines[0].text).toBe('Fixture text');expect(doc.lines[0].words).toHaveLength(2);expect(doc.lines[0].syllables).toHaveLength(3);
});

it('keeps TTML lines and words before the first minute using bare seconds', () => {
 const doc=service().parseTtml('<tt><body><p begin="33.522" end="35.789"><span begin="33.522" end="34.2">Fixture</span> <span begin="34.2" end="35.789">text</span></p><p begin="1:01.562" end="1:03.000">Later</p></body></tt>','BetterLyrics');
 expect(doc.lines).toHaveLength(2);
 expect(doc.lines[0]).toMatchObject({timeMs:33522,text:'Fixture text',words:[{text:'Fixture',startMs:33522,endMs:34200},{text:'text',startMs:34200,endMs:35789}]});
 expect(doc.lines[1].timeMs).toBe(61562);
});
