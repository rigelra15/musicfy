import { tr, type StringKey } from '../app/i18n';
/**
 * What the app can honestly claim. Every gated feature carries where its support was proven; a
 * result from a desktop browser or a mock never upgrades a feature that needs the TV itself.
 */
export type CapabilityStatus = 'supported' | 'unsupported' | 'unverified';
export type EvidenceEnvironment = 'none' | 'local-browser' | 'simulator' | 'native-webos';

export interface Capability {
  id: CapabilityId;
  status: CapabilityStatus;
  evidence: EvidenceEnvironment;
  /** Why it is in this state: the key of the sentence shown to the user, in the language on screen. */
  reason: string;
  /** What must happen to move it forward; absent when supported. */
  needs?: string;
  testedAt?: string;
}

/** Why a feature is in its state, in the language on screen. */
export const capabilityReason = (capability: Pick<Capability, 'reason'>): string => tr(capability.reason as StringKey);

export const CAPABILITY_IDS = [
  'playback.progressive',
  'playback.hls-drm',
  'playback.flac',
  'apple.authorization',
  'audio.equalizer',
  'audio.reverb',
  'audio.spatial',
  'audio.normalization',
  'audio.visualizer',
  'audio.crossfade',
  'audio.skipSilence',
  'audio.speed',
  'audio.pitch',
  'video.canvas',
  'video.background',
  'system.volume',
  'system.outputDevice',
  'system.keepAwake',
  'lifecycle.background',
  'drm.offlineLicense',
  'transfer.lan',
  'storage.indexeddb',
  'storage.media',
] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

const NATIVE_NEEDED = 'cap.needsNative';

export const BASE_CAPABILITIES: Record<CapabilityId, Omit<Capability, 'id'>> = {
  'playback.progressive': { status: 'supported', evidence: 'local-browser', reason: 'cap.reason.playback.progressive', needs: NATIVE_NEEDED },
  'playback.hls-drm': { status: 'unverified', evidence: 'none', reason: 'cap.reason.playback.hls-drm', needs: NATIVE_NEEDED },
  'playback.flac': { status: 'unverified', evidence: 'none', reason: 'cap.reason.playback.flac', needs: NATIVE_NEEDED },
  'apple.authorization': { status: 'unverified', evidence: 'none', reason: 'cap.reason.apple.authorization', needs: NATIVE_NEEDED },
  'audio.equalizer': { status: 'unverified', evidence: 'none', reason: 'cap.reason.audio.equalizer', needs: NATIVE_NEEDED },
  'audio.reverb': { status: 'unverified', evidence: 'none', reason: 'cap.reason.audio.reverb', needs: NATIVE_NEEDED },
  'audio.spatial': { status: 'unverified', evidence: 'none', reason: 'cap.reason.audio.spatial', needs: NATIVE_NEEDED },
  'audio.normalization': { status: 'unverified', evidence: 'none', reason: 'cap.reason.audio.normalization', needs: NATIVE_NEEDED },
  'audio.visualizer': { status: 'unverified', evidence: 'none', reason: 'cap.reason.audio.visualizer', needs: NATIVE_NEEDED },
  'audio.crossfade': { status: 'unverified', evidence: 'none', reason: 'cap.reason.audio.crossfade', needs: NATIVE_NEEDED },
  'audio.skipSilence': { status: 'unverified', evidence: 'none', reason: 'cap.reason.audio.skipSilence', needs: NATIVE_NEEDED },
  'audio.speed': { status: 'supported', evidence: 'local-browser', reason: 'cap.reason.audio.speed', needs: NATIVE_NEEDED },
  'audio.pitch': { status: 'unverified', evidence: 'none', reason: 'cap.reason.audio.pitch', needs: NATIVE_NEEDED },
  'video.canvas': { status: 'unverified', evidence: 'none', reason: 'cap.reason.video.canvas', needs: NATIVE_NEEDED },
  'video.background': { status: 'unverified', evidence: 'none', reason: 'cap.reason.video.background', needs: NATIVE_NEEDED },
  'system.volume': { status: 'unsupported', evidence: 'none', reason: 'cap.reason.system.volume' },
  'system.outputDevice': { status: 'unsupported', evidence: 'none', reason: 'cap.reason.system.outputDevice' },
  'system.keepAwake': { status: 'unverified', evidence: 'none', reason: 'cap.reason.system.keepAwake', needs: NATIVE_NEEDED },
  'lifecycle.background': { status: 'unverified', evidence: 'none', reason: 'cap.reason.lifecycle.background', needs: NATIVE_NEEDED },
  'drm.offlineLicense': { status: 'unverified', evidence: 'none', reason: 'cap.reason.drm.offlineLicense', needs: NATIVE_NEEDED },
  'transfer.lan': { status: 'unverified', evidence: 'local-browser', reason: 'cap.reason.transfer.lan', needs: NATIVE_NEEDED },
  'storage.indexeddb': { status: 'unverified', evidence: 'none', reason: 'cap.reason.storage.indexeddb' },
  'storage.media': { status: 'unverified', evidence: 'none', reason: 'cap.reason.storage.media', needs: NATIVE_NEEDED },
};

export interface CapabilityProbe {
  audioElement?: { canPlayType(type: string): string } | null;
  indexedDb?: unknown;
}

export class CapabilityRegistry {
  private readonly overrides = new Map<CapabilityId, Partial<Capability>>();

  get(id: CapabilityId): Capability {
    return { id, ...BASE_CAPABILITIES[id], ...this.overrides.get(id) };
  }

  all(): Capability[] {
    return CAPABILITY_IDS.map((id) => this.get(id));
  }

  /** Record a result. Native evidence is the only thing that may mark a gated feature supported. */
  record(id: CapabilityId, result: Pick<Capability, 'status' | 'evidence' | 'reason'> & { testedAt?: string }): void {
    const base = BASE_CAPABILITIES[id];
    const needsNative = base.needs === NATIVE_NEEDED;
    const status = result.status === 'supported' && needsNative && result.evidence !== 'native-webos' && base.status !== 'supported'
      ? 'unverified'
      : result.status;
    this.overrides.set(id, { ...result, status, ...(status === 'supported' && result.evidence === 'native-webos' ? { needs: undefined } : {}) });
  }

  isUsable(id: CapabilityId): boolean {
    return this.get(id).status === 'supported';
  }

  probe(probe: CapabilityProbe): void {
    if (probe.indexedDb) {
      this.record('storage.indexeddb', { status: 'supported', evidence: 'local-browser', reason: 'cap.idb.ok' });
    } else {
      this.record('storage.indexeddb', { status: 'unsupported', evidence: 'local-browser', reason: 'cap.idb.no' });
    }
    if (probe.audioElement) {
      const can = (type: string) => probe.audioElement!.canPlayType(type) !== '';
      this.record('playback.flac', can('audio/flac')
        ? { status: 'unverified', evidence: 'local-browser', reason: 'cap.flac.yes' }
        : { status: 'unverified', evidence: 'local-browser', reason: 'cap.flac.no' });
    }
  }
}
