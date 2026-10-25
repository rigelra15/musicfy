/**
 * Readings: a line's pronunciation in Latin letters, shown under it. What Android does with a
 * dictionary tokenizer (kanji, Chinese) is not ported: a line that still has characters this file
 * cannot read gets no reading at all, instead of a half-converted one.
 */
export type ReadingScript = 'kana' | 'hangul' | 'cyrillic';

const HIRAGANA: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o', か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko', さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to', な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no', は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo', や: 'ya', ゆ: 'yu', よ: 'yo', ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro', わ: 'wa', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go', ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo', だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo', ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po', ゔ: 'vu',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
};
const SMALL_YA: Record<string, string> = { ゃ: 'ya', ゅ: 'yu', ょ: 'yo' };
const COMBINED: Record<string, string> = { し: 'sh', ち: 'ch', じ: 'j', ぢ: 'j' };
const CONSONANT_I: Record<string, string> = {
  き: 'ky', ぎ: 'gy', に: 'ny', ひ: 'hy', び: 'by', ぴ: 'py', み: 'my', り: 'ry',
};

const katakanaToHiragana = (ch: string) => {
  const code = ch.charCodeAt(0);
  return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : ch;
};

function romanizeKana(text: string): string | undefined {
  const chars = Array.from(text).map(katakanaToHiragana);
  let out = '';
  let doubleNext = false;
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (ch === 'ー') { const last = out[out.length - 1]; if (last && 'aiueo'.includes(last)) out += last; continue; }
    if (ch === 'っ') { doubleNext = true; continue; }
    if (/[\s\d.,!?'"、。！？「」…・\-()]/u.test(ch) || /[A-Za-z]/.test(ch)) { out += ch === '、' ? ',' : ch === '。' ? '.' : ch === '・' ? ' ' : ch; doubleNext = false; continue; }
    let piece: string | undefined;
    const next = chars[i + 1];
    if (next && SMALL_YA[next] && (CONSONANT_I[ch] || COMBINED[ch])) {
      const glide = SMALL_YA[next];
      piece = COMBINED[ch] ? COMBINED[ch] + glide.slice(1) : CONSONANT_I[ch] + glide.slice(1);
      i += 1;
    } else piece = HIRAGANA[ch];
    if (piece === undefined) return undefined;
    if (doubleNext) { out += piece[0] === 'c' && piece.startsWith('ch') ? 't' + piece : piece[0] + piece; doubleNext = false; } else out += piece;
  }
  return out.replace(/\s+/g, ' ').trim();
}

// Hangul: decompose each syllable into initial / vowel / final (Revised Romanization, without sound-change rules).
const INITIALS = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const VOWELS = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const FINALS = ['', 'k', 'kk', 'ks', 'n', 'nj', 'nh', 't', 'l', 'lk', 'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'p', 'ps', 't', 'tt', 'ng', 't', 't', 'k', 't', 'p', 't'];

function romanizeHangul(text: string): string | undefined {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= 0xac00 && code <= 0xd7a3) {
      const index = code - 0xac00;
      out += INITIALS[Math.floor(index / 588)] + VOWELS[Math.floor((index % 588) / 28)] + FINALS[index % 28];
    } else if (/[\s\d.,!?'"()\-A-Za-z]/.test(ch)) out += ch;
    else return undefined;
  }
  return out.replace(/\s+/g, ' ').trim();
}

const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g', ў: 'u', ј: 'j', љ: 'lj', њ: 'nj', ћ: 'c', ђ: 'dj', џ: 'dz', ѓ: 'gj', ќ: 'kj', ѕ: 'dz',
};
function romanizeCyrillic(text: string): string | undefined {
  let out = '';
  for (const ch of text) {
    const lower = ch.toLowerCase();
    const mapped = CYRILLIC[lower];
    if (mapped !== undefined) out += ch === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
    else if (/[\s\d.,!?'"()\-A-Za-z]/.test(ch)) out += ch;
    else return undefined;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** One script for the whole song, decided from all of it (a line of kanji alone must not be read as Chinese). */
export function readingScript(lines: readonly string[]): ReadingScript | undefined {
  const body = lines.join(' ');
  if (/[぀-ヿ]/.test(body)) return 'kana';
  if (/[가-힯]/.test(body)) return 'hangul';
  if (/[Ѐ-ӿ]/.test(body)) return 'cyrillic';
  return undefined;
}

/** The reading of `text`, or null when there is none, when it equals the text, or when part of it cannot be read. */
export function readingOf(text: string, script: ReadingScript): string | null {
  if (!text.trim()) return null;
  const reading = script === 'kana' ? romanizeKana(text) : script === 'hangul' ? romanizeHangul(text) : romanizeCyrillic(text);
  return reading && reading !== text.trim() ? reading : null;
}

/** Scripts a reading exists for, so the settings can say honestly which are missing. */
export const READABLE: ReadonlyArray<{ script: string; readable: boolean }> = [
  { script: 'kana', readable: true }, { script: 'hangul', readable: true }, { script: 'cyrillic', readable: true },
  { script: 'han', readable: false }, { script: 'devanagari', readable: false }, { script: 'gurmukhi', readable: false },
];
