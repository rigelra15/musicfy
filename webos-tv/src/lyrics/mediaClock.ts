export function readMediaClock(audio:Pick<HTMLMediaElement,'currentTime'>|null|undefined,fallbackMs:number):number{
 return audio&&Number.isFinite(audio.currentTime)?Math.max(0,audio.currentTime*1000):Math.max(0,fallbackMs);
}
