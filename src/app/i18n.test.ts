import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { detectLanguage, detectRegion, setActiveLanguage, tr, translate, translator, type StringKey } from './i18n';

describe('i18n', () => {
  it('defaults to Indonesian and falls back from English to Indonesian, never to the key', () => {
    expect(translate('id', 'nav.library')).toBe('Koleksi');
    expect(translate('en', 'nav.library')).toBe('Library');
    expect(translate('en', 'app.name')).toBe('Musicfy');
  });
  it('interpolates variables and leaves unknown placeholders visible', () => {
    expect(translator('id')('player.empty')).toBe('Belum ada lagu yang diputar');
  });
  it('follows the TV language on first launch: Indonesian for id, English otherwise', () => {
    expect(detectLanguage({ webOSLocale: 'id-ID' })).toBe('id');
    expect(detectLanguage({ navigatorLanguage: 'id' })).toBe('id');
    expect(detectLanguage({ webOSLocale: 'en-US' })).toBe('en');
    expect(detectLanguage({ webOSLocale: 'ko-KR', navigatorLanguage: 'id' })).toBe('en');
    expect(detectLanguage({ navigatorLanguage: 'de' })).toBe('en');
  });
  it('has an English string for every Home and onboarding label', () => {
    for (const key of ['home.recent', 'home.because', 'home.offline', 'onb.welcome.title', 'onb.artists.selected'] as StringKey[]) {
      expect(translate('en', key, { title: 'X', count: 2 })).not.toBe(translate('id', key, { title: 'X', count: 2 }));
    }
  });
});

describe('detectRegion', () => {
  it('prefers the TV country, then the region of its locale, then the browser, and ignores anything that is not two letters', () => {
    expect(detectRegion({ webOSCountry: 'id', webOSLocale: 'en-US', navigatorLanguage: 'en-GB' })).toBe('ID');
    expect(detectRegion({ webOSLocale: 'id-ID', navigatorLanguage: 'en-GB' })).toBe('ID');
    expect(detectRegion({ webOSLocale: 'ko', navigatorLanguage: 'en-GB' })).toBe('GB');
    expect(detectRegion({ webOSCountry: 'IDN', webOSLocale: 'pt_BR' })).toBe('BR');
    expect(detectRegion({ webOSLocale: 'en', navigatorLanguage: 'en' })).toBeUndefined();
  });

  it('every Indonesian string has an English one, so a language never shows the other', () => {
    const source = readFileSync(new URL('./i18n.ts', import.meta.url), 'utf8');
    const english = source.indexOf('\nconst en');
    const keys = (block: string) => new Set([...block.matchAll(/^  '([^']+)':/gm)].map((match) => match[1]));
    const id = keys(source.slice(0, english));
    const en = keys(source.slice(english));
    expect([...id].filter((key) => !en.has(key) && key !== 'app.name')).toEqual([]);
    expect([...en].filter((key) => !id.has(key))).toEqual([]);
  });
  it('words that are not in a component (errors raised by the data layers) follow the language on screen', () => {
    setActiveLanguage('en');
    expect(tr('err.service.unreachable')).toBe('Could not reach the Musicfy service.');
    expect(tr('err.link.partial', { count: 3 })).toBe('Only 3 songs could be read; the rest failed to load.');
    setActiveLanguage('id');
    expect(tr('err.service.unreachable')).toBe('Tidak bisa terhubung ke layanan Musicfy.');
  });
});
