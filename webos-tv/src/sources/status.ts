import type { ModuleStatus, SourcesClient } from './client';
import { tr } from '../app/i18n';

export interface SourceStatusState { status: 'idle' | 'loading' | 'ready' | 'error'; modules: ModuleStatus[]; error?: string }

/** What the TV service says about each source's account, refreshed on demand. A newer answer is never replaced by an older one. */
export class SourceStatusStore {
  private state: SourceStatusState = { status: 'idle', modules: [] };
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  constructor(private readonly client: SourcesClient) {}

  getSnapshot = (): SourceStatusState => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(state: SourceStatusState) { this.state = state; this.listeners.forEach((listener) => listener()); }

  async refresh(): Promise<void> {
    const generation = ++this.generation;
    this.set({ ...this.state, status: 'loading', error: undefined });
    try {
      const modules = await this.client.status();
      if (generation === this.generation) this.set({ status: 'ready', modules });
    } catch (error) {
      if (generation === this.generation) this.set({ status: 'error', modules: this.state.modules, error: error instanceof Error ? error.message : tr('err.sources.status') });
    }
  }
}
