import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../../app/AppContext';
import { useSnapshot } from '../../app/useSnapshot';
import { readMediaClock } from '../../lyrics/mediaClock';
import { currentLineIndex } from '../../lyrics/paint';
import { timingDetail } from '../../lyrics/selection';
import type { TimedLyricsLine } from '../../lyrics/types';
import { currentTrack } from '../../playback/queueModel';

export interface SungLine {
  /** The lyrics of this song have been looked up (found or not). */
  loaded: boolean;
  /** The song has synchronised lyrics, so there is a line to show. */
  synced: boolean;
  /** Index of the line being sung, or -1 before the first. */
  index: number;
  text: string;
  line?: TimedLyricsLine;
  /** How finely the chosen source times its lines: `line`, `word` or `syllable` (the same pick the lyrics page makes). */
  detail: string;
  /** Where the song is, in ms, moved on every frame while it plays, so words and syllables fill as they are sung. */
  time: number;
  introEndMs?: number;
  motion: string;
}

/** The line being sung right now, for views that show it outside the lyrics page, timed by the chosen lyrics source. */
export function useSungLine(): SungLine {
  const { store, lyrics, audio } = useApp();
  const state = useSnapshot(lyrics);
  const track = currentTrack(store.root.queue);
  const document = track && state.snapshot.trackId === track.id ? state.snapshot.document : null;
  const playing = store.root.playback.status === 'playing';
  const reported = store.root.playback.positionMs;
  const [, frame] = useState(0);
  // While it plays, the clock is read on every frame (as the lyrics page does) so the highlight sweeps smoothly.
  useEffect(() => {
    if (!playing || document?.type !== 'synced') return;
    let id = 0;
    const tick = () => { frame((n) => (n + 1) % 1_000_000); if (!globalThis.document?.hidden) id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, document]);
  if (document?.type !== 'synced') return { loaded: document !== null, synced: false, index: -1, text: '', detail: 'line', time: reported, motion: lyrics.motion };
  const time = readMediaClock(audio, reported);
  const index = currentLineIndex(document.lines, time);
  const line = index >= 0 ? document.lines[index] : undefined;
  return { loaded: true, synced: true, index, text: line?.text ?? '', line, detail: timingDetail(document, lyrics.detail), time, introEndMs: document.lines[0]?.timeMs, motion: lyrics.motion };
}
