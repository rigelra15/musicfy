// The sections of the A–Z lists in the Library, after Android's LibraryIndex: Latin titles file under
// A–Z (accents folded), titles without a letter under '#', and other scripts get sections that suit
// them instead of one section per first character.

export type IndexScript = 'LATIN' | 'SYMBOL' | 'JAPANESE' | 'KOREAN' | 'CHINESE' | 'CYRILLIC' | 'GREEK' | 'ARABIC' | 'HEBREW' | 'THAI' | 'OTHER';
const SCRIPT_ORDER: IndexScript[] = ['SYMBOL', 'LATIN', 'JAPANESE', 'KOREAN', 'CHINESE', 'CYRILLIC', 'GREEK', 'ARABIC', 'HEBREW', 'THAI', 'OTHER'];

export interface IndexSection { script: IndexScript; rank: number; label: string; key: string }

const section = (script: IndexScript, rank: number, label: string): IndexSection => ({ script, rank, label, key: `${script}/${rank}` });
const SYMBOL = section('SYMBOL', 0, '#');

const KANA_ROWS = ['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ', '漢'];
const HANGUL_INITIALS = ['가', '나', '다', '라', '마', '바', '사', '아', '자', '차', '카', '타', '파', '하'];
const HANGUL_INITIAL_ROW = [0, 0, 1, 2, 2, 3, 4, 5, 5, 6, 6, 7, 8, 8, 9, 10, 11, 12, 13];
const JAMO_ROW: Record<string, number> = { 'ㄱ': 0, 'ㄲ': 0, 'ㄴ': 1, 'ㄷ': 2, 'ㄸ': 2, 'ㄹ': 3, 'ㅁ': 4, 'ㅂ': 5, 'ㅃ': 5, 'ㅅ': 6, 'ㅆ': 6, 'ㅇ': 7, 'ㅈ': 8, 'ㅉ': 8, 'ㅊ': 9, 'ㅋ': 10, 'ㅌ': 11, 'ㅍ': 12, 'ㅎ': 13 };

const inRange = (cp: number, from: number, to: number) => cp >= from && cp <= to;
const isKana = (cp: number) => inRange(cp, 0x3040, 0x30ff) || inRange(cp, 0x31f0, 0x31ff) || inRange(cp, 0xff66, 0xff9d);

/** Row of the gojūon table a kana belongs to; katakana reads as its hiragana. */
function kanaRow(cp: number): number {
  const hira = inRange(cp, 0x30a1, 0x30f6) ? cp - 0x60 : cp;
  const ranges: Array<[number, number, number]> = [
    [0x3041, 0x304a, 0], [0x304b, 0x3054, 1], [0x3055, 0x305e, 2], [0x305f, 0x3069, 3], [0x306a, 0x306e, 4],
    [0x306f, 0x307d, 5], [0x307e, 0x3082, 6], [0x3083, 0x3088, 7], [0x3089, 0x308d, 8], [0x308e, 0x3093, 9],
  ];
  for (const [from, to, row] of ranges) if (inRange(hira, from, to)) return row;
  return hira === 0x3095 || hira === 0x3096 ? 1 : 0;
}

/** First character of each pinyin initial, A..Z (no I, U, V) — the usual boundary set for collation by pinyin. */
const PINYIN_BOUNDARIES: Array<[string, string]> = [
  ['A', '阿'], ['B', '八'], ['C', '嚓'], ['D', '哒'], ['E', '妸'], ['F', '发'], ['G', '旮'], ['H', '哈'], ['J', '讥'], ['K', '咔'], ['L', '垃'],
  ['M', '妈'], ['N', '拿'], ['O', '哦'], ['P', '啪'], ['Q', '期'], ['R', '然'], ['S', '撒'], ['T', '塌'], ['W', '挖'], ['X', '昔'], ['Y', '压'], ['Z', '匝'],
];
let pinyin: Intl.Collator | null | undefined;
function pinyinInitial(char: string): { rank: number; label: string } | undefined {
  if (pinyin === undefined) {
    try { pinyin = new Intl.Collator('zh-u-co-pinyin'); if (pinyin.compare('阿', '八') >= 0 || pinyin.compare('八', '嚓') >= 0) pinyin = null; } catch { pinyin = null; }
  }
  if (!pinyin) return undefined;
  let found = -1;
  for (let i = 0; i < PINYIN_BOUNDARIES.length; i += 1) if (pinyin.compare(char, PINYIN_BOUNDARIES[i][1]) >= 0) found = i;
  return found < 0 ? undefined : { rank: found, label: PINYIN_BOUNDARIES[found][0] };
}

