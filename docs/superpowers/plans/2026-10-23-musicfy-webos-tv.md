> **HISTORIS (24 Oktober 2026):** rencana ini digantikan oleh [2026-10-24-musicfy-webos-full-adaptation.md](2026-10-24-musicfy-webos-full-adaptation.md). Pembatasan scope "search/player saja" di dokumen ini tidak berlaku lagi.

# Musicfy webOS TV Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task by task. Steps use checkbox syntax for tracking.

**Goal:** Build a standalone Musicfy TV app for LG webOS 25, package it as an installable IPK, and verify its TV-first search, playback, queue, and lyrics flow.

**Architecture:** Create a separate Preact/Vite app under webos-tv. Keep catalog lookup, stream resolution, HTML audio playback, lyrics, and remote navigation behind focused modules. Android casting remains the existing CAF receiver path and does not connect to the IPK.

**Tech Stack:** Preact 10, TypeScript, Vite, Vitest, HTMLMediaElement, LG webOS CLI 3.2.6.

**Spec:** docs/superpowers/specs/2026-10-23-musicfy-webos-tv-design.md

## Global Constraints

- Target LG 43UA7550PSA running webOS 25.
- Use Preact, TypeScript, and Vite in a separate webos-tv project.
- Set Vite base to ./ so packaged assets resolve from the IPK app directory.
- First release supports guest YouTube Music search and audio playback only.
- No account sign-in, Android database sync, downloads, crossfade, local phone-to-TV API, or cloud relay.
- CAF and the webOS IPK own separate playback sessions.
- Do not commit, log, or persist temporary stream URLs.
- Do not add Luna APIs or privileged capabilities without a verified need.
- Keep generated IPKs and Vite build output out of source control.
- A simulator can validate UI and remote navigation, but only the actual TV can validate audio playback.

## Review Focus

- Packaged asset paths must stay relative; the Vite build test inspects the built HTML and copied app metadata in Task 1.
- Remote navigation must keep visible focus and remain inside the available control grid; focus movement and boundary behavior are tested in Task 2.
- Search responses may omit fields or return non-song rows; parser behavior for mixed, partial, and empty results is tested in Task 3.
- Stream URLs may be expired, ciphered, or require headers the TV cannot send; resolver tests cover expiry and unsupported formats in Task 4, with actual playback checked in Task 6.
- Playback resolution can finish after the user selects another track; Task 4 tests that stale loads cannot replace the active track.
- Lyrics may be absent, plain, malformed, or timed in milliseconds; parsing, matching, and fallback behavior are tested in Task 5.

---

### Task 1: WebOS app scaffold and IPK packaging

**Files:**
- Create: webos-tv/package.json, webos-tv/package-lock.json, webos-tv/vite.config.ts, webos-tv/tsconfig.json, webos-tv/index.html
- Create: webos-tv/public/appinfo.json, webos-tv/public/icon.png, webos-tv/public/largeIcon.png
- Create: webos-tv/src/main.tsx, webos-tv/src/styles.css
- Create: webos-tv/src/platform/appInfo.test.ts, webos-tv/.gitignore, webos-tv/README.md

**Interfaces:**
- App metadata has id com.musicfy.webos, version 0.1.0, vendor Musicfy, type web, main index.html, title Musicfy, icon icon.png, largeIcon largeIcon.png, and requiredACG [].
- Vite emits a self-contained app directory at webos-tv/dist with index.html, assets, appinfo.json, and icons.
- npm run package:ipk builds the app, then runs ares-package dist -o artifacts.

- [x] Step 1: Write a failing app metadata test that loads public/appinfo.json and checks every required field, empty requiredACG, and both icon paths.
- [x] Step 2: Run the focused Vitest test and confirm it fails because appinfo.json does not exist.
- [x] Step 3: Add the Preact/Vite TypeScript scaffold, metadata, icons, and package scripts. Configure base ./ and keep dist and artifacts ignored.
- [x] Step 4: Run the metadata test, typecheck, and production build. Verify built index.html references relative assets and dist contains appinfo.json and icons.
- [x] Step 5: Run ares-package --check dist, package the IPK, and inspect it with ares-package --info. Confirm the embedded app id is com.musicfy.webos.

### Task 2: Remote-first app state and navigation

