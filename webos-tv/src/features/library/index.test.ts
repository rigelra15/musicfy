import { describe, expect, it } from 'vitest';
import { indexSectionOf, indexSections, sortForIndex } from './index';

describe('library index sections', () => {
  it('files Latin titles under A–Z with accents folded, and everything without a letter under #', () => {
    expect(indexSectionOf('Hujan').label).toBe('H');
    expect(indexSectionOf('éclair').label).toBe('E');
    expect(indexSectionOf('Ｚebra').label).toBe('Z');
    expect(indexSectionOf('123 Lagu').label).toBe('#');
    expect(indexSectionOf('  ').label).toBe('#');
    expect(indexSectionOf('!!!').label).toBe('#');
  });

  it('gives other scripts sections that suit them', () => {
    expect(indexSectionOf('さくら').key).toBe('JAPANESE/2');
    expect(indexSectionOf('サクラ').key).toBe('JAPANESE/2');
    expect(indexSectionOf('愛のうた').label).toBe('漢');
    expect(indexSectionOf('사랑').label).toBe('사');
    expect(indexSectionOf('Привет').script).toBe('CYRILLIC');
    expect(indexSectionOf('Привет').label).toBe('П');
    expect(indexSectionOf('Αθήνα').script).toBe('GREEK');
    expect(indexSectionOf('ไทย').script).toBe('THAI');
  });

  it('puts # first, Latin in order, then other scripts in a fixed order, and sorts names inside a section', () => {
    const names = ['Zebra', 'さくら', 'Apel', '9 Lives', 'Anggur', 'Привет', 'abu', 'Budi'];
    const sections = indexSections(names, (name) => name);
    expect(sections.map(([s]) => s.label)).toEqual(['#', 'A', 'B', 'Z', 'さ', 'П']);
    expect(sections[1][1]).toEqual(['abu', 'Anggur', 'Apel']);
    expect(sortForIndex(names, (name) => name)).toEqual(['9 Lives', 'abu', 'Anggur', 'Apel', 'Budi', 'Zebra', 'さくら', 'Привет']);
  });

  it('sorts numbers naturally inside a section', () => {
    expect(sortForIndex(['Lagu 10', 'Lagu 2', 'Lagu 1'], (name) => name)).toEqual(['Lagu 1', 'Lagu 2', 'Lagu 10']);
  });

  it('never throws on odd input and keeps one section per distinct key', () => {
    const odd = ['', '😀 emoji', '\u0000', 'Ω', '٣ عربي', 'שלום'];
    expect(() => indexSections(odd, (name) => name)).not.toThrow();
    const keys = indexSections(odd, (name) => name).map(([s]) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
