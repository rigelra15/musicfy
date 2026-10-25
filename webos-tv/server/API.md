# Musicfy on-device service contract

The IPK bundles `com.musicfy.webos.service` with the UI. Its Luna `start` method
requires a subscription and replies `{returnValue:true,baseUrl}`. The subscription
keeps the service alive. Last cancellation closes the HTTP listener and sockets.
The base is always `http://127.0.0.1:{ephemeral-port}/s/{random-session}`. It is
never a computer or hosted relay address. See `src/platform/runtime.ts`.

`service/runtime.cjs` implements Node16.20.2 core HTTPS transport and streams. Vite
uses the identical handler without the session prefix for development.

| Method | Path relative to base | Contract |
| --- | --- | --- |
| GET | `/api/youtube/sw.js_data` | Guest session bootstrap text |
| POST | `/api/youtube/youtubei/v1/search` | Existing WEB_REMIX JSON with nonempty query <=200 chars; raw search JSON |
| POST | `/api/youtube/youtubei/v1/player` | Existing VISIONOS JSON with videoId <=200 chars; audio formats gain relayToken |
| GET, HEAD | `/api/youtube/media/{token}` | Valid opaque player token, optional single Range; streams upstream status/content-type/length/range |
| POST | `/api/catalog/{operation}` | Catalog (see below); operation is one of `home`, `search`, `suggest`, `browse`, `next`, `related`; body is JSON <=32 KiB |
| POST | `/api/lyrics/{providerId}` | Track {id,title,artist,album?,durationMs}; normalized source document |

Lyrics document is `{type:'synced',source,lines}` with timeMs, text, optional actual
words/syllables {text,startMs,endMs}, agent and isBackground; or plain {text} /
missing. All12 IDs and exact destination/path restrictions live in lyrics.cjs.
The source UI distinguishes unavailable requests from valid missing results.

Origin is same server or packaged null, no cookies or wildcard credentials.
On TV every HTTP request also requires the random session prefix. Only fixed
music.youtube.com API routes, HTTPS *.googlevideo.com media and fixed lyrics
hosts/paths are reachable. Every media/provider redirect is revalidated (3 max).
Tokens are limited to256 and expire at the upstream expiry or one hour, whichever
is earlier. Expired tokens return410; reselect/retry resolves fresh playback.
Requests are limited to32KiB and upstream JSON/text responses4MiB. Network
inactivity/body deadlines are20 seconds; media streams with backpressure and
aborts when its client closes. A provider may make at most16 requests per lookup.

Errors:400 invalid input,403 Origin/session rejection,404 route,405 method,
410 token,413 body limit,416 Range syntax,502 unavailable/invalid upstream.
API upstream statuses (including429) pass through. Error payload is {error}.

