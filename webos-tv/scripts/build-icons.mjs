// Regenerates src/components/playerIcons.json from the Lucide pack. Only the icons listed here
// ship in the app (the full pack is ~1,700 icons). Add a name, run `node scripts/build-icons.mjs`.
import { readFileSync, writeFileSync } from 'node:fs';

const NAMES = [
  'play', 'pause', 'skip-back', 'skip-forward', 'ellipsis', 'ellipsis-vertical', 'volume-2', 'volume-1', 'volume-x', 'list-music', 'disc-3', 'captions', 'x', 'rotate-ccw',
  'shuffle', 'repeat', 'repeat-1', 'trash-2', 'house', 'search', 'library', 'heart', 'list-plus', 'list-end', 'list-start', 'timer', 'gauge', 'share-2', 'info', 'user', 'settings',
  'chevron-left', 'chevron-right', 'chevron-down', 'chevron-up', 'check', 'plus', 'pencil', 'download', 'languages', 'mic', 'music', 'album', 'user-round', 'clock', 'history',
  'chart-column', 'folder', 'wifi', 'qr-code', 'refresh-cw', 'circle-alert', 'hard-drive', 'arrow-up', 'arrow-down', 'grip-vertical', 'pin', 'pin-off', 'radio', 'cast', 'speaker',
  'sliders-horizontal', 'moon', 'import', 'upload', 'cloud-off', 'link', 'lock', 'sparkles', 'palette', 'heart-off', 'circle-check', 'layout-grid', 'puzzle', 'file-music',
  'video', 'sun', 'minus', 'arrow-left',
];
const pack = JSON.parse(readFileSync('node_modules/@iconify-json/lucide/icons.json', 'utf8'));
const out = {};
const missing = [];
for (const name of NAMES) {
  const resolved = pack.icons[name] ? name : pack.aliases?.[name]?.parent;
  const icon = resolved && pack.icons[resolved];
  if (!icon) { missing.push(name); continue; }
  out[name] = { width: icon.width ?? pack.width ?? 24, height: icon.height ?? pack.height ?? 24, body: icon.body };
}
if (missing.length) { console.error('missing icons:', missing.join(', ')); process.exit(1); }

// Onboarding's own glyphs are the phone app's Android vector drawables, read as they are (as `onb-<name>`).
const DRAWABLES = ['download', 'playlist_add', 'backup', 'person', 'home', 'library_music', 'check', 'add', 'edit', 'warning', 'tune', 'favorite'];
const attr = (tag, name) => new RegExp('android:' + name + '="([^"]*)"').exec(tag)?.[1];
for (const name of DRAWABLES) {
  const xml = readFileSync('../app/src/main/res/drawable/' + name + '.xml', 'utf8');
  const root = /<vector[^>]*>/.exec(xml)[0];
  const width = Number(attr(root, 'viewportWidth')), height = Number(attr(root, 'viewportHeight'));
  const body = [...xml.matchAll(/<path[^>]*>/g)].map(([tag]) => {
    const fill = attr(tag, 'fillColor'), stroke = attr(tag, 'strokeColor'), strokeWidth = attr(tag, 'strokeWidth');
    const parts = ['d="' + attr(tag, 'pathData') + '"'];
    parts.push(fill && fill !== '#00000000' ? 'fill="currentColor"' : 'fill="none"');
    if (attr(tag, 'fillType') === 'evenOdd') parts.push('fill-rule="evenodd"');
    if (stroke) parts.push('stroke="currentColor" stroke-width="' + (strokeWidth ?? 1) + '"' + (attr(tag, 'strokeLineCap') ? ' stroke-linecap="' + attr(tag, 'strokeLineCap') + '"' : '') + (attr(tag, 'strokeLineJoin') ? ' stroke-linejoin="' + attr(tag, 'strokeLineJoin') + '"' : ''));
    return '<path ' + parts.join(' ') + '/>';
  }).join('');
  out['onb-' + name.replace('_', '-')] = { width, height, body };
}
writeFileSync('src/components/playerIcons.json', JSON.stringify(out) + '\n');
console.log('wrote', Object.keys(out).length, 'icons');
