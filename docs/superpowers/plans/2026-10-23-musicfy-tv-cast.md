# Musicfy TV Cast Implementation Plan

> **For agentic workers:** implement task by task with the `superpowers:executing-plans` skill. Use checkboxes to track progress.

**Goal:** Add an opt-in custom Google Cast receiver for YouTube music with a Musicfy player and synchronized lyrics UI.

**Architecture:** Keep Android GMS as the Cast sender and CAF as the sole receiver playback engine. Build a separate static Preact/Vite/TypeScript receiver under `cast-receiver/`; send metadata and lyrics over a versioned Cast namespace. Preserve the Default Receiver when no custom app ID is configured.

**Tech Stack:** Kotlin, Android Media3 Cast, Google Cast CAF, Preact, TypeScript, Vite, GitHub Pages.

**Spec:** This plan implements the Musicfy TV design approved in the conversation on 2026-10-23. No separate design file existed at planning time.

## Global Constraints

- Scope: private, YouTube streaming, Android GMS build and LG 43UA7550PSA compatibility.
- No audio relay/backend, TV login, credentials on receiver, or automatic receiver fallback.
- CAF owns playback; Preact renders presentation and lyrics.
- Keep FOSS builds working and preserve existing local changes.
- Physical LG playback and Cast Console registration remain external acceptance gates.

## Review Focus

- A source URL may expire or require headers the receiver cannot send; gate the UI rollout on direct playback evidence.
- Track IDs can repeat in a queue; correlate each queue entry independently.
- Lyrics use mixed time units; normalize word and line times to milliseconds.
- Old async lyrics or stream responses may arrive after a track switch; reject stale revisions.
- The configured Pages path and Cast app ID may be absent; preserve current default behavior and prevent a broken deploy.

---

### Task 1: CAF receiver foundation and presentation

**Files:** create `cast-receiver/package.json`, `cast-receiver/vite.config.ts`, `cast-receiver/index.html`, `cast-receiver/src/*`, and receiver tests.

**Interface:** implement CAF-backed UI modes `player`, `lyrics`, and `artwork`; accept versioned media/lyrics snapshots and render loading, playback, empty-lyrics, and error states. Keep CAF media element outside the Preact-rendered subtree.

- [x] Add Preact/Vite/TypeScript app with CAF external script and local demo fixtures.
- [x] Add responsive 16:9 player and lyrics-focus layouts.
- [x] Add unit tests for active line selection, UTF-8 chunk sizing, bounded lyric assembly, and stale revision rejection.
- [x] Run receiver tests, type check, and production build.

### Task 2: Sender configuration and safe media descriptor

**Files:** modify `app/build.gradle.kts`, `app/src/gms/kotlin/com/example/musicfy/cast/CastOptionsProvider.kt`, `app/src/gms/kotlin/com/example/musicfy/playback/CastConnectionHandler.kt`, and corresponding FOSS Cast options/handler as needed.

**Interface:** `CastStreamDescriptor(mediaId: String, url: String, mimeType: String, codecs: String?, durationMs: Long?, expiresAtMs: Long?)`. Resolve a custom app ID from Gradle property `MUSICFY_CAST_APP_ID`; when unset, retain the default receiver. Never send or log stream headers/cookies.

- [x] Preserve the Default Media Receiver when the custom application ID is not configured.
- [x] Use resolver MIME type for current track and queued tracks instead of hardcoded `audio/mp4`.
- [x] Add stable queue-entry identity separate from media ID and append every prepared queue item.
- [x] Re-register the custom channel on reconnect and pause local audio after Cast reports the matching item loaded.
- [x] Build the GMS and FOSS variants.

### Task 3: Versioned lyrics channel and sender synchronization

**Files:** create focused protocol/lyrics adapter files under `app/src/gms/kotlin/com/example/musicfy/cast/`; use existing `LyricsHelper`, database, and parser.

**Interface:** namespace `urn:x-cast:com.musicfy.tv.v1`. Messages use `{version, type, requestId, senderSessionId, mediaId, queueEntryId, revision, data}`. Lyrics are UTF-8 chunks ≤16 KiB; complete payload ≤1 MiB; receiver ACK timeout is 5s with one retry.

- [x] Normalize line and word timestamps to milliseconds and reject stale sender sessions, queue entries, snapshots, and lyric transfers.
- [x] Request cached/provider lyrics off the UI thread without opening the lyrics screen.
- [x] Send snapshots after receiver readiness, reconnect, and queue-entry changes.
- [x] Keep phone playback controls routed to Cast and synchronize status/position.
- [x] Run receiver protocol tests and both Android variant builds.

### Task 4: Pages workflow and acceptance gate

**Files:** add `.github/workflows/deploy-cast-receiver.yml`; configure receiver deployment base path for the Musicfy Pages URL.

- [x] Verify existing Pages configuration and ensure the receiver path does not replace an existing site (checked read-only on 2026-10-23: the public repository's Pages API returned 404, so no existing Pages site was configured).
- [x] Add CI checks for receiver test/typecheck/build and manual Pages deployment under `/musicfy/cast-receiver/`, guarded by explicit confirmation that replacing the existing Pages site is safe.
- [x] Enable GitHub Pages with GitHub Actions and publish the receiver; deploy run `39930158349` succeeded and the receiver URL returned HTTP 200.
- [ ] Use Google Cast Console to create the private receiver app, register the Cast device, and inject the app ID locally/through CI configuration without committing secrets.
- [ ] On the physical LG, prove custom receiver launch and one YouTube track through end, seek near middle/end, and next track.
- [ ] If custom launch or direct audio fails due to compatibility, CORS, required headers, or URL restrictions, stop and document evidence before proposing a different transport.
- [ ] Run the approved physical-device queue, background, reconnect, stop, expiry, and lyrics scenarios before calling the feature complete.

## Progress (2026-10-23)

- Implemented: TV player/lyrics UI, the documented v1 Cast message contract, bounded/retried lyric transfer, sender-session epochs, CAF-bound snapshots and lyrics, duplicate queue-entry synchronization, stale stream-load rejection, resolver MIME propagation, safe local-player handoff, configurable receiver App ID, and a guarded manual Pages workflow.
- Verified locally: receiver tests, typecheck, nested-path production build, dependency audit, GMS/FOSS Kotlin compilation and debug APK assembly, focused duplicate-queue identity tests, and final `git diff --check`.
- Published: GitHub Pages is configured for GitHub Actions; the custom receiver is live at `https://rigelra15.github.io/musicfy/cast-receiver/` (workflow `39930158349` succeeded and the page returned HTTP 200).
- Pending external acceptance: register the private Custom Web Receiver and LG TV in Cast Console, configure the generated App ID locally, rebuild/install the GMS app, and test the custom receiver on the physical LG.
- The Cast Console app ID and physical-TV acceptance are still pending; the existing Google Default Receiver test does not verify the custom UI.
