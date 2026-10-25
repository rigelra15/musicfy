import { useApp } from '../../app/AppContext';
import { focusProps } from '../../app/format';
import { Artwork } from '../../components/Artwork';
import { Icon } from '../../components/Icon';
import { LyricsIntro } from '../../components/LyricsIntro';
import { trackOfEntry, currentIndex } from '../../playback/queueModel';
import { useSnapshot } from '../../app/useSnapshot';
import { TimedLine } from '../../components/LyricsView';
import { useSungLine } from './useSungLine';

/**
 * The card at the bottom edge of the player, as on the phone: glass with a faint white border, rounded at the top and
 * running off the bottom of the screen. It always offers the page that is not showing: the line being sung while the
 * queue is open, the next song while the lyrics are open. Selecting the preview opens that page; the panel buttons share the same glass card.
 */
export function PlayerDeck() {
  const { store, t, playerPanel } = useApp();
  const panel = useSnapshot(playerPanel);
  const sung = useSungLine();
  const queue = store.root.queue;
  const index = currentIndex(queue);
  const next = index >= 0 ? trackOfEntry(queue, queue.entries[index + 1]) : null;
  const showLyric = panel === 'queue';
  const open = () => playerPanel.set(showLyric ? 'lyrics' : 'queue');
  return (
    <div class="player-deck" data-front={showLyric ? 'lyric' : 'next'}>
      <div class="deck-card deck-front">
        <button {...focusProps('player-deck', 880, 0)} class="deck-preview" aria-label={showLyric ? t('deck.openLyrics') : t('deck.openQueue')} onClick={open}>
          {showLyric ? (
            <span class={`deck-lyric lyrics-motion-${sung.motion === 'LEGACY' ? 'legacy' : 'motion'}`}>
              {sung.synced && sung.index < 0 ? <LyricsIntro positionMs={sung.time} endMs={sung.introEndMs ?? 0} /> : sung.synced && sung.line
                // the line is painted the way the lyrics page paints it: words or syllables fill as they are sung
                ? <span class="lyrics-line is-active deck-lyric-line" key={sung.index}><TimedLine line={sung.line} positionMs={sung.time} detail={sung.detail} /></span>
                : <span class="deck-lyric-line is-dim" key="none">{sung.loaded && !sung.synced ? t('deck.noLyrics') : ''}</span>}
            </span>
          ) : (
            <span class="deck-next">
              {next ? <Artwork track={next} size="small" /> : <span class="deck-next-art" aria-hidden="true" />}
              <span class="deck-next-copy">
                <span class="deck-next-label">{t('deck.nextSong')}</span>
                <span class={`deck-next-title ${next ? '' : 'is-dim'}`}>{next ? [next.title, next.artist].filter(Boolean).join(' - ') : t('deck.endOfQueue')}</span>
              </span>
            </span>
          )}
        </button>
        <div class="deck-panel-controls" role="group">
          <button {...focusProps('player-stack-lyrics', 880, 1)} class={`stack-card ${panel === 'lyrics' ? 'is-on' : ''}`} aria-pressed={panel === 'lyrics'} onClick={() => playerPanel.set('lyrics')}><Icon name="mic" /><span>{t('player.stack.lyrics')}</span></button>
          <button {...focusProps('player-stack-queue', 880, 2)} class={`stack-card ${panel === 'queue' ? 'is-on' : ''}`} aria-pressed={panel === 'queue'} onClick={() => playerPanel.set('queue')}><Icon name="list-music" /><span>{t('player.stack.queue')}</span></button>
        </div>
      </div>
    </div>
  );
}
