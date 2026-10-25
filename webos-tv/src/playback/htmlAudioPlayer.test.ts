import { describe, expect, it, vi } from 'vitest';
import type { ResolvedStream } from '../data/youtubePlayback';
import type { Track } from '../model';
import { SourceFailure } from '../sources/errors';
import type { HlsLoader } from './hls';
import { HtmlAudioPlayer, clampRate, descriptionOf, loadAndPlayTrack } from './htmlAudioPlayer';

const trackA: Track = {
  id: 'track-a',
  title: 'Lagu A',
  artist: 'Senja',
  durationMs: 180_000,
};

const streamA: ResolvedStream = {
  url: 'https://media.example.test/a.mp3',
  mimeType: 'audio/mpeg',
};

class FakeAudioElement extends EventTarget {
  currentTime = 0;
  duration = 180;
  paused = true;
  ended = false;
  src = '';
  loadCount = 0;
  playCount = 0;
  playResult: () => Promise<void> = async () => {};

  removeAttribute(name: string) {
    if (name === 'src') this.src = '';
  }

  load() {
    this.loadCount += 1;
  }

  pause() {
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }

  async play() {
    this.playCount += 1;
    await this.playResult();
    this.paused = false;
    this.dispatchEvent(new Event('playing'));
  }
}

function makeAudio(): FakeAudioElement {
  return new FakeAudioElement();
}

describe('HtmlAudioPlayer', () => {
  it('loads a resolved stream and publishes media events as snapshots', async () => {
    const audio = makeAudio();
    const player = new HtmlAudioPlayer(
      audio as unknown as HTMLAudioElement,
      async () => streamA,
    );
    const snapshots: Array<{ status: string; positionMs: number; durationMs: number }> = [];
    player.subscribe((snapshot) => snapshots.push(snapshot));

    await player.load(trackA);
    audio.dispatchEvent(new Event('loadedmetadata'));
    audio.currentTime = 24.5;
    audio.dispatchEvent(new Event('timeupdate'));
    audio.dispatchEvent(new Event('waiting'));
    await player.play();

    expect(audio.src).toBe(streamA.url);
    expect(snapshots).toContainEqual(expect.objectContaining({
      status: 'paused',
      positionMs: 0,
      durationMs: 180_000,
      loadId: 1,
    }));
    expect(snapshots).toContainEqual(expect.objectContaining({
      status: 'playing',
      positionMs: 24_500,
      durationMs: 180_000,
      loadId: 1,
    }));
    expect(snapshots.some(({ status }) => status === 'loading')).toBe(true);
  });

  it('converts seek milliseconds to HTMLMediaElement seconds', async () => {
    const audio = makeAudio();
    const player = new HtmlAudioPlayer(audio as unknown as HTMLAudioElement, async () => streamA);

    await player.load(trackA);
    player.seekTo(75_250);

    expect(audio.currentTime).toBe(75.25);
  });

  it('does not let an older stream resolution replace a newer selected track', async () => {
    const audio = makeAudio();
    let finishFirst!: (stream: ResolvedStream) => void;
    const player = new HtmlAudioPlayer(
      audio as unknown as HTMLAudioElement,
      (track) =>
        track.id === 'track-a'
          ? new Promise((resolve) => {
              finishFirst = resolve;
            })
          : Promise.resolve({ url: 'https://media.example.test/b.mp3', mimeType: 'audio/mpeg' }),
    );

    const firstLoad = player.load(trackA);
    const secondLoad = player.load({ ...trackA, id: 'track-b', title: 'Lagu B' });
    await secondLoad;
    finishFirst(streamA);
    await firstLoad;

    expect(audio.src).toBe('https://media.example.test/b.mp3');
  });

  it('publishes playback failure when the browser rejects play()', async () => {
    const audio = makeAudio();
    audio.playResult = async () => {
      throw new DOMException('Not allowed', 'NotAllowedError');
    };
    const player = new HtmlAudioPlayer(audio as unknown as HTMLAudioElement, async () => streamA);
    const snapshots: Array<{ status: string; error?: string }> = [];
    player.subscribe((snapshot) => snapshots.push(snapshot));
    await player.load(trackA);

    await expect(player.play()).rejects.toThrow();
    expect(snapshots[snapshots.length - 1]).toMatchObject({
      status: 'error',
      error: expect.stringContaining('Tekan Putar'),
    });
  });

  it('does not let an old play rejection mark the newly loaded track as an error', async () => {
    const audio = makeAudio();
    let rejectOldPlay!: (error: unknown) => void;
    audio.playResult = () => new Promise((_, reject) => {
      rejectOldPlay = reject;
    });
    const player = new HtmlAudioPlayer(audio as unknown as HTMLAudioElement, async () => streamA);
    const snapshots: Array<{ status: string; error?: string }> = [];
    player.subscribe((snapshot) => snapshots.push(snapshot));

    await player.load(trackA);
    const oldPlay = player.play();
    await player.load({ ...trackA, id: 'track-b', title: 'Lagu B' });
    rejectOldPlay(new DOMException('Interrupted by a new source', 'AbortError'));

    await expect(oldPlay).resolves.toBeUndefined();
    expect(snapshots[snapshots.length - 1]).toMatchObject({ status: 'loading' });
  });

  it('does not start a newer track from a retry whose stream request became stale', async () => {
    const audio = makeAudio();
    let finishFirst!: (stream: ResolvedStream) => void;
    const streamB = { url: 'https://media.example.test/b.mp3', mimeType: 'audio/mpeg' };
    const player = new HtmlAudioPlayer(
      audio as unknown as HTMLAudioElement,
      (track) => track.id === 'track-a'
        ? new Promise((resolve) => { finishFirst = resolve; })
        : Promise.resolve(streamB),
    );

    const oldRetry = loadAndPlayTrack(player, trackA);
    await player.load({ ...trackA, id: 'track-b', title: 'Lagu B' });
    player.pause();
    finishFirst(streamA);
    await oldRetry;

    expect(audio.src).toBe(streamB.url);
    expect(audio.playCount).toBe(0);
  });

  it('keeps pause available as a buffering media element waits', async () => {
    const audio = makeAudio();
    const player = new HtmlAudioPlayer(audio as unknown as HTMLAudioElement, async () => streamA);
    const snapshots: Array<{ status: string }> = [];
    player.subscribe((snapshot) => snapshots.push(snapshot));
    await player.load(trackA);

    audio.dispatchEvent(new Event('waiting'));
    expect(snapshots[snapshots.length - 1].status).toBe('buffering');

    player.pause();
    expect(snapshots[snapshots.length - 1].status).toBe('paused');
  });
});

