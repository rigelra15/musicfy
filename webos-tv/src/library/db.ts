import { tr } from '../app/i18n';
/**
 * Versioned persistence for the TV. IndexedDB in the packaged app; an in-memory twin with the same
 * transaction semantics (all-or-nothing) for contract tests.
 *
 * Transaction callbacks may only await operations on the `Tx` they are given: IndexedDB commits as
 * soon as the event loop is idle, so awaiting anything else would silently end the transaction.
 */
export const STORE_DEFS = {
  tracks: { keyPath: 'trackKey' },
  library: { keyPath: 'trackKey' },
  likes: { keyPath: 'trackKey' },
  pins: { keyPath: 'key' },
  savedEntities: { keyPath: 'key' },
  playlists: { keyPath: 'id' },
  playlistEntries: { keyPath: 'entryId', indexes: { playlistId: 'playlistId' } },
  history: { keyPath: 'id', indexes: { trackKey: 'trackKey' } },
  lyricsEdits: { keyPath: 'trackKey' },
  lyricsChoice: { keyPath: 'trackKey' },
  prefs: { keyPath: 'key' },
  session: { keyPath: 'key' },
  assets: { keyPath: 'assetId', indexes: { trackKey: 'trackKey' } },
  mappings: { keyPath: 'id' },
  searchHistory: { keyPath: 'query' },
  importLog: { keyPath: 'id' },
  meta: { keyPath: 'key' },
} as const satisfies Record<string, { keyPath: string; indexes?: Record<string, string> }>;

export type StoreName = keyof typeof STORE_DEFS;
export const STORE_NAMES = Object.keys(STORE_DEFS) as StoreName[];
export const SCHEMA_VERSION = 1;

export type StorageErrorKind = 'quota' | 'failed' | 'closed';

export class StorageError extends Error {
  readonly name = 'StorageError';
  constructor(readonly kind: StorageErrorKind, message: string, readonly cause?: unknown) {
    super(message);
  }
}

export interface Tx {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  getAll<T>(store: StoreName): Promise<T[]>;
  getAllBy<T>(store: StoreName, index: string, value: string): Promise<T[]>;
  put(store: StoreName, value: object): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  clear(store: StoreName): Promise<void>;
}

export interface Db {
  tx<T>(stores: readonly StoreName[], mode: 'r' | 'rw', fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): void;
}

export function wrapStorageError(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  const name = (error as { name?: string } | undefined)?.name;
  if (name === 'QuotaExceededError') {
    return new StorageError('quota', tr('err.storage.full'), error);
  }
  return new StorageError('failed', tr('err.storage.failed'), error);
}

// ---------------------------------------------------------------------------------------------
// In-memory twin

interface MemoryOptions {
  /** Total records allowed across all stores; exceeding it fails the write like a full disk. */
  maxRecords?: number;
}

export class MemoryDb implements Db {
  private data = new Map<StoreName, Map<string, string>>();
  private chain: Promise<unknown> = Promise.resolve();
  private closed = false;
  /** Test hook: fail the Nth write of the next transaction. */
  failWriteNumber: number | undefined;

  constructor(private readonly options: MemoryOptions = {}) {
    for (const name of STORE_NAMES) this.data.set(name, new Map());
  }

