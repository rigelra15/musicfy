import { createPortal, memo } from 'preact/compat';
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { motionAllowed } from '../app/motion';
import { useApp } from '../app/AppContext';
import { useSnapshot } from '../app/useSnapshot';
import { readingOf, readingScript } from '../lyrics/readings';
import { readMediaClock } from '../lyrics/mediaClock';
import { activeIndex, groupFinished, lineGroups, linesToPaint, pieceProgress } from '../lyrics/paint';
import { USER_EDITED, timingDetail } from '../lyrics/selection';
import { textLines } from '../lyrics/edit';
import { PREF_LYRICS_DETAIL, PREF_LYRICS_MOTION } from '../library/migrations';
import { type RequestLyrics, type TimedLyricsLine, type TimedPiece } from '../lyrics/types';
import { runtimeFetch } from '../platform/runtime';
import type { Track } from '../model';
import { LyricsIntro } from './LyricsIntro';
import './LyricsView.css';
import { tr } from '../app/i18n';

export const requestServiceLyrics: RequestLyrics = async (source, track) => {
  const response = await runtimeFetch('/api/lyrics/' + encodeURIComponent(source), { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(track) });
  if (!response.ok) throw new Error(response.status === 429 ? tr('err.lyrics.limited') : tr('err.lyrics.unreachable'));
  const document = await response.json();
  if (!document || !['synced', 'plain', 'missing'].includes(document.type) || document.type === 'synced' && !Array.isArray(document.lines)) throw new Error(tr('err.lyrics.format'));
  return document;
};

/** Words and syllables of a line, each carrying its own start/end so a frame can fill them without re-rendering. */
export function TimedLine({ line, positionMs, detail }: { line: TimedLyricsLine; positionMs: number; detail: string }) {
  const pieces = detail === 'syllable' ? line.syllables || line.words : detail === 'word' ? line.words : undefined;
  if (!pieces?.length) return <>{line.text}</>;
  const result = [];
  let cursor = 0;
  for (let i = 0; i < pieces.length; i += 1) {
    const piece: TimedPiece = pieces[i];
    const at = line.text.indexOf(piece.text, cursor);
    if (at < 0) continue;
    if (at > cursor) result.push(<span key={'gap' + i}>{line.text.slice(cursor, at)}</span>);
    const progress = pieceProgress(positionMs, piece.startMs, piece.endMs);
    result.push(
      <span key={i} class={`lyric-piece ${progress > 0 ? 'is-sung' : ''}`} data-word-start={piece.startMs} data-word-end={piece.endMs} style={{ '--sung': `${progress}%`, '--i': Math.min(i, 12) }}>{piece.text}</span>,
    );
    cursor = at + piece.text.length;
  }
  if (cursor < line.text.length) result.push(<span key="tail">{line.text.slice(cursor)}</span>);
  return <>{result}</>;
}

/** After the person scrolls the lyrics, they stay where they were put for this long before following the song again. */
const MANUAL_HOLD_MS = 4000;
const EMPTY_LINES: TimedLyricsLine[] = [];
interface LyricsViewProps { track: Track; positionMs: number; audio?: HTMLAudioElement | null; playing?: boolean; menuHost?: HTMLElement | null }