describe('HtmlAudioPlayer restore', () => {
  it('seeks to the saved position once metadata arrives and does not start playing', async () => {
    const audio = makeAudio();
    const player = new HtmlAudioPlayer(audio as unknown as HTMLAudioElement, async () => streamA);
    const { loadTrackPaused } = await import('./htmlAudioPlayer');
    await loadTrackPaused(player, trackA, 42_000);
    expect(audio.currentTime).toBe(0);
    audio.dispatchEvent(new Event('loadedmetadata'));
    expect(audio.currentTime).toBe(42);
    expect(audio.playCount).toBe(0);
  });
});

describe('playback speed and song info', () => {
  it('keeps the chosen tempo across songs (loading a source resets the element) and keeps the pitch', async () => {
    const audio = makeAudio() as FakeAudioElement & { playbackRate?: number; defaultPlaybackRate?: number; preservesPitch?: boolean };
    const player = new HtmlAudioPlayer(audio as unknown as HTMLAudioElement, async () => streamA);
    player.setPlaybackRate(1.25);
    expect(audio.playbackRate).toBe(1.25);
    audio.playbackRate = 1;                       // what the element does when a new source loads
    await player.load(trackA);
    expect(audio.playbackRate).toBe(1.25);
    expect(audio.defaultPlaybackRate).toBe(1.25);
    expect(audio.preservesPitch).toBe(true);
  });

  it('clamps to Android\'s 0.25 to 3 range in steps of 0.05, and ignores nonsense', () => {
    expect([clampRate(0.1), clampRate(7), clampRate(1.07), clampRate(NaN)]).toEqual([0.25, 3, 1.05, 1]);
  });

  it('remembers the description a resolved song came with', async () => {
    const player = new HtmlAudioPlayer(makeAudio() as unknown as HTMLAudioElement, async () => ({ ...streamA, description: 'Provided to YouTube by Senja Records' }));
    await player.load({ ...trackA, id: 'with-description' });
    expect(descriptionOf('with-description')).toBe('Provided to YouTube by Senja Records');
    expect(descriptionOf('unknown')).toBeUndefined();
  });
});

