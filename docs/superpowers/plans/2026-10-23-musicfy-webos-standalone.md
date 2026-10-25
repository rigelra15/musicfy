> **HISTORIS (24 Oktober 2026):** rencana ini digantikan oleh [2026-10-24-musicfy-webos-full-adaptation.md](2026-10-24-musicfy-webos-full-adaptation.md). Pembatasan scope "search/player saja" di dokumen ini tidak berlaku lagi.

# Standalone Musicfy webOS Implementation Plan

> Use executing-plans inline with independent cover and lyrics tasks under dispatching-parallel-agents.

Goal: one IPK containing TV UI and on-device network service, sharp artwork,
mobile cover styles, provider choice and real word/syllable lyrics.
Architecture: Preact UI calls a packaged webOS-service over Luna. A subscription
keeps a loopback-only Node16 HTTP adapter alive while the app is open. Audio is
streamed with byte ranges through validated opaque tokens; no PC/LAN URL needed.
Desktop Vite uses the identical HTTP adapter for testability. The Android source
and user's explicit 2026-10-23 implementation request are the spec.

Constraints: preserve current checkout and unrelated changes; no push/commit.
Use Node16 core HTTPS streams, no fetch or native addons in the TV service.
Use official LG bridge library, service ID com.musicfy.webos.service. Keep
black/Inter/grayscale UI and top nav. No fabricated timing or successful sources.

Tasks:
- [x] Service: contract and failing tests, implement allowlisted API forwarding,
  media Range/redirect/expiry, loopback token/auth, Luna subscription lifecycle.
- [x] Client bootstrap: fail visibly/retry when service unavailable, use runtime
  base for YouTube and lyrics; file builds cannot silently fall back to LAN.
- [x] Artwork: mobile1200 sizing and real fallbacks; eight cover styles,
  rotation pauses/resumes, saved style preferences and reduced motion.
- [x] Lyrics: mobile12 providers, normalize and grade real line/word/syllable
  data, auto/manual source, persistent detail preference and source errors.
- [x] Integration: compact TV controls/focus; build service+UI into one IPK.
- [ ] Verification: complete tests/typecheck; Node16 actual runtime, Postman
  simulation, live desktop browser, inspect IPK service paths; physical TV if
  reachable. Fresh review, fix important findings, document remaining limits.

Review focus: old service stops after app closes; no open proxy via media tokens
or provider redirects; late source replies cannot override manual selection;
expired audio recovers on retry; old lyric timings never apply to new track.

User explicitly requested implementation to completion; no additional design
approval requested. Computer is used only to build/install/test, not at runtime.

Execution evidence:107tests/typecheck/build pass. Node16 actual runtime
search/session/player200 and audio206 on both desktop and LG. TV install/launch
succeeded; physical audio confirmed by user. Review fixes: absolute native media
URL, selecting same queue index, select D-pad exit, SimpMusic404 fallback,
Paxsenix API word spaces and TTML formatting boundaries. Full source-selection
and final offline-preview TV validation is being recorded in VALIDATION.md.
