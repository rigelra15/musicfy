import { describe, expect, it } from 'vitest';
import { COVER_STYLE_OPTIONS } from '../../data/playerPreferences';
import { BUTTON_STYLES, DEFAULT_STUDIO, FLAGSHIP_COVERS, PRESETS, SEEKBAR_STYLES, effectiveCover, endTimestamp, hasDisc, parseStudio, shiftPx } from './studio';

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

describe('studio settings', () => {
  it('has the five Android presets, five button styles, four seek bars and all eight cover ids', () => {
    expect(PRESETS.map((p) => p.label)).toEqual(['Flagship', 'Turntable', 'Poster', 'Timeline', 'Lyrics stage']);
    expect(BUTTON_STYLES).toHaveLength(5);
    expect(SEEKBAR_STYLES).toHaveLength(4);
    expect(COVER_STYLE_OPTIONS).toHaveLength(8);
    expect(FLAGSHIP_COVERS.map((c) => c.id)).not.toContain('TURNTABLE');
    expect(FLAGSHIP_COVERS).toHaveLength(7);
  });

  it('falls back field by field for anything it does not understand', () => {
    expect(parseStudio(undefined)).toEqual(DEFAULT_STUDIO);
    expect(parseStudio('nonsense')).toEqual(DEFAULT_STUDIO);
    const parsed = parseStudio({ preset: 'NOPE', buttonStyle: 'M3_TONAL', seekBarStyle: 'X', endTimestamp: 'TIME_LEFT', controlsShift: 99, customLabel: 'x'.repeat(300), rotation: 'yes' });
    expect(parsed).toMatchObject({ preset: 'FLAGSHIP', buttonStyle: 'M3_TONAL', seekBarStyle: 'DEFAULT', endTimestamp: 'TIME_LEFT', controlsShift: 6, rotation: true });
    expect(parsed.customLabel).toHaveLength(120);
    expect(parseStudio({ controlsShift: -99 }).controlsShift).toBe(-6);
  });

  it('keeps the settings that were saved before the studio existed, and turns the old record-player cover into its preset', () => {
    const old = parseStudio({ coverStyle: 'DISC_BIG_LABEL', rotation: false, realistic: true, labelChoice: 'ARTIST_NAME', customLabel: '' });
    expect(old).toMatchObject({ preset: 'FLAGSHIP', coverStyle: 'DISC_BIG_LABEL', rotation: false, labelChoice: 'ARTIST_NAME' });
    const turntable = parseStudio({ coverStyle: 'TURNTABLE' });
    expect(turntable.preset).toBe('TURNTABLE');
    expect(turntable.coverStyle).toBe(DEFAULT_STUDIO.coverStyle);
    expect(parseStudio({ preset: 'FLAGSHIP', coverStyle: 'TURNTABLE' }).coverStyle).toBe(DEFAULT_STUDIO.coverStyle);
  });

  it('picks the cover each preset really draws', () => {
    const base = { ...DEFAULT_STUDIO, coverStyle: 'DISC_ALBUM' as const };
    expect(effectiveCover({ ...base, preset: 'FLAGSHIP' })).toBe('DISC_ALBUM');
    expect(effectiveCover({ ...base, preset: 'TURNTABLE' })).toBe('TURNTABLE');
    for (const preset of ['POSTER', 'TIMELINE', 'LYRICS'] as const) expect(effectiveCover({ ...base, preset })).toBe('SQUARED');
    expect(hasDisc({ ...base, preset: 'FLAGSHIP' })).toBe(true);
    expect(hasDisc({ ...base, preset: 'POSTER' })).toBe(false);
    expect(hasDisc({ ...base, preset: 'TURNTABLE' })).toBe(true);
  });

  it('shows the end time as total duration or as time left', () => {
    expect(endTimestamp({ endTimestamp: 'END_TIME' }, 65_000, 200_000, fmt)).toBe('3:20');
    expect(endTimestamp({ endTimestamp: 'TIME_LEFT' }, 65_000, 200_000, fmt)).toBe('-2:15');
    expect(endTimestamp({ endTimestamp: 'TIME_LEFT' }, 0, 0, fmt)).toBe('0:00');
    expect(endTimestamp({ endTimestamp: 'TIME_LEFT' }, 250_000, 200_000, fmt)).toBe('-0:00');
  });

  it('converts the position steps to pixels', () => {
    expect(shiftPx({ controlsShift: -3 })).toBe(-24);
    expect(shiftPx({ controlsShift: 0 })).toBe(0);
  });
});
