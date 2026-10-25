import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const publicDirectory = new URL('../../public/', import.meta.url);
const appInfoFile = new URL('../../public/appinfo.json', import.meta.url);

describe('webOS app metadata', () => {
  it('declares the Musicfy TV app identity and packaged icons', () => {
    const appInfo = JSON.parse(readFileSync(appInfoFile, 'utf8')) as Record<string, unknown>;

    expect(appInfo).toMatchObject({
      id: 'com.musicfy.webos',
      version: '0.4.0',
      vendor: 'Musicfy',
      type: 'web',
      main: 'index.html',
      title: 'Musicfy',
      icon: 'icon.png',
      largeIcon: 'largeIcon.png',
      requiredACG: [],
      // The app is laid out for a 1280-wide screen and the TV scales it up, so it looks the same on every TV size.
      resolution: '1280x720',
    });
    expect(existsSync(fileURLToPath(new URL(appInfo.icon as string, publicDirectory)))).toBe(true);
    expect(existsSync(fileURLToPath(new URL(appInfo.largeIcon as string, publicDirectory)))).toBe(true);
  });
});
