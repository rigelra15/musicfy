import type { LibraryRepository } from './repository';

type Listener = () => void;

/**
 * Synchronous reads for the UI, durable writes through the repository. A write that fails is
 * reported to the caller and the visible value is not changed, so the screen never shows a setting
 * that was not saved.
 */
export class PreferencesStore {
  private values: Record<string, unknown> = {};
  private readonly listeners = new Set<Listener>();
  private hydrated = false;
  lastError: Error | undefined;

  constructor(private readonly repository: LibraryRepository | undefined) {}

  async hydrate(): Promise<void> {
    if (this.repository) this.values = await this.repository.getAllPrefs();
    this.hydrated = true;
    this.emit();
  }

  get isHydrated(): boolean {
    return this.hydrated;
  }

  get<T>(key: string, fallback: T): T {
    return key in this.values ? (this.values[key] as T) : fallback;
  }

  async set(key: string, value: unknown): Promise<void> {
    try {
      if (this.repository) await this.repository.setPref(key, value);
      this.values = { ...this.values, [key]: value };
      this.lastError = undefined;
      this.emit();
    } catch (error) {
      this.lastError = error instanceof Error ? error : new Error(String(error));
      this.emit();
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    if (this.repository) await this.repository.deletePref(key);
    const { [key]: _removed, ...rest } = this.values;
    this.values = rest;
    this.emit();
  }

  snapshot(): Record<string, unknown> {
    return { ...this.values };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}
