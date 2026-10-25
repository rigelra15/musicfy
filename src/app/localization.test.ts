import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('..', import.meta.url).pathname;
const SKIP = /(\.test\.|testkit|\/i18n\.ts$|genreDescriptions|lyrics\/selection\.ts|backup\/register\.ts)/;
const INDONESIAN = /\b(tidak|belum|gagal|coba lagi|dulu|akun|layanan|sambungan|dibaca|ditemukan|periksa koneksi|sebentar lagi)\b/i;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) && !SKIP.test(path) ? [path] : [];
  });
}

describe('localization guard', () => {
  it('keeps user-facing Indonesian text in the translation tables, not in code', () => {
    const offenders: string[] = [];
    for (const path of files(ROOT)) {
      readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        for (const match of line.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) {
          if (match[2].includes(' ') && INDONESIAN.test(match[2])) offenders.push(`${path.replace(ROOT, 'src/')}:${index + 1}: ${match[2].slice(0, 80)}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
