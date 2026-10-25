import { StorageError, openIndexedDb, wrapStorageError, type Db } from '../library/db';
import { migrateLegacyPreferences, type MigrationReport } from '../library/migrations';
import { PreferencesStore } from '../library/preferences';
import { LibraryRepository } from '../library/repository';
import { CapabilityRegistry } from '../platform/capabilities';
import { tr } from './i18n';

export interface Services {
  repo: LibraryRepository;
  prefs: PreferencesStore;
  capabilities: CapabilityRegistry;
  migration: MigrationReport;
}

export type ServicesResult =
  | { ok: true; services: Services }
  | { ok: false; error: StorageError };

export interface OpenServicesOptions {
  /** Test seam: supply an already-open database instead of IndexedDB. */
  db?: Db;
  factory?: IDBFactory;
  dbName?: string;
  storage?: Pick<Storage, 'getItem'>;
  audio?: { canPlayType(type: string): string } | null;
}

function legacyStorage(): Pick<Storage, 'getItem'> | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; } catch { return undefined; }
}

/**
 * Opens persistent storage and wires the repository, preferences and capability registry.
 * Failure is returned, not hidden: there is deliberately no in-memory fallback, because a
 * collection that looks saved but vanishes on relaunch is worse than a clear error.
 */
export async function openServices(options: OpenServicesOptions = {}): Promise<ServicesResult> {
  const capabilities = new CapabilityRegistry();
  const factory = options.factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);
  capabilities.probe({ indexedDb: options.db ?? factory, audioElement: options.audio });
  try {
    let db = options.db;
    if (!db) {
      if (!factory) throw new StorageError('failed', tr('err.storage.unavailable'));
      db = await openIndexedDb(options.dbName ?? 'musicfy', factory);
    }
    const repo = new LibraryRepository(db);
    const migration = await migrateLegacyPreferences(repo, options.storage ?? legacyStorage());
    await repo.repairTrackArtists().catch(() => 0);
    const prefs = new PreferencesStore(repo);
    await prefs.hydrate();
    capabilities.record('storage.indexeddb', { status: 'supported', evidence: 'local-browser', reason: 'cap.idb.open' });
    return { ok: true, services: { repo, prefs, capabilities, migration } };
  } catch (error) {
    const wrapped = error instanceof StorageError ? error : wrapStorageError(error);
    capabilities.record('storage.indexeddb', { status: 'unsupported', evidence: 'local-browser', reason: wrapped.message });
    return { ok: false, error: wrapped };
  }
}
