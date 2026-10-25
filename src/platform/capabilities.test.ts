import { describe, expect, it } from 'vitest';
import { BASE_CAPABILITIES, CAPABILITY_IDS, CapabilityRegistry } from './capabilities';

describe('capability registry', () => {
  it('describes every gated feature with a reason', () => {
    const registry = new CapabilityRegistry();
    expect(registry.all()).toHaveLength(CAPABILITY_IDS.length);
    for (const capability of registry.all()) expect(capability.reason.length).toBeGreaterThan(10);
  });

  it('never calls DSP, DRM or background playback supported by default', () => {
    const registry = new CapabilityRegistry();
    for (const id of ['audio.equalizer', 'audio.reverb', 'audio.spatial', 'playback.hls-drm', 'lifecycle.background', 'drm.offlineLicense'] as const) {
      expect(registry.isUsable(id)).toBe(false);
    }
    expect(BASE_CAPABILITIES['system.outputDevice'].status).toBe('unsupported');
  });

  it('does not let a browser or mock result upgrade a feature that needs the TV', () => {
    const registry = new CapabilityRegistry();
    registry.record('audio.equalizer', { status: 'supported', evidence: 'local-browser', reason: 'Works in Chrome' });
    expect(registry.get('audio.equalizer').status).toBe('unverified');
    registry.record('audio.equalizer', { status: 'supported', evidence: 'native-webos', reason: 'Measured on TV' });
    expect(registry.get('audio.equalizer').status).toBe('supported');
  });

  it('reports storage availability from the probe', () => {
    const registry = new CapabilityRegistry();
    registry.probe({ indexedDb: undefined });
    expect(registry.get('storage.indexeddb').status).toBe('unsupported');
    registry.probe({ indexedDb: {}, audioElement: { canPlayType: () => '' } });
    expect(registry.get('storage.indexeddb').status).toBe('supported');
    expect(registry.get('playback.flac').status).toBe('unverified');
  });
});
