# Validation — 2026-10-23

## Version 0.4.0 — candidate (T18), computer only

Built `artifacts/com.musicfy.webos_0.4.0_all.ipk` (1013.7 KiB, sha256 `2b1fd434d4c3bbe6611d7c0d00cb7c26e0c1f5dab6f99047f655ec10b3548c76`). Not installed on any TV: nothing in this version has been run on a physical device.

Checked on the development computer (Node 22.22.2):
- 837 tests in 77 files pass; typecheck and Vite build pass. `ares-package --check dist service` reports no problems.
- The IPK holds the app (relative assets, no localhost address in the bundle) and the 14 service files; every service file loads from the unpacked package and the runtime answers `/api/scrobble/status`, `/api/sources/status`, `/api/transfer/status` and a bad `/api/import/link` (400).
- Versions are in step: `package.json`, lockfile, `public/appinfo.json`, `service/package.json`, `appInfo.test.ts`.
- Lifecycle (plan section 9): hiding the app pauses playback and saves the queue and position, stops import matching, closes pairing; coming back never resumes by itself; relaunch restores paused (`Shell.session.test.tsx`). Background playback stays **unverified**.
- Visual pass in the browser pane at 1280x720 and 1920x1080: Home, Search, Library, Queue, Settings, Import, link-import dialog: no page-level horizontal scroll, focusable elements present on each. Not a TV check.
- Live public pages of Spotify, Apple Music and Deezer were read through the link reader; a Deezer playlist of 100 songs imported 100/100 (matching against live YouTube Music search).

**On the TV (LG43UA7550PSA, 192.168.1.3, installed and opened with the owner's permission):** the app runs, the on-TV service answers its routes, a song played and paused. The TV gave the app a 1920x1080 viewport, so everything looked small next to the 1280-wide layout it was designed on; `appinfo.json` now declares `"resolution": "1280x720"`, and the TV then reports a 1280x720 viewport (devicePixelRatio 3), with the same margins as on the computer. Screenshots were taken through the app inspector.

**Not done / not proven**
- **Node 16 (desktop, v16.20.2, downloaded to a temporary folder and removed)**: the 0.4.0 package's service files all load; through the real runtime with stand-in upstreams the link import, the Last.fm sign-in and scrobble (secrets absent from status), transfer/sources status and the Origin check pass; ECDH/HKDF/AES-GCM work; the live `runtime-smoke` (search, session, player, audio range) returns 200/200/200 and 206 with 65536 bytes. The vitest suites themselves run only on Node 22 (the harness needs it), so Node 16 coverage is this scripted check, not all 837 tests. Still **not** the TV's own Node.
- Everything on the physical TV: install, launch, LAN pairing listener, phone transfer from a real phone, FLAC/Widevine/HLS playback, Apple Music session, translation endpoint, Last.fm/Libre.fm (no API keys installed), remote-control focus on every new screen.
- Android: the transfer screen and the camera scanner were only compiled (foss flavor) and unit-tested on the JVM; the fdroid flavor has pre-existing Cast compile errors that this work did not touch.
- Dropped by decision: downloads/offline/local files, Audio Lab, Discord, export-to-file from the TV; account import is blocked (see the parity matrix).

## Version 0.3.0 — localhost only

At the user's request, no TV connection, installation or device test was
performed for this revision. The existing device sessions were closed.

- Local browser at 1280×720: cover, metadata, seek, transport and volume at left;
  integrated detailed lyrics at right; no separate lyrics tab.
- Ellipsis dropdown contains appearance, source, detail and motion options.
- Arrow navigation reaches source, detail, motion and retry in order.
  Left/Right changes selected values; Escape closes the menu.
- Volume stays at its selected value after leaving and returning to the player.
- Actual local audio playback, pause and seek exercised through the UI.
  Word progress was observed between endpoints (12.2%); pausing froze both
  the audio clock and a partial word highlight.
- Local Apple Music result now retains38 lines including the opening verse.
  Screenshot: artifacts/ui-unified-player.png.
- Local0.3.0 IPK builds successfully and ares-package --check dist service
  reports no problems. No installation was performed.
- TTML regression: bare-second timestamps before one minute are preserved,
  including real word timings. The new test failed before the parser fix.
- Lyrics use the real media clock per animation frame, pause with the player and
  translate a stable rail only on line changes. This is local browser evidence;
  performance of this revision on physical webOS hardware remains unmeasured.

## Historical version 0.2.0 — physical TV


Target: actual LG43UA7550PSA.BTIJ6JD, webOS SDK10.3.2 (webOS25), firmware33.31.80,
192.168.1.3. The then-tested package was com.musicfy.webos0.2.0 with the on-device
com.musicfy.webos.service. ares-package confirms both app and service in one IPK;
ares-package --check dist service reports no problems.

## Physical device

- Installed and launched the packaged IPK successfully.
- Guest search returned20 real songs directly on the TV.
- Actual TV Node v16.20.2 executed the packaged runtime and received live
  search/session/player HTTP200, then audio HTTP206 and65536 bytes for a range.
- Physical TV player advanced past0:23,1:51 and2:55. User explicitly confirmed
  sound from TV speakers. Native media src uses the absolute on-TV session URL.
- Disc style changed on TV, rotated with playback, and persisted across package
  reinstall/relaunch. Final capture shows the selected disc playing from0:09.
- Stopped desktop Vite4175/4176 and Postman4901. Confirmed4175 and4176 offline.
  Relaunched the final IPK and repeated search/playback/disc on TV successfully.
  Computer-side inspector only displays the TV frame; it does not serve the app,
  APIs, lyrics or audio. Screenshot: artifacts/tv-standalone-disc.png.

## Lyrics live source probe

All12 adapters were called through the shared runtime using Yellow/Coldplay:
- BetterLyrics (Apple Music):38 timed lines, all with words,3 with syllables.
- YouLyPlus:41 timed lines, all with words,1 with syllables.
- SimpMusic:37 word-timed lines.
- Deezer:40 word-timed lines.
- NetEase:45 timed lines, all with words,2 with syllables (auto-language gating
  remains applied; availability alone does not force its selection).
- LrcLib:37 line-timed lines; KuGou:40; YouTubeCaptions:26.
- YouTubeMusic:plain text. QQMusic:valid missing result for this recording.
- Paxsenix and YouTubeSubtitle:unavailable during this live probe (HTTP502 at the
  adapter). No fake success or invented timing is substituted.

The probe proves real provider parsing/transport on desktop with the same
Node16-compatible service code. Physical TV then loaded Apple Music/BetterLyrics
from its on-device service and displayed moving word/syllable highlights with
credit "Apple Music - Per suku kata", while computer preview servers were offline.
Provider availability and recording matches can change.

## Automated and simulated

Version0.3.0:110 tests across18 files pass; typecheck and Vite build pass. Desktop Node16.20.2
runtime smoke also passes live. Existing Postman simulation reused real runtime
with only upstream address replacement; its logged search/session/player calls
all returned200. It establishes contract compatibility, not live decoding.

Fresh review fixed same-index queue loading lock, native absolute media base,
select focus exit, SimpMusic404 fallback, Paxsenix supplied word spaces and TTML
formatting syllable boundaries. Regression tests cover meaningful state/parser
failures. Media token, Origin/destination/redirect/body/range restrictions and
subscription cancellation are exercised. No commit, push or hosted deployment.

This is parity of the requested TV player options, not every Android feature or
pixel-identical Compose graphics. Computer is needed for development/install,
not normal playback. Developer Mode installation expiry remains LG-managed.