**Files:**
- Create: webos-tv/src/model.ts, webos-tv/src/appState.ts, webos-tv/src/focusNavigation.ts
- Create: webos-tv/src/focusNavigation.test.ts, webos-tv/src/appState.test.ts
- Modify: webos-tv/src/App.tsx, webos-tv/src/styles.css

**Interfaces:**
- Track contains id, title, artist, optional album, optional artworkUrl, and durationMs.
- PlaybackSnapshot contains status, positionMs, durationMs, and an optional user-facing error.
- FocusCell contains id, row, column, and optional disabled.
- moveFocus(currentId, direction, cells) returns the nearest enabled cell in that direction or currentId when none exists.
- App state tracks the current view, search query, result list, queue, current track index, playback snapshot, and lyrics status through `query/changed`, `search/started`, `search/succeeded`, `search/failed`, `queue/added`, `queue/selected`, `playback/updated`, `lyrics/updated`, and `view/changed` actions.

- [x] Step 1: Write failing tests for moving in each direction, skipping disabled cells, remaining at grid edges, and returning the current focus for an unknown cell.
- [x] Step 2: Run the focused tests and confirm the focus helper is missing.
- [x] Step 3: Implement the focus-grid helper and a typed app-state reducer. Use stable action names for query changes, search completion/failure, queue selection, playback updates, and view changes.
- [x] Step 4: Run focus and reducer tests. Assert that selecting a queued track changes the active index without deleting duplicate tracks.
- [x] Step 5: Build the search, player, queue, and lyrics shells. Handle Arrow keys, Enter, and Escape/Back; keep visible focus and use the TV's native text input keyboard.
- [x] Step 6: Run all webos-tv tests, typecheck, and production build. Use the webOS Simulator or TV once available to check focus order and overscan-safe layout.

### Task 3: YouTube Music search

**Files:**
- Create: webos-tv/src/data/youtubeMusic.ts, webos-tv/src/data/youtubeMusic.test.ts
- Create: webos-tv/src/data/fixtures/youtube-search.json
- Create: webos-tv/postman/mocks/youtube-music/config.yaml, webos-tv/postman/mocks/youtube-music/default.js
- Create: webos-tv/postman/simulations/youtube-music.sim.yaml
- Modify: webos-tv/src/App.tsx, webos-tv/src/appState.ts

**Interfaces:**
- parseSearchResponse(payload) returns normalized Track items and ignores non-song rows.
- searchSongs(query, fetcher) returns Promise<Track[]> and throws a typed error for HTTP or malformed-response failures.
- searchSongs sends a guest WEB_REMIX search request and does not read Android cookies or account data.

- [x] Step 1: Write parser tests for a normal song, a missing album/artwork field, non-song rows, an empty shelf, and an invalid response.
- [x] Step 2: Run the tests and confirm the parser is missing.
- [x] Step 3: Port only the WEB_REMIX song-search mapping needed by the TV app from providers/innertube. Keep the network call injectable for tests.
- [x] Step 4: Run parser tests, including assertions that partial metadata stays optional instead of failing the whole result list.
- [x] Step 5: Connect the search view to searchSongs. Show loading, empty, success, and retryable error states without losing the query.
- [x] Step 6: Run the package tests and verify a live search from the Simulator or TV when a device is available; record CORS or API restrictions rather than adding a proxy.

### Task 4: Stream resolution and HTML audio playback

**Files:**
- Create: webos-tv/src/data/youtubePlayback.ts, webos-tv/src/data/youtubePlayback.test.ts
- Create: webos-tv/src/data/fixtures/youtube-player.json, webos-tv/src/data/fixtures/youtube-sw-js-data.txt
- Create: webos-tv/src/playback/htmlAudioPlayer.ts, webos-tv/src/playback/htmlAudioPlayer.test.ts
- Modify: webos-tv/src/App.tsx, webos-tv/src/appState.ts, webos-tv/src/styles.css
- Modify: webos-tv/postman/mocks/youtube-music/default.js

**Interfaces:**
- ResolvedStream contains url, mimeType, and expiresAtMs when supplied by the response.
- resolveAudioStream(videoId, fetcher, nowMs) returns Promise<ResolvedStream>; it uses the guest VISIONOS player request pattern from YTPlayerUtils and reports unsupported ciphered or header-dependent formats explicitly.
- HtmlAudioPlayer exposes load(track), play(), pause(), seekTo(positionMs), subscribe(listener), and dispose().
- A later stream request invalidates an earlier unresolved load.

