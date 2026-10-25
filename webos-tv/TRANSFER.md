# Phone → TV transfer and the portable backup

What moves a collection from the Musicfy phone app to the TV without a computer, and the file format it carries.
Android half: the `tvtransfer` module and Transfer to TV screen, not part of this branch; the last version is at the git tag `android-with-transfer` (`modules/tvtransfer`, plain JVM, tested with known answers from this side). TV half: `service/transfer.cjs`,
`src/backup/*`. Status of what is and is not verified is at the end.

## Portable backup (`*.musicfy.json`, version 1)

JSON, one object: `format: "musicfy-portable"`, `version: 1`, `exportId`, `exportedAt`, `exporter {app, version}`, then
`tracks`, `library`, `likes`, `pins`, `savedEntities`, `playlists` (with ordered `entries`), `history`, `lyricsEdits`,
`lyricsChoice`, `prefs`. Reference: `src/backup/portable.ts` (reader and importer) and
`server/fixtures/portable-v1.json` (a file the Android side produces; the TV tests read it from here, and the Kotlin tests at the tag read their own copy).

* A track is `{id, title, artist, durationMs, provider?, album?, albumId?, artworkUrl? (https only), artists?, isrc?, explicit?, isVideo?}`;
  `provider` defaults to `youtube`. Everything else refers to tracks by `trackKey = provider:track:id`.
* Never in a backup: accounts, cookies, keys, signed stream URLs, audio files. Songs that are files on the phone use provider `local`;
  the TV keeps the entries and marks the audio as "needs transfer".
* Only these settings travel: `ui.language`, `profile.name`, `player.appearance`, `player.menuSlots`, `player.sideButton`, `playback.speed`,
  `playback.autoplay`, `content.hideExplicit`, `content.hideVideoSongs`, `history.minSeconds`, `history.paused`, `lyrics.detail`,
  `lyrics.motion`, `lyrics.source`, `lyrics.translate.target`, `lyrics.translate.source`, `lyrics.readings`.
* A newer `version` is refused with a message. Invalid records are dropped and counted, not fatal. Up to 200,000 records.

### Import

*Merge* (default) adds what is missing and keeps what the TV has, including its settings and its own lyric edits. *Replace* clears the
collection (library, likes, pins, saved, playlists, history, lyric edits and choices) first, after a confirmation that lists what goes.
Both are one transaction: a failed write changes nothing. The preview computes the same thing without writing.

Identity makes re-imports safe: playlist entries and history events are matched by their ids; ids from another app are prefixed with the
app name (`musicfy-android:`) so they can never collide with ids made on the TV. A song listed twice in a playlist stays twice.

### CSV

Musicfy's own export, TuneMyMusic and Exportify-style files (columns found by name; `;` and a BOM are fine): liked songs and playlists only.
Rows with a YouTube `Video ID` are imported; rows without one need the online matching of a later step and are listed in the preview.
Re-importing the same file adds nothing. Maximum 10 MiB.

## Transfer protocol (version 1)

The TV opens a listener only while "Hubungkan HP" is on screen, for 5 minutes at most, and closes it when the transfer ends, is cancelled
by either side, expires, the app is hidden or the service stops. It only knows three routes and never proxies anything.

1. TV `POST /api/transfer/start` (loopback, session-token protected) → listener on a random port; returns the QR text
   `musicfy://pair?v=1&h=<lan ip>&p=<port>&s=<session id>&k=<pairing secret, 16 bytes>&t=<TV public key, 65 bytes>&n=<TV name>`
   (binary values base64url). The phone refuses a code whose host is not a private/link-local IPv4 address.
2. Phone → `POST http://h:p/t/<sid>/hello` `{pub, proof}`: `pub` is the phone's ephemeral P-256 public key (65 bytes);
   `proof = HMAC-SHA256(secret, "musicfy-hello|" + sid + "|" + pub)`. Five wrong proofs end the session. One phone only (a second gets 409).
3. Both sides compute `shared = ECDH(P-256)` and `HKDF-SHA256(ikm = shared, salt = secret, info = "musicfy-transfer-v1|" + sid + "|" + tvPub + phonePub, 64 bytes)`:
   first 32 bytes encrypt phone → TV, last 32 TV → phone. The reply to `hello` carries `confirm = HMAC(tvToPhone, "musicfy-tv-ready|" + sid)`;
   the phone sends nothing unless it matches (the TV has proven it holds the secret).
