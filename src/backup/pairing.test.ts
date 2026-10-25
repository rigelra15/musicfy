import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PairingSession, type TransferApi } from './pairing';

let api: { [K in keyof TransferApi]: ReturnType<typeof vi.fn> };
let received: Array<[string, string, string | undefined]>;
const make = () => new PairingSession({ api: api as unknown as TransferApi, deviceName: 'Ruang Tamu', onPayload: (...args) => received.push(args), pollMs: 1000 });

beforeEach(() => {
  vi.useFakeTimers();
  received = [];
  api = {
    start: vi.fn(async () => ({ qr: 'musicfy://pair?v=1&x', expiresAt: 5000 })),
    status: vi.fn(async () => ({ phase: 'waiting', expiresAt: 5000 })),
    payload: vi.fn(async () => ({ kind: 'portable' as const, device: 'Pixel', text: '{}' })),
    cancel: vi.fn(async () => undefined),
  };
});
afterEach(() => vi.useRealTimers());

describe('pairing session', () => {
  it('starts the listener, shows the QR and follows the phone through to the data', async () => {
    const session = make();
    await session.start();
    expect(api.start).toHaveBeenCalledWith('Ruang Tamu');
    expect(session.getSnapshot()).toMatchObject({ phase: 'waiting', qr: 'musicfy://pair?v=1&x' });
    api.status.mockResolvedValueOnce({ phase: 'paired', device: 'Pixel' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.getSnapshot().phase).toBe('paired');
    api.status.mockResolvedValueOnce({ phase: 'receiving', receivedBytes: 100, totalBytes: 400, device: 'Pixel' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.getSnapshot()).toMatchObject({ phase: 'receiving', receivedBytes: 100, totalBytes: 400 });
    api.status.mockResolvedValueOnce({ phase: 'received', device: 'Pixel' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(received).toEqual([['portable', '{}', 'Pixel']]);
    expect(session.getSnapshot().phase).toBe('received');
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.status).toHaveBeenCalledTimes(3);                                  // polling stopped
  });

  it('shows why a session ended: failed, expired or cancelled from the phone', async () => {
    for (const phase of ['failed', 'expired', 'cancelled'] as const) {
      const session = make();
      api.status.mockResolvedValueOnce({ phase, error: `alasan ${phase}`, code: phase === 'failed' ? 'corrupt' : phase });
      await session.start();
      await vi.advanceTimersByTimeAsync(1000);
      // the service's own words are never shown: the screen words it from the code, in the language on screen
      const error = session.getSnapshot().error;
      expect(error ?? '').not.toContain('alasan');
      if (phase === 'failed') expect(error).toContain('rusak'); else if (phase === 'expired') expect(error).toContain('habis'); else expect(error).toBeUndefined();
    }
  });

  it('a TV with no network says so instead of showing a QR', async () => {
    api.start.mockRejectedValueOnce(new Error('TV tidak terhubung ke jaringan Wi-Fi atau Ethernet.'));  // an ApiError carries its code's words
    const session = make();
    await session.start();
    expect(session.getSnapshot()).toMatchObject({ phase: 'failed', error: expect.stringMatching(/jaringan/) });
    expect(session.getSnapshot().qr).toBeUndefined();
  });

  it('cancel closes the listener, stops polling and is safe to repeat', async () => {
    const session = make();
    await session.start();
    await session.cancel();
    await session.cancel();
    expect(api.cancel).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.status).not.toHaveBeenCalled();
    expect(session.getSnapshot().phase).toBe('cancelled');
  });

  it('leaving the screen (dispose) cancels a live session, and does not cancel one that is already over', async () => {
    const live = make();
    await live.start();
    live.dispose();
    expect(api.cancel).toHaveBeenCalledTimes(1);
    const done = make();
    api.status.mockResolvedValueOnce({ phase: 'received', device: 'P' });
    await done.start();
    await vi.advanceTimersByTimeAsync(1000);
    done.dispose();
    expect(api.cancel).toHaveBeenCalledTimes(1);
  });

  it('a start that was cancelled before the service answered closes the listener it opened', async () => {
    let release: (value: { qr: string; expiresAt: number }) => void = () => undefined;
    api.start.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const session = make();
    const starting = session.start();
    await session.cancel();
    release({ qr: 'x', expiresAt: 1 });
    await starting;
    expect(api.cancel).toHaveBeenCalled();
    expect(session.getSnapshot().qr).toBeUndefined();
  });

  it('losing the service ends the session with an error', async () => {
    const session = make();
    await session.start();
    api.status.mockRejectedValueOnce(new Error('Layanan Musicfy di TV tidak merespons.'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.getSnapshot()).toMatchObject({ phase: 'failed', error: expect.stringMatching(/tidak merespons/) });
  });
});
