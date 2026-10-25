import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { PlaybackSnapshot, Track } from '../model';
import { HtmlAudioPlayer } from '../playback/htmlAudioPlayer';
import { currentTrack } from '../playback/queueModel';
import type { AppAction } from './store';
import type { RootState } from './rootState';

/** What the shell needs from an audio engine; `HtmlAudioPlayer` is the real one. */
export interface PlayerPort {
  subscribe(listener: (snapshot: PlaybackSnapshot) => void): () => void;
  load(track: Track, options?: { startAtMs?: number }): Promise<number | undefined>;
  play(loadId?: number): Promise<void>;
  pause(): void;
  seekTo(positionMs: number): void;
  /** Tempo (1 = normal). Engines that cannot change it leave this out. */
  setPlaybackRate?(rate: number): void;
  dispose(): void;
}

export type PlayerFactory = (audio: HTMLAudioElement) => PlayerPort;
export const defaultPlayerFactory: PlayerFactory = (audio) => new HtmlAudioPlayer(audio);

export interface PlaybackControls {
  toggle(): void;
  play(): void;
  pause(): void;
  seekTo(positionMs: number): void;
  seekBy(deltaMs: number): void;
  setVolume(volume: number): void;
  setSpeed(rate: number): void;
  volume: number;
}

/**
 * Owns the single audio element for the whole app. The engine reloads only when `playToken`
 * changes, so switching pages, opening overlays or re-rendering never restarts the song.
 */
export function usePlaybackEngine(root: RootState, dispatch: (action: AppAction) => void, factory: PlayerFactory = defaultPlayerFactory) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playerRef = useRef<PlayerPort | null>(null);
  const rootRef = useRef(root);
  rootRef.current = root;
  const [volume, setVolumeState] = useState(1);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    const player = factory(element);
    playerRef.current = player;
    const unsubscribe = player.subscribe((snapshot) => dispatch({ type: 'playback/updated', snapshot }));
    return () => {
      unsubscribe();
      player.dispose();
      playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    const state = rootRef.current;
    const track = currentTrack(state.queue);
    if (!player || !track || state.playToken === 0) return;
    let active = true;
    void (async () => {
      try {
        const loadId = await player.load(track, state.autoplay ? undefined : { startAtMs: state.resumeAtMs });
        if (loadId === undefined || !active || !state.autoplay) return;
        await player.play(loadId);
      } catch {
        // The engine already published the error snapshot the UI shows.
      }
    })();
    return () => { active = false; };
  }, [root.playToken]);

  // A song that dies mid-play has usually outlived its stream address: resolve it again once and
  // carry on from the same second. A song that never started, or fails again, is left to the user.
  const wasPlaying = useRef(false);
  const retriedToken = useRef(-1);
  useEffect(() => {
    const { status, positionMs } = root.playback;
    if (status !== 'error') { wasPlaying.current = status === 'playing' || status === 'buffering'; return; }
    const player = playerRef.current;
    const track = currentTrack(root.queue);
    if (!player || !track || !wasPlaying.current || positionMs <= 0 || retriedToken.current === root.playToken) return;
    retriedToken.current = root.playToken;
    wasPlaying.current = false;
    void (async () => {
      try {
        const loadId = await player.load(track, { startAtMs: positionMs });
        if (loadId !== undefined) await player.play(loadId);
      } catch { /* the engine already published the error snapshot */ }
    })();
  }, [root.playback.status]);

  const status = root.playback.status;
  const toggle = useCallback(() => {
    const player = playerRef.current;
    const state = rootRef.current;
    const track = currentTrack(state.queue);
    if (!player || !track) return;
    if (state.playback.status === 'playing' || state.playback.status === 'buffering') { player.pause(); return; }
    if (state.playback.status === 'error') {
      void (async () => { try { const id = await player.load(track, { startAtMs: state.playback.positionMs }); if (id !== undefined) await player.play(id); } catch { /* shown via snapshot */ } })();
      return;
    }
    void player.play().catch(() => undefined);
  }, []);

  const controls: PlaybackControls = {
    toggle,
    play: () => { if (status !== 'playing' && status !== 'buffering') toggle(); },
    pause: () => { if (status === 'playing' || status === 'buffering') toggle(); },
    seekTo: (positionMs) => playerRef.current?.seekTo(positionMs),
    seekBy: (deltaMs) => {
      const { positionMs, durationMs } = rootRef.current.playback;
      playerRef.current?.seekTo(Math.max(0, Math.min(positionMs + deltaMs, durationMs || positionMs + deltaMs)));
    },
    setVolume: (next) => {
      const clamped = Math.max(0, Math.min(1, next));
      if (audioRef.current) audioRef.current.volume = clamped;
      setVolumeState(clamped);
    },
    setSpeed: (rate) => playerRef.current?.setPlaybackRate?.(rate),
    volume,
  };
  return { audioRef, controls };
}