  tx<T>(stores: readonly StoreName[], mode: 'r' | 'rw', fn: (tx: Tx) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      if (this.closed) throw new StorageError('closed', tr('err.storage.closed'));
      const scope = new Set<StoreName>(stores);
      const working = new Map<StoreName, Map<string, string>>();
      for (const name of scope) working.set(name, new Map(this.data.get(name)));
      let writes = 0;
      const failAt = this.failWriteNumber;
      this.failWriteNumber = undefined;
      const total = () => {
        let count = 0;
        for (const [name, map] of this.data) count += scope.has(name) ? working.get(name)!.size : map.size;
        return count;
      };
      const storeOf = (name: StoreName): Map<string, string> => {
        const map = working.get(name);
        if (!map) throw new StorageError('failed', `Store ${name} is outside this transaction`);
        return map;
      };
      const keyOf = (name: StoreName, value: object): string => {
        const key = (value as Record<string, unknown>)[STORE_DEFS[name].keyPath];
        if (typeof key !== 'string' || key.length === 0) throw new StorageError('failed', `Record without ${name} key`);
        return key;
      };
      const api: Tx = {
        get: async <V>(name: StoreName, key: string) => {
          const raw = storeOf(name).get(key);
          return raw === undefined ? undefined : (JSON.parse(raw) as V);
        },
        getAll: async <V>(name: StoreName) => [...storeOf(name).values()].map((raw) => JSON.parse(raw) as V),
        getAllBy: async <V>(name: StoreName, index: string, value: string) => {
          const def = STORE_DEFS[name] as { indexes?: Record<string, string> };
          const path = def.indexes?.[index];
          if (!path) throw new StorageError('failed', `Unknown index ${name}.${index}`);
          return [...storeOf(name).values()]
            .map((raw) => JSON.parse(raw) as V)
            .filter((item) => (item as Record<string, unknown>)[path] === value);
        },
        put: async (name, value) => {
          if (mode === 'r') throw new StorageError('failed', 'Read-only transaction');
          writes += 1;
          if (failAt !== undefined && writes === failAt) throw new StorageError('quota', tr('err.storage.full'));
          const map = storeOf(name);
          const key = keyOf(name, value);
          const isNew = !map.has(key);
          map.set(key, JSON.stringify(value));
          if (isNew && this.options.maxRecords !== undefined && total() > this.options.maxRecords) {
            throw new StorageError('quota', tr('err.storage.full'));
          }
        },
        delete: async (name, key) => {
          if (mode === 'r') throw new StorageError('failed', 'Read-only transaction');
          storeOf(name).delete(key);
        },
        clear: async (name) => {
          if (mode === 'r') throw new StorageError('failed', 'Read-only transaction');
          storeOf(name).clear();
        },
      };
      const result = await fn(api);
      if (mode === 'rw') for (const [name, map] of working) this.data.set(name, map);
      return result;
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next.catch((error) => {
      throw wrapStorageError(error);
    });
  }

  close(): void {
    this.closed = true;
  }
}

export function createMemoryDb(options?: MemoryOptions): MemoryDb {
  return new MemoryDb(options);
}

// ---------------------------------------------------------------------------------------------
// IndexedDB

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function openIndexedDb(name = 'musicfy', factory: IDBFactory = indexedDB): Promise<Db> {
  return new Promise((resolve, reject) => {
    const open = factory.open(name, SCHEMA_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      for (const storeName of STORE_NAMES) {
        if (db.objectStoreNames.contains(storeName)) continue;
        const def = STORE_DEFS[storeName] as { keyPath: string; indexes?: Record<string, string> };
        const store = db.createObjectStore(storeName, { keyPath: def.keyPath });
        for (const [indexName, path] of Object.entries(def.indexes ?? {})) store.createIndex(indexName, path);
      }
    };
    open.onerror = () => reject(wrapStorageError(open.error));
    open.onblocked = () => reject(new StorageError('failed', tr('err.storage.busy')));
    open.onsuccess = () => {
      const db = open.result;
      db.onversionchange = () => db.close();
      resolve(new IdbDb(db));
    };
  });
}

class IdbDb implements Db {
  constructor(private readonly db: IDBDatabase) {}

  tx<T>(stores: readonly StoreName[], mode: 'r' | 'rw', fn: (tx: Tx) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let transaction: IDBTransaction;
      try {
        transaction = this.db.transaction([...stores], mode === 'r' ? 'readonly' : 'readwrite');
      } catch (error) {
        reject(wrapStorageError(error));
        return;
      }
      let result: T;
      let failure: unknown;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(wrapStorageError(failure ?? transaction.error));
      const store = (name: StoreName) => transaction.objectStore(name);
      const api: Tx = {
        get: async <V>(name: StoreName, key: string) => (await request(store(name).get(key))) as V | undefined,
        getAll: async <V>(name: StoreName) => (await request(store(name).getAll())) as V[],
        getAllBy: async <V>(name: StoreName, index: string, value: string) =>
          (await request(store(name).index(index).getAll(value))) as V[],
        put: async (name, value) => {
          await request(store(name).put(value));
        },
        delete: async (name, key) => {
          await request(store(name).delete(key));
        },
        clear: async (name) => {
          await request(store(name).clear());
        },
      };
      Promise.resolve()
        .then(() => fn(api))
        .then(
          (value) => {
            result = value;
          },
          (error) => {
            failure = error;
            try {
              transaction.abort();
            } catch {
              reject(wrapStorageError(error));
            }
          },
        );
    });
  }

  close(): void {
    this.db.close();
  }
}
