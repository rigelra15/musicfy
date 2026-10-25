import { describe, expect, it } from 'vitest';
import {
  entityKey,
  mayBeSameRecording,
  newEntryId,
  parseEntityKey,
  recordingVariants,
  titleCore,
  trackKeyOf,
} from './entity';

describe('entity identity', () => {
  it('qualifies keys by provider and kind', () => {
    expect(entityKey({ provider: 'youtube', kind: 'track', id: 'abc' })).toBe('youtube:track:abc');
    expect(trackKeyOf({ id: 'abc' })).toBe('youtube:track:abc');
    expect(trackKeyOf({ id: 'abc', provider: 'local' })).toBe('local:track:abc');
    expect(trackKeyOf({ id: 'abc' })).not.toBe(trackKeyOf({ id: 'abc', provider: 'monochrome' }));
  });

  it('round trips ids that contain colons', () => {
    const ref = { provider: 'applemusic', kind: 'album', id: 'pl.u-x:1:2' } as const;
    expect(parseEntityKey(entityKey(ref))).toEqual(ref);
  });

  it('rejects malformed keys and empty ids', () => {
    expect(parseEntityKey('nonsense')).toBeUndefined();
    expect(parseEntityKey('youtube:track:')).toBeUndefined();
    expect(parseEntityKey('spotify:track:1')).toBeUndefined();
    expect(parseEntityKey('youtube:video:1')).toBeUndefined();
    expect(() => entityKey({ provider: 'youtube', kind: 'track', id: '' })).toThrow();
  });

  it('creates distinct entry ids for the same track', () => {
    expect(newEntryId()).not.toBe(newEntryId());
  });
});

describe('recording identity', () => {
  it('reads version words as whole words', () => {
    expect(recordingVariants('Alive')).toEqual([]);
    expect(recordingVariants('Song (Live)')).toEqual(['live']);
    expect(recordingVariants('Song (Acoustic Version)')).toEqual(['acoustic', 'version']);
    expect(recordingVariants('Song - Sped Up')).toEqual(['sped up']);
  });

  it('strips decorations but keeps the words that matter', () => {
    expect(titleCore('Song (feat. Someone) [Remastered 2011]')).toBe('song');
    expect(titleCore('Song - Official Video')).toBe('song');
    expect(titleCore('Song (Live)')).toBe('song live');
  });

  it('does not merge cover, live, acoustic or remix with the original', () => {
    const original = { title: 'Yellow', artist: 'Coldplay', durationMs: 269000 };
    expect(mayBeSameRecording(original, { ...original })).toBe(true);
    expect(mayBeSameRecording(original, { title: 'Yellow (Live)', artist: 'Coldplay', durationMs: 269000 })).toBe(false);
    expect(mayBeSameRecording(original, { title: 'Yellow (Acoustic)', artist: 'Coldplay', durationMs: 269000 })).toBe(false);
    expect(mayBeSameRecording(original, { title: 'Yellow (Remix)', artist: 'Coldplay', durationMs: 269000 })).toBe(false);
    expect(mayBeSameRecording(original, { title: 'Yellow', artist: 'Someone Else', durationMs: 269000 })).toBe(false);
    expect(mayBeSameRecording(original, { title: 'Yellow', artist: 'Coldplay', durationMs: 200000 })).toBe(false);
  });
});
