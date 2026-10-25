import type { Track } from '../model';

export const PROVIDER_IDS = ['youtube', 'applemusic', 'monochrome', 'local'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const ENTITY_KINDS = ['track', 'album', 'artist', 'playlist'] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export interface EntityRef {
  provider: ProviderId;
  kind: EntityKind;
  id: string;
}

export type QueueOrigin = 'manual' | 'album' | 'playlist' | 'radio' | 'autoplay';

/** A slot in the queue. The same track may occupy many slots, each with its own entryId. */
export interface QueueEntry {
  entryId: string;
  trackKey: string;
  origin: QueueOrigin;
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value);
}

export function isEntityKind(value: unknown): value is EntityKind {
  return typeof value === 'string' && (ENTITY_KINDS as readonly string[]).includes(value);
}

/** `provider:kind:id`. The id may itself contain colons. */
export function entityKey(ref: EntityRef): string {
  if (!isProviderId(ref.provider) || !isEntityKind(ref.kind)) throw new Error('Invalid entity reference');
  if (typeof ref.id !== 'string' || ref.id.length === 0) throw new Error('Entity id is required');
  return `${ref.provider}:${ref.kind}:${ref.id}`;
}

export function parseEntityKey(key: string): EntityRef | undefined {
  const first = key.indexOf(':');
  const second = first < 0 ? -1 : key.indexOf(':', first + 1);
  if (first <= 0 || second <= first + 1) return undefined;
  const provider = key.slice(0, first);
  const kind = key.slice(first + 1, second);
  const id = key.slice(second + 1);
  if (!isProviderId(provider) || !isEntityKind(kind) || id.length === 0) return undefined;
  return { provider, kind, id };
}

export function trackKey(provider: ProviderId, id: string): string {
  return entityKey({ provider, kind: 'track', id });
}

/** Stream URLs, media tokens and credentials are never part of identity. */
export function trackKeyOf(track: Pick<Track, 'id' | 'provider'>): string {
  return trackKey(track.provider ?? 'youtube', track.id);
}

let entrySequence = 0;
export function newEntryId(prefix = 'e'): string {
  const cryptoApi = typeof globalThis !== 'undefined'
    ? (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
    : undefined;
  if (cryptoApi?.randomUUID) return `${prefix}-${cryptoApi.randomUUID()}`;
  entrySequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${entrySequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Words that make a recording a different recording (ported from the Android TrackMatcher). */
const VERSION_WORDS = [
  'remix', 'live', 'acoustic', 'instrumental', 'karaoke', 'sped up', 'slowed', 'nightcore',
  'demo', 'cover', 'edit', 'mix', 'version', 'unplugged', 'orchestral', 'piano',
] as const;

const VERSION_PATTERNS = VERSION_WORDS.map((word) => ({
  word,
  pattern: new RegExp(`\\b${word.replace(/ /g, '\\s+')}\\b`),
}));

export function recordingVariants(title: string): string[] {
  const lower = title.toLowerCase();
  return VERSION_PATTERNS.filter(({ pattern }) => pattern.test(lower)).map(({ word }) => word).sort();
}

export function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0 && word !== 'the' && word !== 'and');
}

/** The title without what sources hang on it ("feat.", "Remastered", "Official Video"). */
export function titleCore(title: string): string {
  let t = title.toLowerCase();
  t = t.replace(/[(\[](?:feat|ft|with|prod)\.?\s[^)\]]*[)\]]/g, ' ');
  t = t.replace(/\s[-–]\s.*\b(?:remaster(?:ed)?|official|video|audio|lyrics?|visuali[sz]er|mv)\b.*$/g, ' ');
  t = t.replace(/[(\[][^)\]]*\b(?:remaster(?:ed)?|official|video|audio|lyrics?|visuali[sz]er|mv|explicit|clean)\b[^)\]]*[)\]]/g, ' ');
  t = t.replace(/\b(?:feat|ft)\.?\s.*$/g, ' ');
  return wordsOf(t).join(' ');
}

export interface RecordingFacts {
  title: string;
  artist: string;
  durationMs?: number;
}

/**
 * Conservative check used before offering a cross-provider mapping. Never merges tracks that
 * merely have a similar title: the version words must agree, titles must match once decorations
 * are removed, an artist must be shared and durations (when both known) must be close.
 */
export function mayBeSameRecording(a: RecordingFacts, b: RecordingFacts): boolean {
  if (recordingVariants(a.title).join('|') !== recordingVariants(b.title).join('|')) return false;
  if (titleCore(a.title) !== titleCore(b.title)) return false;
  const aArtists = new Set(wordsOf(a.artist));
  const shared = wordsOf(b.artist).some((word) => aArtists.has(word));
  if (!shared) return false;
  if (a.durationMs && b.durationMs && Math.abs(a.durationMs - b.durationMs) > 3000) return false;
  return true;
}
