import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { activeLineIndex, ChunkAssembler, MAX_CHUNK_BYTES, NAMESPACE, PresentationGuard, statusLabel, timedWordSegments, type LyricLine, type TrackSnapshot, type ViewMode } from './protocol';
import './style.css';

declare global {
  interface Window { cast?: any; __MUSICFY_DEMO__?: boolean }
}

type Track = TrackSnapshot & { next?: string };

const demo = new URLSearchParams(location.search).has('demo');
const demoTrack: Track = {
  title: 'Midnight City', artist: 'M83', album: 'Hurry Up, We’re Dreaming',
  artwork: 'https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=900&q=85',
  next: 'Wait — M83',
};
const demoLines: LyricLine[] = [
  { timeMs: 0, text: 'Waiting in the car' }, { timeMs: 4200, text: 'Waiting for the ride in the dark' },
  { timeMs: 8600, text: 'At night the city grows' }, { timeMs: 12400, text: 'Look and see her eyes, they glow' },
  { timeMs: 16800, text: 'Waiting in the car' }, { timeMs: 21000, text: 'Waiting for the ride in the dark' },
];

function App() {
  const [track, setTrack] = useState<Track | null>(demo ? demoTrack : null);
  const [lines, setLines] = useState<LyricLine[]>(demo ? demoLines : []);
  const [mode, setMode] = useState<ViewMode>('player');
  const [position, setPosition] = useState(demo ? 9300 : 0);
  const [duration, setDuration] = useState(demo ? 224000 : 0);
  const [state, setState] = useState(demo ? 'playing' : 'connecting');

  useEffect(() => {
    if (demo || !window.cast?.framework) return;
    const context = window.cast.framework.CastReceiverContext.getInstance();
    const player = context.getPlayerManager();
    const presentationGuard = new PresentationGuard();
    const assembler = new ChunkAssembler();
    let activeIdentity = '';
    let senderSessionId = '';
    let playbackError = false;
    const syncActiveIdentity = (info: any) => {
      const customData = info?.customData;
      const mediaId = typeof customData?.mediaId === 'string' ? customData.mediaId : '';
      const queueEntryId = typeof customData?.queueEntryId === 'string' ? customData.queueEntryId : mediaId;
      const nextIdentity = mediaId && queueEntryId ? identityKey(mediaId, queueEntryId) : '';
      if (nextIdentity === activeIdentity) return;
      activeIdentity = nextIdentity;
      playbackError = false;
      presentationGuard.setActiveIdentity(mediaId, queueEntryId);
      setTrack(null);
      setLines([]);
    };
    const sendReady = (senderId: string | undefined, sessionId: string) => context.sendCustomMessage(NAMESPACE, senderId, {
      version: 1, type: 'READY', requestId: crypto.randomUUID?.() ?? String(Date.now()),
      senderSessionId: sessionId, mediaId: '', queueEntryId: '', revision: 0,
      data: { capabilities: ['player', 'lyrics', 'artwork'] },
    });
    context.addCustomMessageListener(NAMESPACE, (event: any) => {
      let message = event.data;
      if (typeof message === 'string') {
        try { message = JSON.parse(message); } catch { return; }
      }
      if (!message || message.version !== 1 || typeof message.type !== 'string') return;
      syncActiveIdentity(player.getMediaInformation?.());
      if (message.type === 'HELLO') {
        if (typeof message.senderSessionId !== 'string' || !message.senderSessionId) return;
        senderSessionId = message.senderSessionId;
        if (presentationGuard.setSenderSession(senderSessionId)) setLines([]);
        sendReady(event.senderId, senderSessionId);
        return;
      }
      if (!senderSessionId || message.senderSessionId !== senderSessionId) return;
      const messageIdentity = identityKey(message.mediaId, message.queueEntryId);
      if (message.type === 'SET_VIEW_MODE' && messageIdentity === activeIdentity &&
          ['player', 'lyrics', 'artwork'].includes(message.data?.mode)) {
        setMode(message.data.mode);
      }
      if (message.type === 'LYRICS_CHUNK') {
        const { transferId, index, count, chunk } = message.data ?? {};
        if (typeof transferId !== 'string' || typeof chunk !== 'string' ||
            !Number.isInteger(index) || !Number.isInteger(count) || count < 1 || count > 128 ||
            index < 0 || index >= count || new TextEncoder().encode(chunk).length > MAX_CHUNK_BYTES ||
            typeof message.mediaId !== 'string' || !message.mediaId ||
            typeof message.queueEntryId !== 'string' || !message.queueEntryId ||
            !Number.isSafeInteger(message.revision) || message.revision < 0) return;
        if (!presentationGuard.matchesSnapshot(senderSessionId, message.mediaId, message.queueEntryId, message.revision)) return;
        const payloadText = assembler.add(transferId, index, count, chunk);
        context.sendCustomMessage(NAMESPACE, event.senderId, {
          version: 1, type: 'ACK', requestId: message.requestId,
          senderSessionId,
          mediaId: message.mediaId, queueEntryId: message.queueEntryId,
          revision: message.revision, data: { transferId, index },
        });
        if (!payloadText) return;
        try {
          const payload = JSON.parse(payloadText);
          if (!presentationGuard.acceptLyrics(senderSessionId, message.mediaId, message.queueEntryId, message.revision)) return;
          setLines(Array.isArray(payload.lines) ? payload.lines : []);
        } catch { return; }
      }
      if (message.type === 'SNAPSHOT' && message.data && typeof message.data === 'object' &&
          typeof message.mediaId === 'string' && message.mediaId &&
          typeof message.queueEntryId === 'string' && message.queueEntryId &&
          presentationGuard.acceptSnapshot(senderSessionId, message.mediaId, message.queueEntryId, message.revision)) {
        setTrack(message.data.track ?? null);
        setLines(Array.isArray(message.data.lines) ? message.data.lines : []);
        if (['player', 'lyrics', 'artwork'].includes(message.data.mode)) setMode(message.data.mode);
      }
    });
    const onStatus = () => {
      const info = player.getMediaInformation?.();
      syncActiveIdentity(info);
      const metadata = info?.metadata;
      if (metadata) setTrack({
        title: metadata.title ?? 'Unknown title', artist: metadata.artist ?? 'Unknown artist',
        album: metadata.albumName, artwork: metadata.images?.[0]?.url,
      });
      else if (!info) setTrack(null);
      setPosition(Math.max(0, player.getCurrentTimeSec?.() ?? 0) * 1000);
      setDuration(Math.max(0, player.getDurationSec?.() ?? 0) * 1000);
      const status = player.getPlayerState?.();
      setState(playbackError ? 'error' : status?.toLowerCase?.() ?? 'ready');
    };
    const onError = () => { playbackError = true; setState('error'); };
    const errorEventType = window.cast.framework.events.EventType.ERROR;
    player.addEventListener(window.cast.framework.events.EventType.MEDIA_STATUS, onStatus);
    if (errorEventType) player.addEventListener(errorEventType, onError);
    const receiverOptions = new window.cast.framework.CastReceiverOptions();
    receiverOptions.customNamespaces = { [NAMESPACE]: window.cast.framework.system.MessageType.JSON };
    context.start(receiverOptions);
    const timer = window.setInterval(onStatus, 250);
    return () => {
      window.clearInterval(timer);
      player.removeEventListener(window.cast.framework.events.EventType.MEDIA_STATUS, onStatus);
      if (errorEventType) player.removeEventListener(errorEventType, onError);
    };
  }, []);

  const active = activeLineIndex(lines, position);
  const activeWord = active >= 0 ? (lines[active].words?.findIndex((word) => position >= word.startMs && position < word.endMs) ?? -1) : -1;
  const focus = mode === 'lyrics';
  const current = track;
  return <main class={`screen ${focus ? 'lyrics-focus' : ''}`}>
    <header class="topline"><span class="brand">MUSICFY</span><span class="room">{statusLabel(state)}</span></header>
    <section class="content">
      {mode !== 'lyrics' && <div class="album-area">
        <div class="artwork">{current?.artwork ? <img src={current.artwork} alt="Album artwork" /> : <div class="art-fallback">♪</div>}</div>
        <div class="track-copy"><h1>{current?.title ?? 'Waiting for music'}</h1><p>{current ? [current.artist, current.album].filter(Boolean).join(' · ') : 'Choose a song in Musicfy on your phone'}</p></div>
      </div>}
      {mode !== 'artwork' && <div class="lyrics" aria-live="off">
        {lines.length ? <div class="lyric-list">{lines.slice(Math.max(0, active - 2), active + 3).map((line, index) => {
          const actual = Math.max(0, active - 2) + index;
          return <p class={actual === active ? 'active-line' : 'lyric-line'} key={`${line.timeMs}:${actual}`}>
            {actual === active && line.words?.length
              ? timedWordSegments(line).map((segment, index) => segment.wordIndex === undefined
                ? segment.text
                : <span class={segment.wordIndex === activeWord ? 'active-word' : undefined} key={`${segment.wordIndex}:${index}`}>{segment.text}</span>)
              : line.text}
          </p>;
        })}</div> : <p class="no-lyrics">Lyrics will appear here</p>}
      </div>}
    </section>
    <footer class="bottomline"><div class="timeline"><span>{formatTime(position)}</span><div class="track"><i style={{ width: `${duration ? Math.min(100, position / duration * 100) : 0}%` }} /></div><span>{formatTime(duration)}</span></div>{current?.next && <p class="next">Up next: {current.next}</p>}</footer>
    {demo && <nav class="demo-modes" aria-label="Demo display modes">{(['player', 'lyrics', 'artwork'] as const).map((item) => <button onClick={() => setMode(item)} aria-pressed={mode === item}>{item}</button>)}</nav>}
  </main>;
}

function formatTime(ms: number) { const seconds = Math.floor(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
function identityKey(mediaId: string, queueEntryId: string) { return `${mediaId}\u0000${queueEntryId}`; }

render(<App />, document.getElementById('app')!);
