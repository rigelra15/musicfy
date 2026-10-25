import { describe, expect, it } from 'vitest';
import { readingOf, readingScript } from './readings';

describe('readings', () => {
  it('romanizes kana, with long vowels, small tsu and combined sounds', () => {
    expect(readingOf('こんにちは', 'kana')).toBe('konnichiha');
    expect(readingOf('さくら', 'kana')).toBe('sakura');
    expect(readingOf('ガッコウ', 'kana')).toBe('gakkou');
    expect(readingOf('きょう', 'kana')).toBe('kyou');
    expect(readingOf('しゃしん', 'kana')).toBe('shashin');
    expect(readingOf('ラーメン', 'kana')).toBe('raamen');
    expect(readingOf('まっちゃ', 'kana')).toBe('matcha');
  });
  it('gives no reading for a line that still has kanji, instead of a half converted one', () => {
    expect(readingOf('君の声', 'kana')).toBeNull();
    expect(readingOf('きみの声', 'kana')).toBeNull();
  });
  it('romanizes Hangul syllable by syllable', () => {
    expect(readingOf('사랑해', 'hangul')).toBe('saranghae');
    expect(readingOf('안녕', 'hangul')).toBe('annyeong');
    expect(readingOf('한국 말', 'hangul')).toBe('hanguk mal');
  });
  it('romanizes Cyrillic and keeps capitals', () => {
    expect(readingOf('Привет, мир', 'cyrillic')).toBe('Privet, mir');
    expect(readingOf('Щука', 'cyrillic')).toBe('Shchuka');
  });
  it('returns nothing for blank text, Latin text and text that is already its own reading', () => {
    expect(readingOf('  ', 'kana')).toBeNull();
    expect(readingOf('hello world', 'kana')).toBeNull();
    expect(readingOf('Hello', 'cyrillic')).toBeNull();
  });
  it('decides one script for the whole song', () => {
    expect(readingScript(['君の声', 'ありがとう'])).toBe('kana');
    expect(readingScript(['君声', '世界'])).toBeUndefined();
    expect(readingScript(['Hello', 'Привет'])).toBe('cyrillic');
    expect(readingScript(['사랑', 'love'])).toBe('hangul');
    expect(readingScript(['just english'])).toBeUndefined();
  });
});
