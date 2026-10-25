import { useEffect, useRef } from 'preact/hooks';
import { useApp } from '../../app/AppContext';
import { ChunkedList } from '../../app/ChunkedList';
import { Icon } from '../../components/Icon';
import { Artwork } from '../../components/Artwork';
import { focusProps, formatDuration } from '../../app/format';
import { currentIndex, trackOfEntry } from '../../playback/queueModel';
import { PREF_AUTOPLAY } from '../../playback/radio';
import type { QueueEntry } from '../../domain/entity';

/** A song's length, or nothing at all when it is not known (never a placeholder). */
const lengthOf = (ms: number) => (ms > 0 ? formatDuration(ms) : '');

/** The queue, in the player's side area where the lyrics otherwise are: shuffle, repeat, autoplay, clear and the songs in order. */
export function QueuePanel() {
  const { store, dispatch, t, openOverlay, services } = useApp();
  const list = useRef<HTMLDivElement>(null);
  const autoplay = services.prefs.get(PREF_AUTOPLAY, true);
  const queue = store.root.queue;
  const playing = currentIndex(queue);
  const entries = queue.entries;

  function entryActions(entry: QueueEntry, index: number, openerFocusId: string) {
    openOverlay('actions', {
      openerFocusId,
      props: {
        title: trackOfEntry(queue, entry)?.title,
        actions: [
          { id: 'up', label: t('queue.moveUp'), disabled: index === 0, onSelect: () => dispatch({ type: 'queue/move', entryId: entry.entryId, toIndex: index - 1 }) },
          { id: 'down', label: t('queue.moveDown'), disabled: index >= entries.length - 1, onSelect: () => dispatch({ type: 'queue/move', entryId: entry.entryId, toIndex: index + 1 }) },
          { id: 'remove', label: t('queue.remove'), onSelect: () => dispatch({ type: 'queue/remove', entryId: entry.entryId }) },
        ],
      },
    });
  }

  // The song that is playing is brought into view when the queue opens.
  useEffect(() => {
    const current = list.current?.querySelector<HTMLElement>('.queue-row.is-current');
    if (current && typeof current.scrollIntoView === 'function') current.scrollIntoView({ block: 'center' });
  }, []);

  if (entries.length === 0) return <section class="queue-panel" aria-label={t('queue.title')}><p class="message-state">{t('queue.empty')}</p></section>;
  return (
    <section class="queue-panel" aria-label={t('queue.title')}>
      <div class="queue-header">
        <h2>{t('queue.title')}</h2>
        <div class="queue-tools">
          <button {...focusProps('queue-shuffle', 5, 0)} class={`chip-button ${queue.shuffle ? 'is-on' : ''}`} aria-pressed={queue.shuffle} onClick={() => dispatch({ type: 'queue/setShuffle', on: !queue.shuffle, seed: Date.now() % 2147483647 })}>
            <Icon name="shuffle" /> {t('queue.shuffle')}
          </button>
          <button {...focusProps('queue-repeat', 5, 1)} class={`chip-button ${queue.repeat !== 'off' ? 'is-on' : ''}`} onClick={() => dispatch({ type: 'queue/cycleRepeat' })}>
            <Icon name={queue.repeat === 'one' ? 'repeat-1' : 'repeat'} /> {t(`queue.repeat.${queue.repeat}` as 'queue.repeat.off')}
          </button>
          <button {...focusProps('queue-autoplay', 5, 2)} class={`chip-button ${autoplay ? 'is-on' : ''}`} aria-pressed={autoplay} onClick={() => void services.prefs.set(PREF_AUTOPLAY, !autoplay).catch(() => undefined)}>
            <Icon name="radio" /> {t('queue.autoplay')}
          </button>
          <button {...focusProps('queue-clear', 5, 3, entries.length <= 1)} class="chip-button" onClick={() => dispatch({ type: 'queue/clear' })}>
            <Icon name="trash-2" /> {t('queue.clear')}
          </button>
        </div>
      </div>
      <div class="queue-list" ref={list}>
        <ChunkedList class="queue-items" chunk={60} reveal={Math.max(0, playing)} items={entries} render={(entry, index) => {
          const track = trackOfEntry(queue, entry);
          if (!track) return null;
          return (
            <div class="queue-line" key={entry.entryId}>
              <button
                {...focusProps(`queue-${entry.entryId}`, index + 6, 0)}
                class={`queue-row ${index === playing ? 'is-current' : ''}`}
                aria-current={index === playing ? 'true' : undefined}
                onClick={() => dispatch({ type: 'queue/playEntry', entryId: entry.entryId })}
              >
                <span class="queue-index">{String(index + 1).padStart(2, '0')}</span>
                <Artwork track={track} size="small" />
                <span class="result-copy"><span class="result-title">{track.title}</span><span class="result-artist">{track.artist}</span></span>
                <span class="result-duration">{lengthOf(index === playing ? store.root.playback.durationMs || track.durationMs : track.durationMs)}</span>
              </button>
              <button {...focusProps(`queue-more-${entry.entryId}`, index + 6, 1)} class="icon-button row-more" aria-label={t('common.more')} onClick={() => entryActions(entry, index, `queue-more-${entry.entryId}`)}>
                <Icon name="ellipsis" />
              </button>
            </div>
          );
        }} />
      </div>
    </section>
  );
}