function scriptOf(cp: number, text: string): IndexScript {
  if (/\p{Script=Latin}/u.test(text)) return 'LATIN';
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) return 'JAPANESE';
  if (/\p{Script=Hangul}/u.test(text)) return 'KOREAN';
  if (/\p{Script=Han}/u.test(text)) return 'CHINESE';
  if (/\p{Script=Cyrillic}/u.test(text)) return 'CYRILLIC';
  if (/\p{Script=Greek}/u.test(text)) return 'GREEK';
  if (/\p{Script=Arabic}/u.test(text)) return 'ARABIC';
  if (/\p{Script=Hebrew}/u.test(text)) return 'HEBREW';
  if (/\p{Script=Thai}/u.test(text)) return 'THAI';
  return /\p{L}/u.test(text) ? 'OTHER' : 'SYMBOL';
}

/** The section a title files under. */
export function indexSectionOf(title: string): IndexSection {
  const trimmed = title.trim();
  if (!trimmed) return SYMBOL;
  const first = String.fromCodePoint(trimmed.codePointAt(0)!);
  // NFKC folds full-width Latin and half-width kana into the usual forms.
  const folded = first.normalize('NFKC');
  if (!folded) return SYMBOL;
  const cp = folded.codePointAt(0)!;
  const script = scriptOf(cp, folded);
  switch (script) {
    case 'LATIN': {
      const base = folded.normalize('NFD')[0].toUpperCase();
      return base >= 'A' && base <= 'Z' ? section('LATIN', base.charCodeAt(0) - 65, base) : SYMBOL;
    }
    case 'JAPANESE': { const row = kanaRow(cp); return section('JAPANESE', row, KANA_ROWS[row]); }
    case 'KOREAN': {
      const row = inRange(cp, 0xac00, 0xd7a3) ? HANGUL_INITIAL_ROW[Math.floor((cp - 0xac00) / 588)] : JAMO_ROW[folded[0]] ?? 0;
      return section('KOREAN', row, HANGUL_INITIALS[row]);
    }
    case 'CHINESE': {
      // Kana anywhere in the title says it is Japanese (kanji and hanzi share code points).
      if ([...trimmed].some((char) => isKana(char.codePointAt(0)!))) return section('JAPANESE', 10, KANA_ROWS[10]);
      const initial = pinyinInitial(folded);
      return initial ? section('CHINESE', initial.rank, initial.label) : section('CHINESE', 0, folded);
    }
    case 'SYMBOL': return SYMBOL;
    default: return section(script, folded.toUpperCase().codePointAt(0)!, folded.toUpperCase());
  }
}

const compareSections = (a: IndexSection, b: IndexSection) =>
  SCRIPT_ORDER.indexOf(a.script) - SCRIPT_ORDER.indexOf(b.script) || a.rank - b.rank;

let collator: Intl.Collator | undefined;
const compareNames = (a: string, b: string) => (collator ??= new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })).compare(a, b);

/** Items grouped under their section, sections in index order, items by name inside each. */
export function indexSections<T>(items: readonly T[], nameOf: (item: T) => string): Array<[IndexSection, T[]]> {
  const groups = new Map<string, { section: IndexSection; items: T[] }>();
  for (const item of items) {
    const found = indexSectionOf(nameOf(item));
    const group = groups.get(found.key) ?? { section: found, items: [] };
    group.items.push(item);
    groups.set(found.key, group);
  }
  return [...groups.values()]
    .sort((a, b) => compareSections(a.section, b.section))
    .map(({ section: s, items: list }) => [s, list.sort((a, b) => compareNames(nameOf(a), nameOf(b)))]);
}

/** The order the index shows, flattened — what tapping a song queues. */
export function sortForIndex<T>(items: readonly T[], nameOf: (item: T) => string): T[] {
  return indexSections(items, nameOf).flatMap(([, list]) => list);
}
