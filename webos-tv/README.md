<div align="center">

<img src="assets/cover.png" alt="Musicfy for LG webOS TV" width="100%">

# Musicfy for LG webOS TV

**An unofficial TV port of [Musicfy](https://github.com/realidkroo/musicfy), made for the remote.**

Synced lyrics, your library and several audio sources on the big screen. Open source, and it does not collect your data.

</div>

---

## Credits and origin

Musicfy is the idea and work of **[realidkroo](https://github.com/realidkroo)** and **[realkeichi](https://github.com/realkeichi)**: [realidkroo/musicfy](https://github.com/realidkroo/musicfy), the Android app this project follows. This TV app is an independent port by [Rigel Ramadhani Waloni](https://github.com/rigelra15). It is **not** an official release of the original project and is not endorsed by its authors.

What comes from the original app, and is credited to it:

- The product itself: the design language, the screens and their order, the onboarding flow and its texts, the settings and their defaults, the audio source and lyrics-provider contracts, the Last.fm / Libre.fm scrobbling rules and the phone-to-TV transfer idea.
- The onboarding icons, which are read straight from the Android app's vector drawables (`scripts/build-icons.mjs` reads `app/src/main/res/drawable/*.xml`).

What is new here: the webOS runtime (a Preact + TypeScript UI plus a Node 16 service that runs on the TV itself), remote-control focus handling, the TV layouts, and the port of each feature to a TV. The TV code is written from scratch for the web platform. It is not a copy of the Kotlin sources, but it follows the original's behaviour closely, which is why it is published under the same license (below).

If you like this, please also look at, and star, the original project.

## License

This project is licensed under the **GNU General Public License v3.0** (see [`LICENSE`](LICENSE)), the same license as the original Musicfy, because it is derived from it. Anyone who receives the app (including the `.ipk`) is entitled to its source code under the same terms. Changes made here relative to the original are described in this README and in the commit history.

The names and logo "Musicfy" belong to the original project. This port keeps the name and icon only to show where it comes from. If you publish your own build, say clearly that it is unofficial.

Third-party parts keep their own licenses:

| Part | License |
| --- | --- |
| webOSTV.js 1.2.13 (LG) | Apache 2.0, bundled in `public/vendor/webOSTVjs-1.2.13/` |
| Lucide icons | ISC, text in `public/vendor/lucide-LICENSE.txt` |
| Inter font | SIL Open Font License 1.1 |
| shaka-player, preact, iconify-icon, qrcode-generator | their own licenses, see `package.json` |

## What it does

- **Home, Search, Library and Settings** in the phone's style: shelves, genre and mood pages, history, statistics, playlists, likes and pins, all kept on the TV.
- **Player** with cover, controls and lyrics side by side, five player presets, a blurred cover backdrop, a queue panel, a sleep timer and playback speed.
- **Synced lyrics** from many providers, by line, word or syllable, with grouped backing vocals, translation and readings. Timing is never made up: if a source has only line times, only line times are used.
- **Audio sources:** YouTube Music (no account), Monochrome (lossless FLAC, no account) and Apple Music through a session sent from your phone.
- **Moving in:** transfer your collection from the phone over the home network (QR pairing), import a backup file or CSV, or read a playlist link (Spotify, Apple Music, Deezer, YouTube).
- **Last.fm / Libre.fm** scrobbling, signed in on the phone side (no keys are built in).
- **Indonesian and English**, switchable in Settings and following the TV language on first run.
- **Remote first:** every screen works with the D-pad, OK and Back. The Magic Remote pointer works too (hover chevrons on shelves, auto-hiding navbar on the player).

Left out on purpose, because they do not make sense on a TV: downloads, offline and local media, the audio lab (EQ and effects), Discord presence, and exporting to a file.

## Honest limits

- **Apple Music cannot be signed in on the TV itself.** Apple's sign-in only runs on `music.apple.com`, which cannot be embedded and whose token is only valid for the `apple.com` origin. Sign in on the phone and send the session to the TV instead (Settings, Modules, Apple Music). DRM playback of Apple Music on the TV is **not proven** yet.
- Not everything has been verified on a real TV. [`VALIDATION.md`](VALIDATION.md) lists what has been proven and what has not; the in-app Diagnostics screen shows the same honestly.
- External providers (lyrics, catalog, sources) can be limited or unavailable at any moment.

## Build

Requires Node 22.12+ and LG's webOS CLI (`ares-*`) on the computer.

```sh
cd webos-tv
npm ci
npm test
npm run typecheck
npm run package:ipk
```

The package ends up in `artifacts/com.musicfy.webos_<version>_all.ipk`. Packaging clears any development API overrides, so a computer address can never become a runtime dependency of the TV app.

## Install on the TV

Enable Developer Mode on the TV and pair it once with the webOS CLI, then:

```sh
ares-install -d <your-tv> artifacts/com.musicfy.webos_<version>_all.ipk
ares-launch -d <your-tv> com.musicfy.webos
```

After installing, open it from the TV like any app. A Developer Mode install is subject to LG's session rules and is not a Content Store release.

## Develop

```sh
npm run dev -- --port 4177
```

The dev server uses the same `service/runtime.cjs` handler as the TV service, so what you see in the browser is close to the TV. It is only a preview and is not needed by the installed app. The service uses Node 16 core HTTPS streams, binds only to `127.0.0.1` on an ephemeral port and hands the session address to the UI over a Luna subscription. Audio goes through opaque, expiring tokens; arbitrary URLs are never proxied.

More detail:

- [`server/API.md`](server/API.md): the service contracts
- [`VALIDATION.md`](VALIDATION.md): what is proven on the TV and what is not
- [`TRANSFER.md`](TRANSFER.md): the phone-to-TV pairing protocol
- [`UI-CONSISTENCY.md`](UI-CONSISTENCY.md): the layout rules
