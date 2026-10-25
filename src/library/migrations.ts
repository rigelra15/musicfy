import { SCHEMA_VERSION } from './db';
import type { LibraryRepository } from './repository';
import { readPlayerPreferences, PLAYER_PREFERENCES_KEY } from '../data/playerPreferences';

export const PREF_PLAYER_APPEARANCE = 'player.appearance';
export const PREF_LYRICS_DETAIL = 'lyrics.detail';
export const PREF_LYRICS_MOTION = 'lyrics.motion';
export const PREF_LYRICS_SOURCE = 'lyrics.source';

const LEGACY_LYRICS_KEYS: Array<[string, string, readonly string[] | undefined]> = [
  ['musicfy.tv.lyrics.detail', PREF_LYRICS_DETAIL, ['auto', 'line', 'word', 'syllable']],
  ['musicfy.tv.lyrics.motion', PREF_LYRICS_MOTION, ['MOTION', 'LEGACY']],
  ['musicfy.tv.lyrics.source', PREF_LYRICS_SOURCE, undefined],
];

type LegacyStorage = Pick<Storage, 'getItem'>;

export interface MigrationReport {
  schemaVersion: number;
  migrated: string[];
}

/**
 * Copies the preferences that 0.3.0 kept in localStorage into the repository. Idempotent: a value
 * that already exists in the repository is never overwritten, and the legacy keys are left alone
 * (an older build keeps working if the user ever reinstalls it).
 */
export async function migrateLegacyPreferences(
  repository: LibraryRepository,
  storage: LegacyStorage | undefined,
): Promise<MigrationReport> {
  const migrated: string[] = [];
  const existing = await repository.getAllPrefs();
  if (storage) {
    if (!(PREF_PLAYER_APPEARANCE in existing) && storage.getItem(PLAYER_PREFERENCES_KEY) !== null) {
      await repository.setPref(PREF_PLAYER_APPEARANCE, readPlayerPreferences(storage));
      migrated.push(PREF_PLAYER_APPEARANCE);
    }
    for (const [legacyKey, key, allowed] of LEGACY_LYRICS_KEYS) {
      if (key in existing) continue;
      let value: string | null = null;
      try {
        value = storage.getItem(legacyKey);
      } catch {
        value = null;
      }
      if (!value || value.length > 64) continue;
      if (allowed && !allowed.includes(value)) continue;
      await repository.setPref(key, value);
      migrated.push(key);
    }
  }
  await repository.transaction(['meta'], async (tx) => {
    await tx.put('meta', { key: 'schemaVersion', value: SCHEMA_VERSION });
    await tx.put('meta', { key: 'legacyPrefsMigratedAt', value: Date.now() });
  });
  return { schemaVersion: SCHEMA_VERSION, migrated };
}
