import { tr } from '../app/i18n';
import type { Track } from '../model';
import { lyricsProviders, type LyricsDetail, type RequestLyrics, type SourceLyricsDocument, type SourceResult } from './types';

type Script = 'latin' | 'han' | 'kana' | 'hangul' | 'cyrillic' | 'arabic' | 'devanagari' | 'thai' | 'gurmukhi' | 'unknown';
export function dominantScript(text: string): Script {
  const ranges: Array<[Script, RegExp]> = [
    ['kana', /[\u3040-\u30ff]/g], ['hangul', /[\uac00-\ud7af]/g], ['han', /[\u3400-\u9fff]/g],
    ['latin', /[a-zA-Z\u00c0-\u024f]/g], ['cyrillic', /[\u0400-\u04ff]/g], ['arabic', /[\u0600-\u06ff]/g],
    ['devanagari', /[\u0900-\u097f]/g], ['thai', /[\u0e00-\u0e7f]/g], ['gurmukhi', /[\u0a00-\u0a7f]/g],
  ];
  const counts = ranges.map(([script, re]) => ({ script, count: (text.match(re) || []).length }));
  if (counts[0].count) return 'kana';
  const total = counts.reduce((n, c) => n + c.count, 0);
  if (!total) return 'unknown';
  if (counts[1].count * 4 >= total) return 'hangul';
  return counts.sort((a, b) => b.count - a.count)[0].script;
}
// Same small-word language evidence as Android LyricsUtils, including Indonesian.
const markers: Record<string, Set<string>> = Object.fromEntries(Object.entries({
  en: "the and you i i'm my it's don't your that what with this be just can't won't when all for of we but now never you're i'll was are can know like want she he",
  id: 'yang dan aku kau kamu ini itu tak tidak dengan untuk akan ada dalam hati saja bisa tapi jangan sudah lagi karena selalu engkau dia kita cinta ku mu dari pun pernah hanya semua takkan denganmu padamu diriku dirimu',
  es: 'que y el los las yo pero porque quiero eres estoy cuando para del como más qué nada todo tú mí sí esta está contigo corazón vida siempre nunca puedo',
  pt: 'você não eu meu minha é um pra tudo nao voce também mais quando sem isso ela ele só vou seu sua nós estou coração agora sempre nunca',
  fr: "je les et est pas pour dans moi toi mon c'est j'ai qui sur une des du au ne plus tout elle nous vous suis ça avec mais",
  de: 'der die das und ich nicht ist ein eine mich mir dich dir wir mein auf mit wie nur auch sich noch bin bist kein immer zu',
  it: 'il che non sono sei io per mio mia più cosa ancora questo della nel perché tutto anche gli voglio amore',
  tl: 'ang ng sa ko mo na ka ako ikaw hindi lang mga kita ay naman pa sana akin ito iyong natin tayo puso',
  nl: 'het een ik niet van dat mijn jij wij voor maar zijn wat wel nog ook geen heb ben',
  tr: 'bir ve ben sen bu için çok gibi beni seni var yok değil olan her ama daha şey kadar',
  vi: 'anh em và không là của một người yêu có những cho đã mình trong như tôi thì này',
  'ja-Latn': 'wa ga wo ni mo kimi boku watashi anata dake kara made kokoro demo itsumo nai koto toki naka sora',
  'ko-Latn': 'naega neol neoreul nan nae neon geu nal naneun neoui uri saranghae jigeum modeun ije geurae eonjena',
}).map(([language, words]) => [language, new Set(words.split(' '))]));
function latinLanguage(text: string): string | null {
  const tokens = text.toLowerCase().split(/[^\p{L}'’]+/u).map((t) => t.replace(/^['’]+|['’]+$/g, '')).filter(Boolean);
  if (tokens.length < 12) return null;
  const ranked = Object.entries(markers).map(([language, words]) => ({ language, hits: tokens.filter((t) => words.has(t)).length })).sort((a, b) => b.hits - a.hits);
  return ranked[0].hits * 10 >= tokens.length && ranked[0].hits * 2 >= ranked[1].hits * 3 ? ranked[0].language : null;
}
const chinese = new Set(['NetEase', 'QQMusic', 'Kugou']);
const textOf = (doc: SourceLyricsDocument) => doc.type === 'synced' ? doc.lines.map((l) => l.text).join('\n') : doc.type === 'plain' ? doc.text : '';
function majority(keys: string[], minimum: number): string | null {
  const counts = new Map<string, number>();
  keys.filter((k) => k !== 'unknown').forEach((k) => counts.set(k, (counts.get(k) || 0) + 1));
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  return ranked[0] && ranked[0][1] >= minimum && ranked[0][1] > (ranked[1]?.[1] || 0) ? ranked[0][0] : null;
}
const native = (script: Script) => script !== 'latin' && script !== 'unknown';
export function bestLyrics(documents: SourceLyricsDocument[], track: Track): SourceLyricsDocument | null {
  const candidates = documents.filter((d) => d.type !== 'missing').map((doc) => {
    const text = textOf(doc), script = dominantScript(text);
    return { doc, script, language: script === 'latin' ? latinLanguage(text) : null };
  });
  if (!candidates.length) return null;
  let reference = dominantScript([track.title, track.artist, track.album || ''].join(' '));
  if (!native(reference)) reference = candidates.find((c) => ['YouTubeMusic', 'YouTubeSubtitle'].includes(c.doc.source) && native(c.script))?.script || 'unknown';
  if (reference === 'han' && candidates.some((c) => c.script === 'kana')) reference = 'kana';
  const languageKeys = (list: typeof candidates) => {
    const keys = list.map((c) => c.script === 'latin' && c.language ? 'latin:' + c.language : c.script);
    const common = keys.filter((k) => k.startsWith('latin:')).sort((a, b) => keys.filter((k) => k === b).length - keys.filter((k) => k === a).length)[0];
    return keys.map((key) => key === 'latin' && common ? common : key);
  };
  const chineseSong = native(reference) ? reference === 'han' : !candidates.some((c) => c.script === 'kana') && majority(languageKeys(candidates.filter((c) => !chinese.has(c.doc.source))), 1) === 'han';
  const primary = candidates.filter((c) => c.doc.source !== 'YouTubeCaptions' && (chineseSong || !chinese.has(c.doc.source)));
  const secondary = candidates.filter((c) => chinese.has(c.doc.source) && c.script !== 'han');
  const pool = primary.length ? primary : secondary.length ? secondary : candidates.filter((c) => c.doc.source === 'YouTubeCaptions');
  const keys = languageKeys(pool), common = native(reference) ? null : majority(keys, 2);
  const trustedNative = new Set(pool.filter((c) => native(c.script) && (['kana', 'hangul'].includes(c.script) || pool.filter((p) => p.script === c.script).length >= 2)).map((c) => c.script));
  return pool.map((candidate, i) => {
    const { doc, script } = candidate;
    const scriptScore = native(reference) ? script === reference ? 3 : script === 'unknown' ? 1 : 0
      : common ? keys[i] === common ? 3 : script === 'unknown' ? 1 : 0
        : trustedNative.size ? trustedNative.has(script) ? 2 : script === 'unknown' ? 1 : 0
          : native(script) ? 0 : 1;
    const syncScore = doc.type === 'synced' ? doc.lines.some((l) => l.words?.length) ? 3 : 2 : 1;
    const voices = doc.type === 'synced' ? new Set(doc.lines.filter((l) => !l.isBackground).map((l) => l.agent || 'v1')) : new Set<string>();
    const duetScore = voices.size > 1 ? 2 : doc.type === 'synced' && doc.lines.some((l) => l.agent) ? 1 : 0;
    const order = lyricsProviders.findIndex((p) => p.id === doc.source);
    return { doc, score: scriptScore * 10000 + syncScore * 1000 + duetScore * 100 + (chineseSong && chinese.has(doc.source) ? 24 : 12) - Math.max(0, order) };
  }).sort((a, b) => b.score - a.score)[0]?.doc || null;
}
export function timingDetail(doc: SourceLyricsDocument | null, preference: LyricsDetail): Exclude<LyricsDetail, 'auto'> {
  if (!doc || doc.type !== 'synced' || preference === 'line') return 'line';
  if ((preference === 'auto' || preference === 'syllable') && doc.lines.some((l) => l.syllables?.length)) return 'syllable';
  if (doc.lines.some((l) => l.words?.length)) return 'word';
  return 'line';
}
/** The source id of lyrics the user wrote or corrected on this TV. It wins over every automatic pick. */
export const USER_EDITED = 'UserEdited';
export const isKnownSource = (id: string) => id === 'auto' || id === USER_EDITED || lyricsProviders.some((p) => p.id === id);

export interface LyricsSnapshot {
  trackId: string | null;
  source: string;
  results: SourceResult[];
  document: SourceLyricsDocument | null;
  complete: boolean;
  /** The user's own version, when there is one. */
  edited?: SourceLyricsDocument | null;
}
export class LyricsController {
  private generation = 0;
  private track: Track | null = null;
  private source = 'auto';
  private results: SourceResult[] = [];
  private edited: SourceLyricsDocument | null = null;
  constructor(private request: RequestLyrics, private changed: (snapshot: LyricsSnapshot) => void, preference = 'auto') {
    if (isKnownSource(preference)) this.source = preference;
  }
  snapshot(): LyricsSnapshot {
    const docs = this.results.flatMap((r) => r.document ? [r.document] : []);
    // A choice made by hand is never replaced by a slower answer: only the chosen source (or the user's own
    // version) is shown, and automatic picking applies to "auto" alone.
    const document = this.source === USER_EDITED ? this.edited
      : this.source === 'auto' ? this.edited ?? (this.track ? bestLyrics(docs, this.track) : null)
        : docs.find((d) => d.source === this.source && d.type !== 'missing') || null;
    return {
      trackId: this.track?.id || null, source: this.source, results: this.results, document, edited: this.edited,
      complete: this.source === USER_EDITED && this.edited !== null || this.results.every((r) => r.status !== 'waiting' && r.status !== 'loading'),
    };
  }
  /** Sets (or removes) the user's own version; it shows at once, ahead of the automatic pick. */
  setEdited(document: SourceLyricsDocument | null) {
    this.edited = document;
    if (!document && this.source === USER_EDITED) this.source = 'auto';
    this.changed(this.snapshot());
  }
  select(source: string) {
    if (!isKnownSource(source)) return;
    this.source = source;
    this.changed(this.snapshot());
  }
  cancel() { this.generation++; }
  start(track: Track, source?: string) {
    const generation = ++this.generation;
    this.track = track;
    if (source !== undefined && isKnownSource(source)) this.source = source;
    this.results = lyricsProviders.map((p) => ({ id: p.id, status: 'waiting' }));
    this.changed(this.snapshot());
    const queue = [...lyricsProviders].sort((a, b) => Number(b.id === this.source) - Number(a.id === this.source));
    let next = 0;
    const worker = async () => {
      while (next < queue.length && generation === this.generation) {
        const provider = queue[next++];
        this.results = this.results.map((r) => r.id === provider.id ? { id: r.id, status: 'loading' } : r);
        this.changed(this.snapshot());
        let result: SourceResult;
        try {
          const document = await this.request(provider.id, track);
          result = { id: provider.id, status: document.type, document: { ...document, source: provider.id } };
        } catch (error) {
          result = { id: provider.id, status: 'error', error: error instanceof Error ? error.message : tr('err.lyrics.sourceDown') };
        }
        if (generation !== this.generation) return;
        this.results = this.results.map((r) => r.id === provider.id ? result : r);
        this.changed(this.snapshot());
      }
    };
    for (let i = 0; i < 4; i++) void worker();
  }
}
