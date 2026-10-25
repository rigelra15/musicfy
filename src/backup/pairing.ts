import { runtimeFetch } from '../platform/runtime';
import type { ImportKind } from './flow';
import { tr, type StringKey } from '../app/i18n';

export type PairingPhase = 'idle' | 'starting' | 'waiting' | 'paired' | 'receiving' | 'received' | 'failed' | 'cancelled' | 'expired';
export interface PairingState {
  phase: PairingPhase;
  /** What the QR code encodes. Never shown as text and never logged. */
  qr?: string;
  expiresAt?: number;
  device?: string;
  receivedBytes?: number;
  totalBytes?: number;
  error?: string;
}

interface ServiceStatus { phase: string; kind?: string; private?: boolean; expiresAt?: number; device?: string; receivedBytes?: number; totalBytes?: number; error?: string; code?: string }
export interface TransferApi {
  start(deviceName: string): Promise<{ qr: string; expiresAt: number }>;
  status(): Promise<ServiceStatus>;
  payload(): Promise<{ kind: ImportKind; name?: string; device?: string; text: string }>;
  cancel(): Promise<void>;
}

class ApiError extends Error { constructor(message: string, readonly code?: string) { super(message); } }

/** What the service said went wrong, in the language on screen. The service's own words are never shown. */
export function pairMessage(code: string | undefined): string {
  const key = code ? PAIR_CODES[code] : undefined;
  return key ? tr(key) : tr('err.pair.failed');
}
const PAIR_CODES: Record<string, StringKey> = { busy: 'err.pair.busy', noNetwork: 'err.pair.noNetwork', noData: 'err.pair.noData', tooMany: 'err.pair.tooMany', phoneCancelled: 'err.pair.phoneCancelled', corrupt: 'err.pair.corrupt', refused: 'err.pair.refused', expired: 'err.pair.expired', cancelled: 'err.pair.cancelled' };
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await runtimeFetch(`/api/transfer/${path}`, { credentials: 'omit', ...init }); } catch { throw new ApiError(tr('err.service.noReply')); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(pairMessage(typeof body?.code === 'string' ? body.code : undefined), typeof body?.code === 'string' ? body.code : undefined);
  return body as T;
}
export const serviceTransferApi: TransferApi = {
  start: (deviceName) => call('start', { method: 'POST', body: JSON.stringify({ deviceName }) }),
  status: () => call('status'),
  payload: () => call('payload'),
  cancel: async () => { await call('cancel', { method: 'POST' }).catch(() => undefined); },
};

interface Options {
  api?: TransferApi;
  deviceName: string;
  onPayload(kind: ImportKind, text: string, device: string | undefined): void;
  /** The phone sent a credential (an account session). The service kept it; the screen only learns that it arrived. */
  onPrivate?(kind: string, device: string | undefined): void;
  pollMs?: number;
}

/**
 * One "Hubungkan HP" session as the screen sees it: asks the service to open the listener, shows
 * the QR code, follows the phase until the data arrives, and hands the data over. Leaving the
 * screen (or the app being suspended) cancels it, so the listener never outlives the person looking at it.
 */
export class PairingSession {
  private state: PairingState = { phase: 'idle' };
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private readonly api: TransferApi;

  constructor(private readonly options: Options) { this.api = options.api ?? serviceTransferApi; }

  getSnapshot = (): PairingState => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private set(state: PairingState) { this.state = state; this.listeners.forEach((listener) => listener()); }

  async start(): Promise<void> {
    if (this.state.phase === 'starting' || this.state.phase === 'waiting' || this.state.phase === 'paired' || this.state.phase === 'receiving') return;
    const generation = ++this.generation;
    this.set({ phase: 'starting' });
    try {
      const started = await this.api.start(this.options.deviceName);
      if (generation !== this.generation) { void this.api.cancel(); return; }
      this.set({ phase: 'waiting', qr: started.qr, expiresAt: started.expiresAt });
      this.schedule(generation);
    } catch (error) {
      if (generation === this.generation) this.set({ phase: 'failed', error: error instanceof Error ? error.message : tr('err.pair.failed') });
    }
  }

  private schedule(generation: number) {
    this.timer = setTimeout(() => { void this.poll(generation); }, this.options.pollMs ?? 1000);
  }

  private async poll(generation: number): Promise<void> {
    if (generation !== this.generation) return;
    try {
      const status = await this.api.status();
      if (generation !== this.generation) return;
      const phase = status.phase as PairingPhase;
      if (phase === 'received' && status.private) {
        this.set({ phase: 'received', device: status.device });
        this.options.onPrivate?.(status.kind ?? '', status.device);
        return;
      }
      if (phase === 'received') {
        const payload = await this.api.payload();
        if (generation !== this.generation) return;
        this.set({ phase: 'received', device: payload.device ?? status.device });
        this.options.onPayload(payload.kind, payload.text, payload.device ?? status.device);
        return;
      }
      if (phase === 'failed' || phase === 'cancelled' || phase === 'expired' || phase === 'idle') {
        this.set({ phase: phase === 'idle' ? 'cancelled' : phase, device: status.device, error: status.phase === 'cancelled' || status.phase === 'idle' ? undefined : pairMessage(status.code) });
        return;
      }
      this.set({ ...this.state, phase, expiresAt: status.expiresAt ?? this.state.expiresAt, device: status.device, receivedBytes: status.receivedBytes, totalBytes: status.totalBytes });
    } catch (error) {
      if (generation !== this.generation) return;
      this.set({ phase: 'failed', error: error instanceof Error ? error.message : tr('err.pair.failed') });
      return;
    }
    this.schedule(generation);
  }

  /** Ends the session on the TV (and closes the listener). Safe to call at any time. */
  async cancel(): Promise<void> {
    const live = ['starting', 'waiting', 'paired', 'receiving'].includes(this.state.phase);
    this.generation += 1;
    clearTimeout(this.timer);
    if (live) { this.set({ phase: 'cancelled', error: tr('err.pair.cancelled') }); await this.api.cancel(); }
  }

  dispose(): void { void this.cancel(); this.listeners.clear(); }
}
