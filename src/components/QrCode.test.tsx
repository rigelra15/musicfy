// @vitest-environment jsdom
import { h, render } from 'preact';
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { QrCode } from './QrCode';
const require = createRequire(import.meta.url);
const { createTransferManager } = require('../../service/transfer.cjs');

describe('QR code', () => {
  it('draws the real pairing payload, quiet zone included, without throwing', async () => {
    const manager = createTransferManager({ bindHost: '127.0.0.1', advertiseHost: '192.168.100.200' });
    const { qr } = await manager.start({ deviceName: 'Ruang Tamu Lantai Dua' });
    manager.dispose();
    expect(qr.length).toBeGreaterThan(150);
    const host = document.createElement('div');
    render(h(QrCode, { value: qr, label: 'kode', size: 300 }), host);
    const svg = host.querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('kode');
    const [, , width] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    expect(width).toBeGreaterThan(8 + 29);                                            // more than the smallest version, plus the quiet zone
    expect(host.querySelector('path')!.getAttribute('d')!.length).toBeGreaterThan(1000);
    render(null, host);
  });
});
