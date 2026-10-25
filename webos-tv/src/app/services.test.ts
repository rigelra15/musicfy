import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createMemoryDb } from '../library/db';
import { openServices } from './services';

const legacy = (values: Record<string, string>) => ({ getItem: (key: string) => values[key] ?? null });

describe('openServices', () => {
  it('opens IndexedDB, migrates legacy preferences once and hydrates the store', async () => {
    const factory = new IDBFactory();
    const storage = legacy({ 'musicfy.tv.lyrics.detail': 'word' , 'musicfy.tv.lyrics.motion': 'bounce'});
    const first = await openServices({ factory, dbName: 't1', storage });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.services.migration.migrated).toEqual(expect.arrayContaining(['lyrics.detail']));
    expect(first.services.prefs.get('lyrics.detail', '')).toBe('word');
    expect(first.services.capabilities.get('storage.indexeddb').status).toBe('supported');
    const second = await openServices({ factory, dbName: 't1', storage: legacy({ 'musicfy.tv.lyrics.detail': 'line' }) });
    expect(second.ok && second.services.prefs.get('lyrics.detail', '')).toBe('word');
    expect(second.ok && second.services.migration.migrated).not.toContain('lyrics.detail');
  });

  it('reports a clear failure and no fallback when storage cannot open', async () => {
    const broken = { open() { throw new Error('boom'); } } as unknown as IDBFactory;
    const failed = await openServices({ factory: broken, storage: legacy({}) });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.name).toBe('StorageError');
  });

  it('uses an injected database', async () => {
    const result = await openServices({ db: createMemoryDb(), storage: legacy({}) });
    expect(result.ok).toBe(true);
  });
});
