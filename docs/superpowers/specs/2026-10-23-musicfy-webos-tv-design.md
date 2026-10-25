# Musicfy for LG webOS TV

**Status:** Approved design; implementation in progress

**Target device:** LG 43UA7550PSA, webOS 25
**Implementation branch:** feat/webos-tv-app

## Goal

Build an installable Musicfy TV app for LG webOS, packaged as an IPK, with a TV-first interface that works from the Magic Remote. Keep Android-to-TV casting as a separate Google Cast experience using the existing Cast receiver.

The product has two entry paths:

1. Launch Musicfy TV from the LG launcher to search and play music directly on the TV.
2. Cast from Musicfy on Android using Google Cast; the Cast system launches the existing CAF receiver, not the installed IPK.

The user approved these as separate paths. A future requirement for direct phone control of the installed IPK would need a separately designed local pairing and message bridge.

## Approaches

### 1. Separate runtimes — selected

Build a standalone webOS IPK for TV browsing and playback, while Android phone casting continues through the existing hosted Google Cast CAF receiver. This supports both requested ways to use Musicfy and reuses the current Cast sender path without introducing a second phone-to-TV network protocol. The tradeoff is that Cast launches the CAF receiver and does not control the installed IPK.

The user selected this approach in the conversation. It fits the TV-app goal while keeping the two runtime models explicit.

### 2. One IPK with a direct Android control bridge

The webOS app would support standalone search and playback and also accept direct commands from the Android app. This would provide one TV app experience, but needs a new pairing/discovery flow, a local control protocol, Android changes, and connection recovery/security work. A normal webOS app does not receive the current Cast namespace.

Deferred because the user approved keeping Google Cast as the phone-control path.

### 3. Package the CAF receiver as an IPK

This would try to reuse the current receiver without adding a second player. It is not viable: CAF is supplied by the Google Cast runtime, so an ordinary webOS IPK does not provide the Cast receiver context required by the current app.

## Existing project context

- The Android app is Kotlin-based and owns the current catalog, queue, stream resolution, and lyrics integrations.
- The current Cast receiver is a Preact/Vite web app that depends on the Google Cast Application Framework. It renders track and lyric UI, but CAF supplies the playback session.
- The Cast sender resolves YouTube Music playback URLs on Android before passing them to CAF. That Kotlin resolver cannot be called directly from a webOS app.
- The user has confirmed video and audio work through the LG TV's built-in Google Cast route. Custom receiver registration and physical verification of the Musicfy receiver remain separate acceptance work.

## Product scope

### First TV release

- Install and launch from the LG launcher using a sideloaded IPK.
- TV-first home/search view, playable search results, now-playing screen, queue, synchronized lyrics where available, and clear empty/loading/error states.
- Arrow, OK/Enter, and Back navigation with persistent visible focus, safe screen margins, and no assumption of a mouse or touch input.
- Audio playback, pause/resume, seek, previous/next, and queue selection using webOS-supported HTML media playback.
- Start with the YouTube Music catalog and audio path because it is the source used by the existing Cast playback implementation. Keep provider interfaces narrow so additional Musicfy sources can be added later.
- No account sign-in, Android database sync, downloads, crossfade, or full Android feature parity in this release.

### Explicitly separate Google Cast path

- Android continues to discover and control the TV through Google Cast.
- Google Cast launches the existing hosted CAF receiver. It does not launch or inject commands into the webOS IPK.
- The IPK and CAF receiver may share visual conventions and presentation helpers where that does not couple their playback/session code.
- No local phone-to-TV API or cloud relay is included in this release.

## Architecture

Create a separate webOS app under webos-tv using Preact, TypeScript, and Vite. Keep platform code behind small interfaces:

- TV application shell: route/view state, Magic Remote key handling, focus movement, and lifecycle behavior.
- Catalog/search provider: query and normalize YouTube Music search results.
- Stream resolver: resolve a selected track to a browser-playable audio URL, including expiry and recoverable errors.
- Playback adapter: own an HTML media element and expose play, pause, seek, next, previous, position, duration, and playback state to the UI.
- Lyrics provider and presentation: load timed lyrics, normalize timestamps to milliseconds, and follow the active line.
- Packaging step: assemble the built web assets, appinfo metadata, and icons into a webOS IPK using the LG CLI.

Keep the playback adapter independent from CAF. Reuse or extract presentation-only code from cast-receiver only if the shared boundary stays simple; do not make the webOS app initialize or depend on the Cast Application Framework.

### Playback flow

1. The user searches from the TV interface.
2. The catalog provider returns normalized track metadata.
3. The user selects a result and the stream resolver obtains a playable URL.
4. The HTML media element plays the stream and emits position, duration, buffering, and error updates.
5. The lyrics provider supplies timed lines; the UI highlights the line matching the current playback position.

Stream URLs are temporary playback data. Do not commit them, log them, or persist them as a reusable library. If playback requires headers or formats unsupported by the TV web runtime, stop and investigate that source path rather than adding an unreviewed proxy.

## App packaging and device workflow

- Add the standard webOS app metadata with app ID, version, vendor, web app type, main HTML entry, title, app icons, and an empty `requiredACG` list because the app does not call Luna Bus APIs.
- Build the static Vite output into a package staging directory, then run LG ares-package to produce an IPK.
- Configure the LG TV as a development target and install/launch the IPK with ares-install and ares-launch.
- Keep generated IPKs out of source control unless the user later asks for a release artifact.
- The minimum target is webOS 25 on the specified TV. Avoid Luna APIs and privileged capabilities unless a verified feature requires them.

## Acceptance criteria

- The webOS project passes its unit tests, typecheck, and production build.
- LG ares-package produces a valid IPK from the built project.
- On the physical 43UA7550PSA, the app installs, launches, displays a usable home/search screen, and all main controls can be reached with the Magic Remote.
- A YouTube Music result plays through the TV speakers, can be paused/resumed and seeked, and advances through the app queue.
- The now-playing and lyrics views remain readable at TV distance and recover sensibly from no lyrics, network failure, stream expiry, and playback errors.
- Google Cast from Android remains a distinct flow and is not claimed as IPK behavior.

Build and package success do not prove TV playback. Physical-device checks are required before calling the app usable.

## Main risks and mitigations

- **Resolver parity:** the existing stream resolver is Android/Kotlin-specific and handles YouTube signatures and request behavior. Port only the minimum supported path and test real responses before expanding scope.
- **TV media compatibility:** webOS may reject a URL, codec, CORS policy, or request header that works through CAF. Validate on the actual TV early and do not treat browser desktop playback as device proof.
- **Provider reliability:** YouTube endpoints can change. Keep search and stream resolution behind replaceable interfaces and report unsupported or expired streams clearly.
- **Remote navigation:** ordinary desktop focus behavior is insufficient for a TV. Add explicit directional navigation and verify it with the TV remote.
- **Context separation:** CAF and a webOS IPK have different runtimes. Keep their session ownership separate.

## Deferred follow-up

If the user later requires the Android app to control the standalone IPK directly, design and review the local pairing/protocol contract before implementing it. Do not add a cloud relay or phone-to-TV API to this release.

## Documentation checked

- LG web app template and required metadata: https://webostv.developer.lge.com/develop/getting-started/app-template
- LG web app and IPK packaging workflow: https://webostv.developer.lge.com/develop/getting-started/build-your-first-web-app
- LG TV CLI install/package commands: https://webostv.developer.lge.com/develop/tools/webos-tv-cli-dev-guide
- LG product specifications for 43UA7550PSA, including webOS 25 and Google Cast: https://www.lg.com/id/tvs-soundbars/uhd-tvs/43ua7550psa/