function LyricsPanel({ track, positionMs, audio, playing = false, menuHost }: LyricsViewProps) {
  const { lyrics, services, t } = useApp();
  const state = useSnapshot(lyrics);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => services.prefs.subscribe(() => bump(0)), [services]);
  const viewport = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const painted = useRef(new WeakMap<HTMLElement, number>());
  const lastLine = useRef<number | undefined>(undefined);
  const [liveLine, setLiveLine] = useState(-1);
  // The last line that began has also finished (a pause in the singing): it is no longer shown as the sung one, but the view stays on it.
  const [resting, setResting] = useState(false);

  const { snapshot, translation } = state;
  const current = snapshot.trackId === track.id ? snapshot.document : null;
  const detail = lyrics.detail;
  const effective = timingDetail(current, detail);
  const lines = current?.type === 'synced' ? current.lines : EMPTY_LINES;
  const groups = useMemo(() => lineGroups(lines), [lines]);
  const groupAt = useRef<number[]>([]);
  groupAt.current = groups.flatMap((members, groupIndex) => members.map((index) => [index, groupIndex] as const)).sort((a, b) => a[0] - b[0]).map(([, groupIndex]) => groupIndex);
  const hasIntro = lines.length > 0 && lines[0].timeMs > 0;
  const shownTranslation = translation.status === 'ready' && translation.lines && current ? translation.lines : null;
  const plainLines = current?.type === 'plain' ? textLines(current) : null;
  const script = lyrics.readings ? readingScript(textLines(current)) : undefined;

  // Frame loop: the clock is the audio element. Only the line being sung is touched per frame.
  useLayoutEffect(() => {
    lastLine.current = undefined;
  }, [lines]);
  useLayoutEffect(() => {
    if (!lines.length) return;
    let frame = 0;
    let stopped = false;
    const times = lines.map((line) => line.timeMs);
    const perLine: HTMLElement[][] = lines.map((_, i) => Array.from(rail.current?.querySelectorAll<HTMLElement>(`[data-line-index="${i}"] [data-word-start]`) || []));
    const tick = () => {
      if (stopped) return;
      const time = readMediaClock(audio, positionMs);
      const index = activeIndex(times, time, Math.max(0, lastLine.current ?? 0));
      setLiveLine((value) => (value === index ? value : index));
      const finished = index >= 0 && groupFinished(lines, groups, groupAt.current[index] ?? 0, time);
      setResting((value) => (value === finished ? value : finished));
      for (const line of linesToPaint(lastLine.current, index, lines.length)) {
        for (const element of perLine[line]) {
          const value = pieceProgress(time, Number(element.dataset.wordStart), Number(element.dataset.wordEnd));
          if (painted.current.get(element) !== value) {
            element.style.setProperty('--sung', value + '%');
            element.classList.toggle('is-sung', value > 0);
            painted.current.set(element, value);
          }
        }
      }
      lastLine.current = index;
      if (playing && !document.hidden) frame = requestAnimationFrame(tick);
    };
    const resume = () => { cancelAnimationFrame(frame); lastLine.current = undefined; tick(); };
    tick();
    document.addEventListener('visibilitychange', resume);
    return () => { stopped = true; cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', resume); };
  }, [lines, groups, audio, playing, effective, positionMs]);

  // The view scrolls on its own (wheel, pointer, arrow keys on the remote). The sung group is kept at 42% of the height by
  // scrolling smoothly when the line changes, never per frame; after the person scrolls, it waits a few seconds before following again.
  const manualUntil = useRef(0);
  const followed = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const view = viewport.current;
    if (!view) return;
    const touch = () => { manualUntil.current = Date.now() + MANUAL_HOLD_MS; };
    view.addEventListener('wheel', touch, { passive: true });
    view.addEventListener('touchstart', touch, { passive: true });
    view.addEventListener('keydown', touch);
    view.addEventListener('pointerdown', touch);
    return () => { view.removeEventListener('wheel', touch); view.removeEventListener('touchstart', touch); view.removeEventListener('keydown', touch); view.removeEventListener('pointerdown', touch); };
  }, [current?.type]);
  useLayoutEffect(() => {
    const follow = (instant: boolean) => {
      const key = liveLine < 0 && hasIntro ? -1 : Math.max(0, liveLine);
      const group = rail.current?.querySelector<HTMLElement>(key < 0 ? '[data-line-index="-1"]' : `[data-group="${groups.findIndex((members) => members.includes(key))}"]`);
      const view = viewport.current;
      if (!group || !view) return;
      const top = Math.max(0, group.offsetTop + group.offsetHeight / 2 - view.clientHeight * 0.42);
      if (typeof view.scrollTo === 'function') view.scrollTo({ top, behavior: instant || !motionAllowed() ? 'auto' : 'smooth' });
      else view.scrollTop = top;
    };
    const first = followed.current === undefined;
    if (!first && Date.now() < manualUntil.current && followed.current !== liveLine) { followed.current = liveLine; return; }
    followed.current = liveLine;
    follow(first);
    const onResize = () => follow(true);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [liveLine, lines, shownTranslation, script, hasIntro]);

  const chosen = snapshot.results.find((result) => result.id === snapshot.source);
  const pending = snapshot.source === 'auto' ? !snapshot.complete : chosen?.status === 'waiting' || chosen?.status === 'loading';
  const message = pending ? t('lyrics.searching') : chosen?.status === 'error' ? chosen.error : snapshot.source === USER_EDITED ? t('lyrics.state.missing') : t('lyrics.notFound');
  const readingFor = (text: string) => (script ? readingOf(text, script) : null);

  const options = (
    <div class="lyrics-option-fields" aria-label={t('lyrics.options')}>
      <label>{t('lyrics.detail')}
        <select id="lyrics-detail" data-focus-id="lyrics-detail" data-focus-row="11" data-focus-column="0" value={detail} onChange={(event) => { void services.prefs.set(PREF_LYRICS_DETAIL, event.currentTarget.value).catch(() => undefined); }}>
          <option value="auto">{t('lyrics.auto')}</option><option value="line">{t('lyrics.detail.line')}</option><option value="word">{t('lyrics.detail.word')}</option><option value="syllable">{t('lyrics.detail.syllable')}</option>
        </select>
      </label>
      <label>{t('lyrics.motion')}
        <select id="lyrics-motion" data-focus-id="lyrics-motion" data-focus-row="12" data-focus-column="0" value={lyrics.motion} onChange={(event) => { void services.prefs.set(PREF_LYRICS_MOTION, event.currentTarget.value).catch(() => undefined); }}>
          <option value="MOTION">{t('lyrics.style', { n: 1 })}</option><option value="LEGACY">{t('lyrics.style', { n: 2 })}</option>
        </select>
      </label>
    </div>
  );

  return (
    <section class={`lyrics-view lyrics-embedded ${playing ? 'is-running' : ''}`} aria-label={t('lyrics.label')} data-timing-detail={effective}>
      {menuHost && createPortal(options, menuHost)}
      {!current && <p class="message-state lyrics-message" role="status">{message}</p>}
      {translation.status === 'translating' && <p class="lyrics-status" role="status">{t('lyrics.translating')}</p>}
      {translation.status === 'error' && <p class="lyrics-status is-error" role="alert">{translation.error}</p>}
      {plainLines && (
        <pre id="lyrics-plain" data-focus-id="lyrics-plain" data-focus-row="5" data-focus-column="0" data-scrollable="true" tabIndex={0} class="lyrics-text lyrics-plain">
          {plainLines.map((line, index) => (
            <span class="plain-line" key={index}>
              {line || ' '}
              {readingFor(line) && <span class="lyric-sub lyric-reading">{readingFor(line)}</span>}
              {shownTranslation?.[index] && <span class="lyric-sub lyric-translation">{shownTranslation[index]}</span>}
            </span>
          ))}
        </pre>
      )}
      {current?.type === 'synced' && (
        <div class="lyrics-viewport" ref={viewport} id="lyrics-viewport" data-focus-id="lyrics-viewport" data-focus-row="5" data-focus-column="0" data-scrollable="true" tabIndex={0}>
          <div ref={rail} class={`lyrics-rail lyrics-motion-${lyrics.motion === 'LEGACY' ? 'legacy' : 'motion'}`} aria-label={t('lyrics.synced')}>
            {hasIntro && <p data-line-index="-1" class={`lyrics-line lyrics-intro-line ${liveLine < 0 ? 'is-active' : 'is-past'}`} style={liveLine >= 0 && groups.findIndex((members) => members.includes(liveLine)) < 9 ? `filter:blur(${Math.min(1.5 + (groups.findIndex((members) => members.includes(liveLine)) + 1) * 0.9, 5).toFixed(1)}px)` : undefined} aria-current={liveLine < 0 ? 'true' : undefined}><LyricsIntro positionMs={positionMs} endMs={lines[0].timeMs} audio={audio} playing={playing && liveLine < 0} /></p>}
            {groups.map((members, groupIndex) => {
              const liveGroup = groups.findIndex((group) => group.includes(liveLine));
              const away = Math.abs(groupIndex - liveGroup);
              const state = groupIndex === liveGroup && !resting ? 'is-active' : groupIndex <= liveGroup ? 'is-past' : 'is-upcoming';
              // Groups before and after the one being sung are blurred, more the further away they are (as on the phone).
              // Beyond a few screens' worth they are off the view anyway, so they are left alone.
              return (
                <div class={`lyric-group ${state}`} data-group={groupIndex} key={`${groupIndex}-${lines[members[0]].timeMs}`} style={away > 0 && away <= 9 ? `filter:blur(${Math.min(1.5 + away * 0.9, 5).toFixed(1)}px)` : undefined}>
                  {members.map((index) => {
                    const line = lines[index];
                    const reading = readingFor(line.text);
                    return (
                      <p data-line-index={index} key={`${index}-${line.timeMs}`} class={`lyrics-line ${index === liveLine ? 'is-sung-now' : ''} ${line.isBackground ? 'is-background' : ''} ${!line.isBackground && (line.agent || 'v1') !== 'v1' ? 'is-second-voice' : ''}`} aria-current={index === liveLine ? 'true' : undefined}>
                        <TimedLine line={line} positionMs={readMediaClock(audio, positionMs)} detail={effective} />
                        {reading && <span class="lyric-sub lyric-reading">{reading}</span>}
                        {shownTranslation?.[index] && <span class="lyric-sub lyric-translation">{shownTranslation[index]}</span>}
                      </p>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export const LyricsView = memo(LyricsPanel, (a, b) => a.track === b.track && a.audio === b.audio && a.playing === b.playing && a.menuHost === b.menuHost && (!!b.playing && !!b.audio || a.positionMs === b.positionMs));
