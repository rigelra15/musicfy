import { describe, expect, it } from 'vitest';
import { appStateReducer, getBackView, initialAppState } from './appState';
import type { Track } from './model';

const track: Track = {
  id: 'music-1',
  title: 'Malam di Kota',
  artist: 'Senja',
  artworkUrl: 'https://img.example/cover.jpg',
  durationMs: 182_000,
};

describe('app state', () => {
  it('starts on search with no queue and idle playback', () => {
    expect(initialAppState).toMatchObject({
      view: 'search',
      searchStatus: 'idle',
      results: [],
      queue: [],
      currentTrackIndex: -1,
      playback: { status: 'idle', positionMs: 0, durationMs: 0 },
    });
  });

  it('selects a queued duplicate by index without deleting either entry', () => {
    const twiceQueued = appStateReducer(
      appStateReducer(initialAppState, { type: 'queue/added', track }),
      { type: 'queue/added', track },
    );
    const selected = appStateReducer(twiceQueued, { type: 'queue/selected', index: 1 });

    expect(selected.queue).toEqual([track, track]);
    expect(selected.currentTrackIndex).toBe(1);
    expect(selected.view).toBe('player');
  });

  it('keeps the current query when search results arrive', () => {
    const searching = appStateReducer(initialAppState, {
      type: 'query/changed',
      query: 'Malam di Kota',
    });
    const complete = appStateReducer(searching, {
      type: 'search/succeeded',
      requestId: 1,
      tracks: [track],
    });

    expect(complete.searchQuery).toBe('Malam di Kota');
    expect(complete.results).toEqual([track]);
    expect(complete.searchStatus).toBe('success');
  });

  it('clears results from the previous query when a new query is entered', () => {
    const previousSearch = appStateReducer(initialAppState, {
      type: 'search/succeeded',
      requestId: 0,
      tracks: [track],
    });
    const nextSearch = appStateReducer(previousSearch, {
      type: 'query/changed',
      query: 'Lagu baru',
    });

    expect(nextSearch.searchQuery).toBe('Lagu baru');
    expect(nextSearch.results).toEqual([]);
    expect(nextSearch.searchStatus).toBe('idle');
  });

  it('ignores late success and failure from a superseded search request', () => {
    const firstQuery = appStateReducer(initialAppState, {
      type: 'query/changed',
      query: 'Lagu A',
      requestId: 1,
    });
    const firstRequest = appStateReducer(firstQuery, {
      type: 'search/started',
      requestId: 1,
    });
    const secondQuery = appStateReducer(firstRequest, {
      type: 'query/changed',
      query: 'Lagu B',
      requestId: 2,
    });

    const lateSuccess = appStateReducer(secondQuery, {
      type: 'search/succeeded',
      requestId: 1,
      tracks: [track],
    });
    const lateFailure = appStateReducer(secondQuery, {
      type: 'search/failed',
      requestId: 1,
      error: 'Kegagalan lama',
    });

    expect(lateSuccess).toBe(secondQuery);
    expect(lateFailure).toBe(secondQuery);
  });

  it('stores the selected lyrics document and clears a previous lyrics error', () => {
    const document = { type: 'synced' as const, lines: [{ timeMs: 1000, text: 'Lirik' }] };
    const failed = appStateReducer(initialAppState, {
      type: 'lyrics/updated',
      status: 'error',
      error: 'Gagal memuat',
    });
    const loaded = appStateReducer(failed, {
      type: 'lyrics/updated',
      status: 'synced',
      document,
    });

    expect(loaded.lyricsDocument).toEqual(document);
    expect(loaded.lyricsError).toBeUndefined();
  });

  it('ignores a queue selection outside the available indices', () => {
    const unchanged = appStateReducer(initialAppState, { type: 'queue/selected', index: 0 });

    expect(unchanged.currentTrackIndex).toBe(-1);
    expect(unchanged.view).toBe('search');
  });

  it('advances once through duplicate queue entries when a track ends and preserves the current view', () => {
    const queued = appStateReducer(
      appStateReducer(initialAppState, { type: 'queue/added', track }),
      { type: 'queue/added', track },
    );
    const selected = appStateReducer(queued, { type: 'queue/selected', index: 0 });
    const loaded = appStateReducer(selected, {
      type: 'playback/updated',
      snapshot: { status: 'playing', positionMs: 0, durationMs: track.durationMs, loadId: 9 },
    });
    const lyricsView = appStateReducer(loaded, { type: 'view/changed', view: 'lyrics' });
    const ended = appStateReducer(lyricsView, {
      type: 'playback/updated',
      snapshot: { status: 'ended', positionMs: track.durationMs, durationMs: track.durationMs, loadId: 9 },
    });
    const staleEnded = appStateReducer(ended, {
      type: 'playback/updated',
      snapshot: { status: 'ended', positionMs: track.durationMs, durationMs: track.durationMs, loadId: 9 },
    });

    expect(ended.currentTrackIndex).toBe(1);
    expect(ended.view).toBe('lyrics');
    expect(ended.playback.status).toBe('loading');
    expect(staleEnded).toBe(ended);
  });

  it('does not advance past the final track or accept an end from a previously selected track', () => {
    const nextTrack = { ...track, id: 'music-2', title: 'Lagu Berikutnya' };
    const queued = appStateReducer(
      appStateReducer(initialAppState, { type: 'queue/added', track }),
      { type: 'queue/added', track: nextTrack },
    );
    const first = appStateReducer(queued, { type: 'queue/selected', index: 0 });
    const firstLoaded = appStateReducer(first, {
      type: 'playback/updated',
      snapshot: { status: 'playing', positionMs: 0, durationMs: track.durationMs, loadId: 1 },
    });
    const second = appStateReducer(firstLoaded, { type: 'queue/selected', index: 1 });
    const staleEnd = appStateReducer(second, {
      type: 'playback/updated',
      snapshot: { status: 'ended', positionMs: track.durationMs, durationMs: track.durationMs, loadId: 1 },
    });
    const secondLoaded = appStateReducer(staleEnd, {
      type: 'playback/updated',
      snapshot: { status: 'playing', positionMs: 0, durationMs: nextTrack.durationMs, loadId: 2 },
    });
    const finalEnd = appStateReducer(secondLoaded, {
      type: 'playback/updated',
      snapshot: { status: 'ended', positionMs: nextTrack.durationMs, durationMs: nextTrack.durationMs, loadId: 2 },
    });

    expect(staleEnd.currentTrackIndex).toBe(1);
    expect(finalEnd.currentTrackIndex).toBe(1);
    expect(finalEnd.playback.status).toBe('ended');
  });

  it.each([
    ['queue', false, 'search'],
    ['lyrics', false, 'search'],
    ['queue', true, 'player'],
    ['lyrics', true, 'player'],
    ['player', true, 'search'],
  ] as const)('returns from %s to the appropriate view', (view, hasTrack, expected) => {
    expect(getBackView(view, hasTrack)).toBe(expected);
  });
});

it('keeps playback when selecting the current queue item again', () => {
  const state = { ...initialAppState, view: 'queue' as const, queue: [{id:'current',title:'Song',artist:'Artist',durationMs:180000}], currentTrackIndex: 0, playback: {status:'playing' as const,positionMs:25000,durationMs:180000,loadId:4} };
  const result = appStateReducer(state,{type:'queue/selected',index:0});
  expect(result.view).toBe('player');
  expect(result.playback).toBe(state.playback);
});
