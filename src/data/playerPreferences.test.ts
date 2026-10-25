import { describe, expect, it } from 'vitest';
import { COVER_STYLE_OPTIONS, DEFAULT_PLAYER_PREFERENCES, PLAYER_PREFERENCES_KEY, discLabelForTrack,
  readPlayerPreferences, writePlayerPreferences } from './playerPreferences';

describe('player appearance preferences', () => {
  it('offers every mobile cover style exactly once', () => {
    expect(COVER_STYLE_OPTIONS.map(({ id }) => id)).toEqual([
      'EDGE_TO_EDGE', 'SQUARED', 'DISC_SMALL_FULL', 'DISC_SMALL_LABEL',
      'DISC_BIG_FULL', 'DISC_BIG_LABEL', 'DISC_ALBUM', 'TURNTABLE',
    ]);
  });
  it('handles unavailable storage and damaged JSON safely', () => {
    expect(readPlayerPreferences({ getItem: () => { throw new Error('denied'); } })).toEqual(DEFAULT_PLAYER_PREFERENCES);
    expect(readPlayerPreferences({ getItem: () => '{invalid' })).toEqual(DEFAULT_PLAYER_PREFERENCES);
    expect(writePlayerPreferences(DEFAULT_PLAYER_PREFERENCES, { setItem: () => { throw new Error('full'); } })).toBe(false);
  });
  it('validates each stored option rather than trusting old or arbitrary values', () => {
    expect(readPlayerPreferences({ getItem: () => JSON.stringify({
      coverStyle: 'unknown', rotation: false, realistic: 'true', labelChoice: 'ARTIST_NAME', customLabel: 42,
    }) })).toEqual({ ...DEFAULT_PLAYER_PREFERENCES, rotation: false, labelChoice: 'ARTIST_NAME' });
  });
  it('stores and restores chosen settings', () => {
    let data = '';
    const preferences = { ...DEFAULT_PLAYER_PREFERENCES, coverStyle: 'DISC_ALBUM' as const, customLabel: 'Musicfy' };
    expect(writePlayerPreferences(preferences, { setItem: (key, value) => { expect(key).toBe(PLAYER_PREFERENCES_KEY); data = value; } })).toBe(true);
    expect(readPlayerPreferences({ getItem: () => data })).toEqual(preferences);
  });
  it('resolves all mobile disc label choices and omits missing album text', () => {
    const track = { title: 'Song', artist: 'Artist', album: 'Album' };
    const values = ['Mine', 'Song', 'Artist', 'Album', 'Song · Artist', ''];
    (['CUSTOM', 'MUSIC_NAME', 'ARTIST_NAME', 'ALBUM_NAME', 'MUSIC_AND_ARTIST', 'NONE'] as const).forEach((labelChoice, i) => {
      expect(discLabelForTrack(track, { ...DEFAULT_PLAYER_PREFERENCES, labelChoice, customLabel: ' Mine ' })).toBe(values[i]);
    });
    expect(discLabelForTrack({ title: 'Song', artist: 'Artist' }, { ...DEFAULT_PLAYER_PREFERENCES, labelChoice: 'ALBUM_NAME' })).toBe('');
  });
});
