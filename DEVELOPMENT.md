# Musicfy for LG webOS TV: developer notes

The overview, credits, install guide and license are in the [README](README.md); this file is for people changing the code.

## Layout

| Path | What it is |
| --- | --- |
| `src/` | The Preact + TypeScript UI: `app/` (shell, router, remote control, i18n), `pages/`, `features/`, `playback/`, `lyrics/`, `library/` (IndexedDB), `sources/`, `backup/`, `importers/` |
| `service/` | The Node 16 service that runs on the TV (`runtime.cjs` is the HTTP handler): catalog, lyrics, sources, links, scrobbling, phone transfer |
| `server/` | Tests and fixtures for the service, and [`API.md`](server/API.md) with its contracts |
| `public/` | `appinfo.json` (id, version, 1280x720 resolution), icons, fonts, the bundled webOSTV.js |
| `scripts/` | Packaging (`package-ipk.mjs`) and generators (icons, mock fixtures) |
| `assets/` | The README cover (`cover.svg` is the source of `cover.png`) |

## Commands

```sh
npm ci
npm run dev -- --port 4177   # browser preview, uses the same service handler as the TV
npm run typecheck
npm test
npm run build
npm run package:ipk          # needs the webOS CLI: npm i -g @webos-tools/cli
```

Packaging clears any development API overrides, so a computer address can never become a runtime dependency of the installed app. The output is `artifacts/com.musicfy.webos_<version>_all.ipk`; the version comes from `public/appinfo.json`.

## How it runs on the TV

The service uses Node 16 core HTTPS streams (not desktop `fetch`), binds only `127.0.0.1` on an ephemeral port and returns the session address to the UI over a Luna subscription. Closing the app cancels the subscription, destroys the sockets and releases the service. Audio is served through opaque, expiring tokens and byte ranges; neither arbitrary API URLs nor arbitrary media hosts are proxied. The app asks for a 1280x720 viewport (`resolution` in `appinfo.json`), so the layout is the same on 1080p and 4K TVs.

## Player and lyrics

- Cover, metadata, seek and transport sit on the left of the player and the lyrics fill the rest. Extra options are in the ellipsis menu: player presets, cover styles, disc rotation, lyrics source, detail (line, word, syllable), motion style, translation and readings.
- Lyrics read the real audio clock on animation frames and pause when playback or the page is hidden. Lines that overlap (a backing or echo line that starts while the main line is still sung) are grouped from the source's own timing; a group stops being the sung one when its last word ends. Timing is never made up.
- The navbar slides away after a few idle seconds on the player and the page moves up with it; any key press or pointer move brings it back.

## Remote control

D-pad moves between focusable elements by their `data-focus-row` and `data-focus-column`; OK activates, Back goes back or closes the top overlay, and media keys control playback. Scrollable panes keep the arrows until they reach their edge. See `src/app/remote.ts`.

## More

- [`server/API.md`](server/API.md): service contracts
- [`VALIDATION.md`](VALIDATION.md): what is proven on the TV and what is not
- [`TRANSFER.md`](TRANSFER.md): the phone-to-TV pairing protocol
- [`UI-CONSISTENCY.md`](UI-CONSISTENCY.md): layout rules
