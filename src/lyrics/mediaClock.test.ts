import {expect,it} from 'vitest';
import {readMediaClock} from './mediaClock';
it('uses the audio clock between sparse timeupdate events and after a seek to zero',()=>{
 const audio={currentTime:1.234};expect(readMediaClock(audio,1000)).toBe(1234);
 audio.currentTime=0;expect(readMediaClock(audio,1000)).toBe(0);
});
it('holds the actual media position during a pause or buffering instead of extrapolating',()=>{
 const audio={currentTime:12.5};expect(readMediaClock(audio,15000)).toBe(12500);expect(readMediaClock(audio,16000)).toBe(12500);
 expect(readMediaClock(null,2500)).toBe(2500);
});
