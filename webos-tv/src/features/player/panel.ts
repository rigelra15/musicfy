export type PlayerPanel = 'lyrics' | 'queue';

/** Which of the two the player's side area shows: the lyrics or the queue (one at a time). Remembered while the app runs. */
export class PlayerPanelStore {
  private panel: PlayerPanel = 'lyrics';
  private readonly listeners = new Set<() => void>();
  getSnapshot = (): PlayerPanel => this.panel;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  set(panel: PlayerPanel): void {
    if (panel === this.panel) return;
    this.panel = panel;
    this.listeners.forEach((listener) => listener());
  }
}
