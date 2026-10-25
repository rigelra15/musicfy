import { describe, expect, it } from 'vitest';
import { advanceArtworkFallback, createArtworkState, artworkCandidates, resizeArtwork } from './artwork';

describe('sharp artwork sources', () => {
  it('requests 1200px Google artwork for the player and retains the original fallback', () => {
    const url = 'https://lh3.googleusercontent.com/abc=w120-h120-l90-rj';
    expect(artworkCandidates(url, 'large')).toEqual([
      'https://lh3.googleusercontent.com/abc=w1200-h1200-p-l90-rj', url, './icon.png',
    ]);
  });
  it('requests a bounded 256px source for list thumbnails', () => {
    expect(resizeArtwork('https://yt3.ggpht.com/a=s60-c-k', 256)).toBe('https://yt3.ggpht.com/a=s256');
  });
  it('uses YouTube maxres for the large player with the original as fallback', () => {
    const url = 'https://i.ytimg.com/vi/video/hqdefault.jpg';
    expect(artworkCandidates(url, 'large')).toEqual([
      'https://i.ytimg.com/vi/video/maxresdefault.jpg', url, './icon.png',
    ]);
  });
  it('upgrades YouTube webp variants without changing unknown image servers', () => {
    expect(resizeArtwork('https://i.ytimg.com/vi_webp/abc/mqdefault.webp', 1200))
      .toBe('https://i.ytimg.com/vi/abc/maxresdefault.jpg');
    expect(resizeArtwork('https://example.com/photo.jpg?w=120', 1200))
      .toBe('https://example.com/photo.jpg?w=120');
  });
  it('does not rewrite lookalike hosts and rejects unsafe protocols', () => {
    expect(resizeArtwork('https://googleusercontent.com.evil.test/a=w60', 1200))
      .toBe('https://googleusercontent.com.evil.test/a=w60');
    expect(artworkCandidates('javascript:alert(1)', 'large')).toEqual(['./icon.png']);
  });
  it('deduplicates source attempts and immediately supplies the icon without artwork', () => {
    expect(artworkCandidates(undefined, 'large')).toEqual(['./icon.png']);
    expect(artworkCandidates('https://example.com/cover.jpg', 'large'))
      .toEqual(['https://example.com/cover.jpg', './icon.png']);
  });
});

describe('artwork failure state', () => {
  it('advances from sharp artwork to original then icon and stops there', () => {
    let state = createArtworkState({ id: 'one', artworkUrl: 'https://lh3.googleusercontent.com/abc=w60' }, 'large');
    state = advanceArtworkFallback(state, state.candidates[state.index]);
    expect(state.index).toBe(1);
    state = advanceArtworkFallback(state, state.candidates[state.index]);
    expect(state.candidates[state.index]).toBe('./icon.png');
    expect(advanceArtworkFallback(state, './icon.png')).toBe(state);
  });
  it('ignores stale errors and gives a new track its first source after prior failures', () => {
    const old = createArtworkState({ id: 'one', artworkUrl: 'https://example.com/one.jpg' }, 'large');
    const failed = advanceArtworkFallback(old, old.candidates[0]);
    const fresh = createArtworkState({ id: 'two', artworkUrl: 'https://example.com/two.jpg' }, 'large');
    expect(failed.index).toBe(1);
    expect(fresh.index).toBe(0);
    expect(fresh.key).not.toBe(old.key);
    expect(advanceArtworkFallback(fresh, old.candidates[0])).toBe(fresh);
  });
});