- [x] Step 1: Write tests for a direct audio URL, a missing URL, an expired URL, an unsupported ciphered format, and a stale resolution completing after a newer track.
- [x] Step 2: Run the focused tests and confirm resolution and playback modules are missing.
- [x] Step 3: Implement the minimal no-login VISIONOS player request with guest visitorData and audio-format selection. Never include cookies, PoTokens, or stream URLs in logs.
- [x] Step 4: Implement the HTMLAudioElement adapter with explicit listeners for loadedmetadata, timeupdate, waiting, playing, pause, ended, and error.
- [x] Step 5: Run resolver and adapter tests with a fake fetcher and fake audio element. Verify seek units remain milliseconds at the app boundary.
- [x] Step 6: Connect result selection and queue controls to the adapter. Attempt a real stream on the webOS runtime when it is reachable; if the TV requires unsupported headers, stop and report the evidence. The configured TV timed out, so device playback remains unverified.

### Task 5: Lyrics lookup and timed presentation

**Files:**
- Create: webos-tv/src/data/lrclib.ts, webos-tv/src/data/lrcParser.ts
- Create: webos-tv/src/data/lrclib.test.ts, webos-tv/src/data/lrcParser.test.ts
- Modify: webos-tv/src/App.tsx, webos-tv/src/styles.css

**Interfaces:**
- LyricsDocument is one of synced lines, plain text, or missing.
- parseLrc(text) returns ordered lines with timeMs and text, ignoring malformed timestamp rows.
- loadLyrics(track, fetcher) queries LRCLIB GET /api/search with track_name, artist_name, and optional album_name; it locally prefers timed results matching duration.
- The browser request uses no authentication and no forbidden User-Agent header.

- [x] Step 1: Write tests for multiple LRC timestamps, centisecond normalization, malformed rows, duplicate timestamps, plain lyrics, and no lyrics.
- [x] Step 2: Run the parser tests and confirm the parser is missing.
- [x] Step 3: Implement parseLrc and loadLyrics. Convert the Musicfy duration from milliseconds to seconds only for local candidate matching; do not send a duration query until the upstream unit is verified.
- [x] Step 4: Test synced/plain/missing fixtures, empty search results, HTTP 429, and malformed JSON. Do not retry 429 in a tight loop.
- [x] Step 5: Render current and adjacent lines, highlight the active line from PlaybackSnapshot.positionMs, and retain readable lyrics when no timed match exists.
- [x] Step 6: Run all tests, typecheck, and production build. Check lyrics screen focus, contrast, and readability in the local browser preview; simulator and physical TV are unavailable.

### Task 6: Device acceptance and delivery notes

**Files:**
- Modify: webos-tv/README.md
- No generated IPK or build output is committed.

**Interfaces:**
- Build commands are npm ci, npm test, npm run typecheck, npm run build, and npm run package:ipk.
- Physical installation uses ares-install IPK_FILE -d LGTV43; launch uses ares-launch com.musicfy.webos -d LGTV43.

- [x] Step 1: Run the complete webos-tv test, typecheck, and production build suite.
- [x] Step 2: Build and inspect the IPK with ares-package --info. Confirm app id, entry point, app metadata, icons, and relative asset paths.
- [x] Step 3: Check Simulator availability; none is installed. Local browser preview covers UI only, not audio playback.
- [x] Step 4: Check the configured LGTV43 target; `ares-device -i -d LGTV43` times out, so installation and physical playback remain pending.
- [x] Step 5: Record browser, package, Simulator, and physical-TV checks; the TV is unreachable, so physical playback is pending.
- [x] Step 6: Update the README with exact setup and test commands and known source limitations.

## Plan self-review

- Spec coverage: standalone launch, search, remote navigation, player, queue, lyrics, IPK packaging, Cast separation, and actual-TV validation each have an owning task.
- Failure cases: relative paths, missing metadata, malformed search responses, expired streams, unsupported ciphered formats, stale loads, missing lyrics, and 429 responses have focused tests.
- Device limits: the VS Code extension currently installed is absent; LG recommends webOS Studio. The host is Apple Silicon, where the legacy VirtualBox Emulator is unsupported. LG's current Simulator tooling tops out at webOS TV 24 and does not prove media playback on this webOS 25 TV.
- No commit or push is included; the implementation stays on feat/webos-tv-app.
