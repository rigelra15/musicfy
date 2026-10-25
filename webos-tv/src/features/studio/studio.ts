import { COVER_STYLE_OPTIONS, DEFAULT_PLAYER_PREFERENCES, DISC_LABEL_OPTIONS, type CoverStyle, type DiscLabelChoice, type PlayerPreferences } from '../../data/playerPreferences';

/**
 * Player Studio settings: what Android's "Edit player" changes, adapted to a TV where cover and
 * controls stay on the left and the lyrics on the right whatever preset is chosen.
 */
export const PRESETS = [
  { id: 'FLAGSHIP', label: 'Flagship' },
  { id: 'TURNTABLE', label: 'Turntable' },
  { id: 'POSTER', label: 'Poster' },
  { id: 'TIMELINE', label: 'Timeline' },
  { id: 'LYRICS', label: 'Lyrics stage' },
] as const;
export type PresetId = (typeof PRESETS)[number]['id'];

export const BUTTON_STYLES = [
  { id: 'DEFAULT', label: 'Default' },
  { id: 'M3_EXPRESSIVE', label: 'Material 3 Expressive' },
  { id: 'M3_EXPRESSIVE_PLAIN', label: 'Material 3 Expressive - no label' },
  { id: 'M3_TONAL', label: 'Material 3 tonal' },
  { id: 'LEGACY', label: 'Android legacy' },
] as const;
export type ButtonStyleId = (typeof BUTTON_STYLES)[number]['id'];

export const SEEKBAR_STYLES = [
  { id: 'DEFAULT', label: 'Default' },
  { id: 'M3_EXPRESSIVE', label: 'Material 3 Expressive 1' },
  { id: 'M3_EXPRESSIVE_LINE', label: 'Material 3 Expressive slider 2' },
  { id: 'PLAIN', label: 'Plain' },
] as const;
export type SeekBarStyleId = (typeof SEEKBAR_STYLES)[number]['id'];

export type EndTimestamp = 'END_TIME' | 'TIME_LEFT';

/** How far the controls row can be moved from its place, in steps of SHIFT_STEP px (down is positive). */
export const SHIFT_STEP = 8;
export const SHIFT_LIMIT = 6;

export interface StudioSettings extends PlayerPreferences {
  preset: PresetId;
  buttonStyle: ButtonStyleId;
  seekBarStyle: SeekBarStyleId;
  endTimestamp: EndTimestamp;
  /** Poster: bars around the cover that move with the music. Only honoured where the TV can analyse audio. */
  posterVisualizer: boolean;
  /** Controls moved from their usual place, in steps (negative is up). */
  controlsShift: number;
  /** Stops decorative motion (disc rotation, wavy seek bar, lyric transitions) whatever the system says. */
  reducedMotion: boolean;
}

export const PREF_STUDIO = 'player.appearance';

export const DEFAULT_STUDIO: StudioSettings = {
  ...DEFAULT_PLAYER_PREFERENCES,
  preset: 'FLAGSHIP',
  buttonStyle: 'DEFAULT',
  seekBarStyle: 'DEFAULT',
  endTimestamp: 'END_TIME',
  posterVisualizer: false,
  controlsShift: 0,
  reducedMotion: false,
};

const oneOf = <T extends string>(options: readonly { id: T }[], value: unknown, fallback: T): T =>
  options.some((option) => option.id === value) ? (value as T) : fallback;

/** Anything stored that is not understood falls back to the default for that field, never to a crash. */
export function parseStudio(value: unknown): StudioSettings {
  const stored = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const legacyTurntable = stored.coverStyle === 'TURNTABLE' && stored.preset === undefined;
  const coverStyle = oneOf<CoverStyle>(COVER_STYLE_OPTIONS, stored.coverStyle, DEFAULT_STUDIO.coverStyle);
  const shift = Number(stored.controlsShift);
  return {
    // The record player used to be one of the covers; it is a preset of its own now.
    preset: legacyTurntable ? 'TURNTABLE' : oneOf<PresetId>(PRESETS, stored.preset, 'FLAGSHIP'),
    coverStyle: coverStyle === 'TURNTABLE' ? DEFAULT_STUDIO.coverStyle : coverStyle,
    rotation: typeof stored.rotation === 'boolean' ? stored.rotation : DEFAULT_STUDIO.rotation,
    realistic: typeof stored.realistic === 'boolean' ? stored.realistic : DEFAULT_STUDIO.realistic,
    labelChoice: oneOf<DiscLabelChoice>(DISC_LABEL_OPTIONS, stored.labelChoice, DEFAULT_STUDIO.labelChoice),
    customLabel: typeof stored.customLabel === 'string' ? stored.customLabel.slice(0, 120) : '',
    buttonStyle: oneOf<ButtonStyleId>(BUTTON_STYLES, stored.buttonStyle, 'DEFAULT'),
    seekBarStyle: oneOf<SeekBarStyleId>(SEEKBAR_STYLES, stored.seekBarStyle, 'DEFAULT'),
    endTimestamp: stored.endTimestamp === 'TIME_LEFT' ? 'TIME_LEFT' : 'END_TIME',
    posterVisualizer: stored.posterVisualizer === true,
    controlsShift: Number.isFinite(shift) ? Math.max(-SHIFT_LIMIT, Math.min(SHIFT_LIMIT, Math.round(shift))) : 0,
    reducedMotion: stored.reducedMotion === true,
  };
}

/** The cover that is actually drawn: the record player forces its own, the compact presets use the plain square. */
export function effectiveCover(settings: StudioSettings): CoverStyle {
  switch (settings.preset) {
    case 'TURNTABLE': return 'TURNTABLE';
    case 'FLAGSHIP': return settings.coverStyle;
    default: return 'SQUARED';
  }
}

/** Covers the Cover editor offers: the record player belongs to the Turntable preset, as on Android. */
export const FLAGSHIP_COVERS = COVER_STYLE_OPTIONS.filter((option) => option.id !== 'TURNTABLE');

export const hasDisc = (settings: StudioSettings) => {
  const cover = effectiveCover(settings);
  return cover !== 'SQUARED' && cover !== 'EDGE_TO_EDGE';
};

/** "3:20" total or "-1:05" left, per the chosen end timestamp. */
export function endTimestamp(settings: Pick<StudioSettings, 'endTimestamp'>, positionMs: number, durationMs: number, format: (ms: number) => string): string {
  if (settings.endTimestamp === 'TIME_LEFT' && durationMs > 0) return `-${format(Math.max(0, durationMs - positionMs))}`;
  return format(durationMs);
}

export const shiftPx = (settings: Pick<StudioSettings, 'controlsShift'>) => settings.controlsShift * SHIFT_STEP;