describe('protected and adaptive streams', () => {
  const hlsStream: ResolvedStream = {
    url: 'http://127.0.0.1:1/s/x/api/source/manifest/tok1', mimeType: 'application/vnd.apple.mpegurl', format: 'hls',
    drm: { licenseUrl: 'http://127.0.0.1:1/s/x/api/source/license/tok2' },
    source: { provider: 'applemusic', label: 'Apple Music', quality: 'AAC 256', codec: 'AAC' },
  };

  it('opens an HLS song through the player library, not the audio element, and publishes where it came from', async () => {
    const audio = makeAudio();
    const sessions: Array<{ destroyed: boolean }> = [];
    const loader: HlsLoader = vi.fn(async () => { const session = { destroyed: false, destroy() { this.destroyed = true; } }; sessions.push(session); return session; });
    const player = new HtmlAudioPlayer(audio as unknown as HTMLAudioElement, async () => hlsStream, loader);
    const seen: Array<{ status: string; source?: { label: string } }> = [];
    player.subscribe((snapshot) => seen.push(snapshot));
    const id = await player.load(trackA);
    expect(loader).toHaveBeenCalledWith(audio, hlsStream, expect.any(Function));
    expect(audio.src).toBe('');                                   // the library attaches its own media source
    expect(seen[seen.length - 1].source?.label).toBe('Apple Music');
    await player.play(id);                                         // attached, so play is allowed without a src
    expect(audio.playCount).toBe(1);
  });

  it('lets go of the previous song\'s session before the next one, and when the player is disposed', async () => {
    const audio = makeAudio();
    const sessions: Array<{ destroyed: boolean }> = [];
    const loader: HlsLoader = async () => { const session = { destroyed: false, destroy() { this.destroyed = true; } }; sessions.push(session); return session; };
    const player = new HtmlAudioPlayer(audio as unknown as HTMLAudioElement, async () => hlsStream, loader);
    await player.load(trackA);
    await player.load({ ...trackA, id: 'b' });
    expect(sessions.map((s) => s.destroyed)).toEqual([true, false]);
    player.dispose();
    await Promise.resolve();
    expect(sessions[1].destroyed).toBe(true);
  });

  it('a load that was superseded while the library was opening does not stay attached', async () => {
    const audio = makeAudio();
    let release: () => void = () => undefined;
    const sessions: Array<{ destroyed: boolean }> = [];
    const loader: HlsLoader = (_a, stream) => new Promise((resolve) => { release = () => { const session = { destroyed: false, destroy() { this.destroyed = true; } }; sessions.push(session); resolve(session); }; void stream; });
    const player = new HtmlAudioPlayer(audio as unknown as HTMLAudioElement, async (track) => (track.id === 'track-a' ? hlsStream : streamA), loader);
    const first = player.load(trackA);
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    await player.load({ ...trackA, id: 'b' });
    release();
    expect(await first).toBeUndefined();
    await Promise.resolve();
    expect(sessions[0].destroyed).toBe(true);
  });

  it('keeps the kind of failure when the library cannot open the stream, so the screen can say which step', async () => {
    for (const [kind, label] of [['auth', 'Akun'], ['license', 'Lisensi'], ['decode', 'Decode'], ['stream', 'Stream']] as const) {
      const loader: HlsLoader = async () => { throw new SourceFailure(kind, 'alasan', 'Apple Music'); };
      const player = new HtmlAudioPlayer(makeAudio() as unknown as HTMLAudioElement, async () => hlsStream, loader);
      const seen: Array<{ status: string; error?: string; errorKind?: string }> = [];
      player.subscribe((snapshot) => seen.push(snapshot));
      await expect(player.load(trackA)).rejects.toBeInstanceOf(SourceFailure);
      expect(seen[seen.length - 1]).toMatchObject({ status: 'error', errorKind: kind, error: `${label} · Apple Music: alasan` });
    }
  });

  it('an error the library raises while playing (a refused license on the first segment) reaches the screen with its kind', async () => {
    let raise: (failure: SourceFailure) => void = () => undefined;
    const loader: HlsLoader = async (_a, _s, onError) => { raise = onError; return { destroy() { /* nothing */ } }; };
    const player = new HtmlAudioPlayer(makeAudio() as unknown as HTMLAudioElement, async () => hlsStream, loader);
    const seen: Array<{ status: string; errorKind?: string }> = [];
    player.subscribe((snapshot) => seen.push(snapshot));
    await player.load(trackA);
    raise(new SourceFailure('license', 'Lisensi ditolak (502).', 'Apple Music'));
    expect(seen[seen.length - 1]).toMatchObject({ status: 'error', errorKind: 'license' });
  });

  it('progressive audio the TV cannot decode is a decode failure that names the codec, before anything is attached', async () => {
    const audio = makeAudio() as FakeAudioElement & { canPlayType(type: string): string };
    audio.canPlayType = () => '';
    const flac: ResolvedStream = { url: 'http://x/y', mimeType: 'audio/flac', source: { provider: 'monochrome', label: 'Monochrome', quality: 'FLAC', codec: 'FLAC' } };
    const player = new HtmlAudioPlayer(audio as unknown as HTMLAudioElement, async () => flac);
    const seen: Array<{ errorKind?: string; error?: string }> = [];
    player.subscribe((snapshot) => seen.push(snapshot));
    await expect(player.load(trackA)).rejects.toBeInstanceOf(SourceFailure);
    expect(seen[seen.length - 1]).toMatchObject({ errorKind: 'decode', error: expect.stringContaining('FLAC') });
    expect(audio.src).toBe('');
  });

  it('a media element error says decode, network or stream by its own error code', async () => {
    const audio = makeAudio() as FakeAudioElement & { error?: { code: number } };
    const player = new HtmlAudioPlayer(audio as unknown as HTMLAudioElement, async () => streamA);
    const seen: Array<{ errorKind?: string }> = [];
    player.subscribe((snapshot) => seen.push(snapshot));
    await player.load(trackA);
    for (const [code, kind] of [[2, 'network'], [3, 'decode'], [4, 'decode'], [1, 'stream']] as const) {
      audio.error = { code };
      audio.dispatchEvent(new Event('error'));
      expect(seen[seen.length - 1].errorKind).toBe(kind);
    }
  });
});
