import { useCallback, useState } from 'preact/hooks';

export const COVER_STYLE_OPTIONS = [
  { id: 'EDGE_TO_EDGE', label: 'Full edge to edge' },
  { id: 'SQUARED', label: 'Squared' },
  { id: 'DISC_SMALL_FULL', label: 'Disc Music - inside - small' },
  { id: 'DISC_SMALL_LABEL', label: 'Disc Music - label - small' },
  { id: 'DISC_BIG_FULL', label: 'Disc Music - inside - big' },
  { id: 'DISC_BIG_LABEL', label: 'Disc Music - label - big' },
  { id: 'DISC_ALBUM', label: 'Disc + album Music' },
  { id: 'TURNTABLE', label: 'Turntable' },
] as const;
export type CoverStyle = typeof COVER_STYLE_OPTIONS[number]['id'];

export const DISC_LABEL_OPTIONS = [
  { id: 'CUSTOM', label: 'Custom' },
  { id: 'MUSIC_NAME', label: 'Music name' },
  { id: 'ARTIST_NAME', label: 'Artist name' },
  { id: 'ALBUM_NAME', label: 'Album name' },
  { id: 'MUSIC_AND_ARTIST', label: 'Music and artist' },
  { id: 'NONE', label: 'None' },
] as const;
export type DiscLabelChoice = typeof DISC_LABEL_OPTIONS[number]['id'];

export interface PlayerPreferences {
  coverStyle: CoverStyle;
  rotation: boolean;
  realistic: boolean;
  labelChoice: DiscLabelChoice;
  customLabel: string;
}
export const DEFAULT_PLAYER_PREFERENCES: PlayerPreferences = {
  coverStyle: 'SQUARED', rotation: true, realistic: true, labelChoice: 'CUSTOM', customLabel: '',
};
export const PLAYER_PREFERENCES_KEY = 'musicfy.tv.playerAppearance.v1';

function browserStorage(): Storage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; } catch { return undefined; }
}

export function readPlayerPreferences(
  storage: Pick<Storage, 'getItem'> | undefined = browserStorage(),
): PlayerPreferences {
  try {
    const value: unknown = JSON.parse(storage?.getItem(PLAYER_PREFERENCES_KEY) ?? 'null');
    if (!value || typeof value !== 'object') return { ...DEFAULT_PLAYER_PREFERENCES };
    const stored = value as Record<string, unknown>;
    return {
      coverStyle: COVER_STYLE_OPTIONS.some(({ id }) => id === stored.coverStyle)
        ? stored.coverStyle as CoverStyle : DEFAULT_PLAYER_PREFERENCES.coverStyle,
      rotation: typeof stored.rotation === 'boolean' ? stored.rotation : true,
      realistic: typeof stored.realistic === 'boolean' ? stored.realistic : true,
      labelChoice: DISC_LABEL_OPTIONS.some(({ id }) => id === stored.labelChoice)
        ? stored.labelChoice as DiscLabelChoice : DEFAULT_PLAYER_PREFERENCES.labelChoice,
      customLabel: typeof stored.customLabel === 'string' ? stored.customLabel.slice(0, 120) : '',
    };
  } catch { return { ...DEFAULT_PLAYER_PREFERENCES }; }
}

export function writePlayerPreferences(
  preferences: PlayerPreferences, storage: Pick<Storage, 'setItem'> | undefined = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PLAYER_PREFERENCES_KEY, JSON.stringify(preferences));
    return true;
  } catch { return false; }
}

type PreferencesUpdate = Partial<PlayerPreferences> | ((current: PlayerPreferences) => PlayerPreferences);
export function usePlayerPreferences(): [PlayerPreferences, (update: PreferencesUpdate) => void] {
  const [preferences, setPreferences] = useState<PlayerPreferences>(() => readPlayerPreferences());
  const updatePreferences = useCallback((update: PreferencesUpdate) => {
    setPreferences((current) => {
      const next = typeof update === 'function' ? update(current) : { ...current, ...update };
      writePlayerPreferences(next);
      return next;
    });
  }, []);
  return [preferences, updatePreferences];
}

export function discLabelForTrack(
  track: { title: string; artist: string; album?: string },
  preferences: Pick<PlayerPreferences, 'labelChoice' | 'customLabel'>,
): string {
  switch (preferences.labelChoice) {
    case 'CUSTOM': return preferences.customLabel.trim();
    case 'MUSIC_NAME': return track.title;
    case 'ARTIST_NAME': return track.artist;
    case 'ALBUM_NAME': return track.album ?? '';
    case 'MUSIC_AND_ARTIST': return [track.title, track.artist].filter(Boolean).join(' · ');
    case 'NONE': return '';
  }
}
