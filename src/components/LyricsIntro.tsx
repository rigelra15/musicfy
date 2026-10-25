import { useApp } from '../app/AppContext';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { readMediaClock } from '../lyrics/mediaClock';
import { pieceProgress } from '../lyrics/paint';

/** Three timed pieces fill once from the start of the song to its first vocal, like syllables. */
export function LyricsIntro({ positionMs, endMs, audio, playing = false }: { positionMs: number; endMs: number; audio?: HTMLAudioElement | null; playing?: boolean }) {
  const { t } = useApp();
  const root = useRef<HTMLSpanElement>(null);
  const progress = (time: number, index: number) => `${pieceProgress(time, endMs * index / 3, endMs * (index + 1) / 3)}%`;
  useLayoutEffect(() => {
    let frame = 0;
    const dots = Array.from(root.current?.children ?? []) as HTMLElement[];
    const paint = () => {
      const time = readMediaClock(audio, positionMs);
      dots.forEach((dot, index) => dot.style.setProperty('--sung', progress(time, index)));
      if (playing && audio && time < endMs && !document.hidden) frame = requestAnimationFrame(paint);
    };
    const resume = () => { cancelAnimationFrame(frame); paint(); };
    paint();
    document.addEventListener('visibilitychange', resume);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', resume); };
  }, [audio, playing, positionMs, endMs]);
  const time = readMediaClock(audio, positionMs);
  return <span ref={root} class="lyrics-intro" role="img" aria-label={t('lyrics.intro')}>{[0, 1, 2].map((index) => <span key={index} style={{ '--sung': progress(time, index) }} />)}</span>;
}