4. Phone → `POST /t/<sid>/send` `{seq, ct}`, `seq` = 0, 1, 2… exactly in order. `ct = AES-256-GCM(key, nonce, plaintext) ‖ tag`,
   nonce = 8-byte big-endian `seq` ‖ 4 zero bytes, AAD = `"musicfy-msg|" + sid + "|" + seq`. A replayed, skipped or altered message is refused (409/403).
   * `seq 0`: JSON `{type:"header", kind:"portable"|"csv", name, device, size, chunks, sha256}`; `size` ≤ 64 MiB (portable) / 10 MiB (csv);
     `chunks = ceil(size / 262144)`. Unknown kinds are refused.
   * `kind` is `portable`, `csv` or `applemusic-session` (≤ 16 KiB: `{userToken, developerToken?}`). A session is a credential: the service validates and keeps it itself, the status shows `private: true`, and `GET /api/transfer/payload` never returns it. It is sent only when the person picks "Apple Music account only" on the phone, never inside a backup, and it is wiped from the TV with "Putuskan akun".
   * `seq 1…chunks`: raw bytes, 256 KiB each. The TV checks size and SHA-256 before it accepts the payload.
5. Phone → `POST /t/<sid>/cancel` `{proof = HMAC(phoneToTv, "musicfy-cancel|" + sid)}`; or the TV cancels with `POST /api/transfer/cancel`.
6. The TV shows the preview (above) and only then imports. Nothing secret appears in a URL, a log or the status the screen polls.

Loopback API on the TV service: `POST /api/transfer/start`, `GET /api/transfer/status`, `GET /api/transfer/payload` (once), `POST /api/transfer/cancel`.

## The Android screen (at the tag `android-with-transfer`)

Settings → Import & sync → **Transfer to TV** (`TvTransferScreen`, `TvTransferViewModel`, `TvTransferRepository`).

1. *Scan the code* asks for the camera permission (only on this screen; the app still works without a camera) and opens a viewfinder
   (CameraX + ZXing `core`, no Google Play services, so the F-Droid build is unaffected). The first readable code is used once and never stored.
2. The code must point at a private/link-local address; the phone pairs and checks that the TV proves it holds the secret.
3. The screen names the TV and says what a full backup holds (songs, playlists, likes, plays, local files listed but not sent). The person picks
   **Whole collection** (portable backup) or **Liked songs and playlists only** (CSV), then taps Send.
4. Progress, then "look at the TV": the TV shows its own preview and asks before importing. Stop (or leaving the screen) tells the TV to close its listener.

What is read (read-only, `TransferDao`): songs with their artists, playlists and their songs, plays, the user's own lyric edits, Speed dial pins,
followed artists and saved albums, and a short list of settings. The mapping is `PortableBackupBuilder` (pure, tested). Times are the phone's
clock readings converted with the phone's zone. System playlists (liked, downloaded) are not exported as playlists; likes travel as likes.
Not sent, by construction: accounts, cookies, keys, tokens (Last.fm, Discord, YouTube), signed URLs, audio files.

## What is verified, and what is not

Verified here (computer only): the crypto matches between the TV's Node code and the Android module (known-answer tests from fixed keys);
the whole protocol against a reference phone (replay, order, tamper, wrong code, expiry, cancel, size limits, one phone, listener closing);
the Kotlin client against a Kotlin model of the TV; the QR decoder (real pairing payload, padded camera rows, damaged codes, frames with no
code); the backup builder (every rule above); both sides reading the same backup file; import/merge/replace/idempotence/rollback; the TV screens
(QR, preview, cancel on Back and on hide); the Android app compiles with the new screen (F-Droid flavor).

Not verified: a real phone scanning the QR on this TV with the real camera; the LAN listener on the TV itself (webOS firewall, Wi-Fi
isolation); the Android screen on a device (permission prompt, camera preview, Room reads on a large library); older webOS file inputs and file
saving (`Ekspor backup` uses a normal browser download).