Regression coverage: server/runtime.test.ts, server/catalog.test.ts, lifecycle.test.ts,
src/platform/runtime.test.ts, src/data/apiBase.test.ts and src/lyrics/*.test.ts.
Postman simulation under postman/ runs actual packaged runtime against the
existing observed provider mocks using scripts/runtime-smoke.cjs. Test address
replacement is in that script only and is not part of the shipped service.

## Catalog (`/api/catalog/{operation}`)

Implemented by `service/innertube.cjs` (request building and normalisation, ported from the
Android provider) and `service/catalog.cjs` (transport, error mapping, automix merge). The UI
never sees raw InnerTube JSON and never supplies an upstream URL: every operation maps to a fixed
`music.youtube.com/youtubei/v1/*` path with the WEB_REMIX client. Client-side types are in
`src/catalog/types.ts`, the typed gateway in `src/catalog/gateway.ts`.

| Operation | Params | Result |
| --- | --- | --- |
| `home` | `{params?}` | `{chips, sections, continuation?, skipped}` |
| `search` | `{query<=200, filter?: all\|songs\|videos\|albums\|artists\|playlists\|community}` | `{filter, sections, items, continuation?, skipped}`; the top card is a section with `topResult:true` and is not in `items` |
| `suggest` | `{query<=120}` | `{queries, items}` |
| `browse` | `{browseId, params?}` | by id prefix: `MPRE` album, `VL/PL/RD/OLAK/MPSP/LM` playlist, `UC/MPLA` artist, else generic page; each has `type` |
| `next` | `{videoId?, playlistId?, index?, params?}` (one of videoId/playlistId required) | `{items, currentIndex?, continuation?, lyricsBrowseId?, relatedBrowseId?, radioPlaylistId?, radioUnavailable?}` |
| `related` | `{browseId}` | `{sections, skipped}` |

Every operation except `suggest` and `related` also accepts `{continuation:{token}}` from an earlier
page, returning `{items, sections, continuation?, skipped}`. A token is opaque base64url JSON
`{v:1,e,c,m}` (`e` is browse, search or next; at most 6000 characters) and is validated before use;
a malformed token is a 400. `locale:{hl,gl}` is optional and falls back to `en`/`US`.

Item kinds: `track`, `video`, `album`, `artist`, `playlist`, `link` (genre/mood button).
Recordings with different video IDs stay separate; the service never merges remixes or live
versions. Optional fields (album, duration, artwork, explicit flag) are omitted when upstream omits
them. An unreadable item is skipped and counted in `skipped`; a missing page container is an error
(502 `invalid-response`), never an empty success. For `next`, the automix preview is followed once
and merged without duplicates; if that follow-up fails the first panel is returned with
`radioUnavailable:true`.

Errors are JSON `{error, kind}`: `bad-request` 400, `not-found` 404, `rate-limited` 429,
`forbidden` 502, `upstream-http` 502, `invalid-response` 502, `timeout` 504, `network` 502.
Method must be POST (405 otherwise); bodies over 32 KiB are 413; the same Origin and session-token
rules as the other routes apply.

Coverage: `server/catalog.test.ts` (parsers, tokens, validation, error mapping, automix, runtime
route) and `src/catalog/gateway.test.ts`. Fixtures in `server/fixtures/innertube.ts` are
hand-built to the renderer shapes the Android provider parses; they prove parsing and transport,
not live YouTube behaviour. Offline mock: `postman/mocks/youtube-music-catalog` (regenerate
fixtures with `node scripts/build-catalog-mock-fixtures.mjs`; fault triggers by search text:
`rate limit`, `forbidden`, `rusak`, `lambat`, `kosong`).

## POST /api/translate

Translates lyric lines one-for-one through `translate.googleapis.com/translate_a/single` (the keyless endpoint the Android app uses). The host and path are fixed; the body is only text and language codes.

Request body (max 64 KiB): `{ "lines": string[1..400] (each ≤ 500 chars), "source": "auto" | code, "target": code }`.
Response: `200 { "lines": string[] }` with exactly as many lines as sent; `400` for an invalid body, `413` for an oversized one, `429` when the upstream rate-limits, `502` when nothing could be translated or the answer does not line up. Batches that come back misaligned are retried line by line; a line that still fails keeps its original text. Not verified against the live endpoint yet (the stand-in tests only).

## Audio sources (Monochrome, Apple Music)

All on the loopback service, under the session token and Origin rules of every other route. Nothing returned here is a credential or an upstream address; the screen only gets relay paths on this service.

* `GET /api/sources/status` → `{modules: [{id, name, description, needsAccount, account: {state, label}, choices}]}`; `state` is `ready` (no account), `signedIn`, `signedOut`, `expired` or `unreachable`.
* `POST /api/sources/resolve|diagnose` `{provider: "monochrome"|"applemusic", track: {title, artists[], album?, durationMs?, isrc?}, picks?: {quality?, region?}}` → `{result: "found", stream}` or `{result: "notFound"|"unavailable", kind, reason}`. `kind` tells the step apart: `auth`, `network`, `matching`, `stream`, `license`. `diagnose` also returns `steps[]` (what the Android test button lists). A malformed body is 400, an unknown provider 404.
* `POST /api/sources/verify|signout` `{provider}` → the account state.
* `stream`: `{format: "progressive"|"hls", path, mimeType, codec, qualityLabel, sourceLabel, sampleRateHz?, drm?: {system, licensePath}, matched}`. `codec`, `qualityLabel` and `sampleRateHz` are what the source really sent (Monochrome's rate is read from the FLAC header), never a promise.
* `GET|HEAD /api/source/media/<token>` relays one file with byte ranges, only to Monochrome's track address or an Apple media host (`*.apple.com`, `*.mzstatic.com`, `*.aaplimg.com`), redirects re-checked; `GET /api/source/manifest/<token>` serves the rewritten HLS playlist (its files and key go through the relay); `POST /api/source/license/<token>` trades a CDM challenge for the license (binary in, binary out; failures answer with `X-Source-Error: auth|license|network`). Tokens last an hour and the table is capped.
* Credentials (Apple's music-user token and developer token) live in a file only the service reads (`sources.json`, mode 0600, under `/media/internal/musicfy-service` on the TV, a temp folder in development; `MUSICFY_DATA_DIR` overrides). They arrive only through the phone transfer kind `applemusic-session` (see TRANSFER.md), which the service handles itself and never hands to the screen.

Not verified against the live services: the stand-in tests use the search answers captured by the Android modules. Whether a given TV decodes FLAC or licenses Widevine is proven on the TV only.

## POST /api/import/link

Reads a public playlist or album from a Spotify, Apple Music or Deezer share link, without any account (port of the Android `LinkImporter`). Hosts and paths are fixed: Spotify's embed page (`open.spotify.com/embed/<type>/<id>`, the `__NEXT_DATA__` track list), the Apple Music page (`serialized-server-data`) and Deezer's public API (`api.deezer.com/<type>/<id>` and `/tracks?limit=100`, following `next` only inside `api.deezer.com`, at most 100 pages). The link the person pastes is parsed, never fetched as given; short links (`spotify.link`, `spotify.app.link`, `deezer.page.link`, `link.deezer.com`) are followed up to 4 hops and only to those hosts or the three above. YouTube links are not handled here: the app reads them through the catalog with exact ids.

Request body (max 4 KiB): `{ "link": string }`; the text may carry words around the address.
Response `200`: `{ source, kind: "playlist"|"album", remoteId, url, name, cover?, tracks: [{title, artist, album?, durationMs?}], warnings: string[] }`. Warnings carry the provider limits: Spotify shares only the first 100 songs of a playlist through the embed; Apple Music only what its page lists (declared vs listed); Deezer if fewer songs came than declared.
Errors (all `{error, kind}` in Indonesian): `400 badLink`, `404 private` (private or missing), `422 empty`, `429 rateLimited`, `502 changed` (the page no longer has the data), `502 network|upstream`.
Verified on the development machine against the live public pages of all three services (a Deezer chart, Spotify "Today's Top Hits", Apple Music "Today's Hits"); the tests use synthesized pages shaped like the Android parsers read them. Those pages can change at any time; "changed" is what the screen then shows.

## /api/scrobble/*

Last.fm and Libre.fm scrobbling (port of the Android `Scrobbler` and `Audioscrobbler`). The service owns everything secret: API key and shared secret (environment `MUSICFY_LASTFM_API_KEY` / `MUSICFY_LASTFM_SECRET`, `MUSICFY_LIBREFM_API_KEY` / `MUSICFY_LIBREFM_SECRET`, or `scrobble-keys.json` `{"lastfm":{"key","secret"},"librefm":{...}}` in the data folder), session keys, and the queue of plays (`scrobble.json`, mode 0600, in the data folder). A site without both key parts is reported `configured: false` and cannot sign in; no key ships in the code. Calls go only to `ws.audioscrobbler.com/2.0/` and `libre.fm/2.0/`, signed with MD5 as the API asks.

* `GET status` → `{sites: [{id: "lastfm"|"librefm", label, configured, signedIn, username?, enabled, profileUrl?}], pending}`. Never returns keys or sessions.
* `POST begin {site}` → `{authUrl}` (shown as a QR code; the token stays in service memory). `POST finish {site}` → `{state: "waiting"}` until the person allowed Musicfy, then `{state: "signedIn", username}`, or `{state: "expired"}`.
* `POST signout {site}` (drops the account and what was queued for it), `POST enable {site, enabled}` (pause keeps the account; older queued plays are still sent).
* `POST nowplaying {track}` (straight out, never queued), `POST scrobble {track, startedAt}` (queued first, then sent in batches of 50; max 5000 plays, nothing older than 14 days; a play the service rejects for good is dropped; a revoked session signs the account out; failures retry with backoff, and what is left goes out when the service starts), `POST love {artist, track, love}`, `POST flush`.
* `track` = `{artist, track, album?, durationSeconds?}`. Errors: `{error, kind}` with `400 badRequest`, `503 notConfigured`, `502 network|upstream|…`.

Not tried against the live Last.fm/Libre.fm (no keys in this environment): the tests use a stand-in that answers the way the Android client reads the API.
