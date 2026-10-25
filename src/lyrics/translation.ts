import { runtimeFetch } from '../platform/runtime';
import { tr } from '../app/i18n';

/** Target languages offered in the picker (name in its own language, code for the translator). */
export const LANGUAGES = [
  { code: 'id', name: 'Indonesia' }, { code: 'en', name: 'English' }, { code: 'es', name: 'Español' }, { code: 'pt', name: 'Português' },
  { code: 'fr', name: 'Français' }, { code: 'de', name: 'Deutsch' }, { code: 'it', name: 'Italiano' }, { code: 'nl', name: 'Nederlands' },
  { code: 'tr', name: 'Türkçe' }, { code: 'ru', name: 'Русский' }, { code: 'uk', name: 'Українська' }, { code: 'ar', name: 'العربية' },
  { code: 'hi', name: 'हिन्दी' }, { code: 'th', name: 'ไทย' }, { code: 'vi', name: 'Tiếng Việt' }, { code: 'ms', name: 'Melayu' },
  { code: 'tl', name: 'Filipino' }, { code: 'ja', name: '日本語' }, { code: 'ko', name: '한국어' }, { code: 'zh-CN', name: '中文 (简体)' },
  { code: 'zh-TW', name: '中文 (繁體)' }, { code: 'pl', name: 'Polski' }, { code: 'sv', name: 'Svenska' }, { code: 'jw', name: 'Basa Jawa' },
] as const;

export type TranslateFn = (lines: string[], source: string, target: string, signal?: AbortSignal) => Promise<string[]>;

export class TranslationError extends Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = 'TranslationError'; }
}

/** Asks the TV's service to translate, line for line. The answer always has as many lines as the question. */
export const requestTranslation: TranslateFn = async (lines, source, target, signal) => {
  let response: Response;
  try {
    response = await runtimeFetch('/api/translate', { method: 'POST', credentials: 'omit', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines, source, target }) });
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') throw error;
    throw new TranslationError(tr('err.translate.network'));
  }
  if (!response.ok) {
    let message = response.status === 429 ? tr('err.translate.limited') : tr('err.translate.failed');
    try { const body = await response.json(); if (typeof body?.error === 'string') message = body.error; } catch { /* keep the default */ }
    throw new TranslationError(message, response.status);
  }
  const body = await response.json().catch(() => undefined);
  if (!body || !Array.isArray(body.lines) || body.lines.length !== lines.length || body.lines.some((line: unknown) => typeof line !== 'string')) {
    throw new TranslationError(tr('err.translate.failed'));
  }
  return body.lines as string[];
};

export const translationKey = (trackKey: string, source: string, target: string) => `translation:${trackKey}:${source}>${target}`;

/** A line that comes back the same as it went in is already in the target language: showing it twice only doubles it. */
export function dropUnchanged(original: readonly string[], translated: readonly string[]): Array<string | null> {
  return translated.map((line, i) => {
    const text = line.trim();
    return !text || text.toLowerCase() === (original[i] ?? '').trim().toLowerCase() ? null : text;
  });
}
