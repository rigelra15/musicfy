import { describe, expect, it } from 'vitest';
import type { Track } from '../model';
import { currentRoute } from './router';
import { appReducer, initialAppStore, type AppAction } from './store';

const track = (id: string): Track => ({ id, title: id, artist: 'A', durationMs: 1000 });
const run = (...actions: AppAction[]) => actions.reduce(appReducer, initialAppStore);

describe('app store', () => {
  it('mirrors "has a track" into navigation so Back from the queue knows where to go', () => {
    expect(initialAppStore.nav.hasTrack).toBe(false);
    const playing = run({ type: 'queue/replace', tracks: [track('a')], origin: 'manual' });
    expect(playing.nav.hasTrack).toBe(true);
    const cleared = appReducer(playing, { type: 'queue/clear' });
    expect(cleared.nav.hasTrack).toBe(true); // clearing keeps the song that is playing
    const removed = appReducer(playing, { type: 'queue/remove', entryId: playing.root.queue.currentEntryId! });
    expect(removed.nav.hasTrack).toBe(false);
  });

  it('navigating and opening overlays never touches playback or reloads the audio', () => {
    const playing = run({ type: 'queue/replace', tracks: [track('a'), track('b')], origin: 'manual' });
    const browsed = appReducer(appReducer(appReducer(playing, { type: 'nav/tab', tab: 'library' }), { type: 'nav/go', route: { name: 'album', id: 'MPREb_x' } }), { type: 'overlay/open', kind: 'actions' });
    expect(browsed.root).toBe(playing.root);
    expect(browsed.root.playToken).toBe(playing.root.playToken);
    expect(currentRoute(browsed.nav)).toEqual({ name: 'album', id: 'MPREb_x' });
    expect(browsed.overlays.stack).toHaveLength(1);
  });

  it('returns the same object when an action changes nothing', () => {
    expect(appReducer(initialAppStore, { type: 'overlay/close' })).toBe(initialAppStore);
    expect(appReducer(initialAppStore, { type: 'nav/back' })).toBe(initialAppStore);
  });
});
