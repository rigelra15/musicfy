# Musicfy Cast channel v1

The Android GMS sender and the CAF receiver communicate on
`urn:x-cast:com.musicfy.tv.v1`. Messages are JSON objects with this common
envelope:

```json
{
  "version": 1,
  "type": "SNAPSHOT",
  "requestId": "unique-message-id",
  "senderSessionId": "unique-sender-process-id",
  "mediaId": "youtube-video-id",
  "queueEntryId": "local-queue-index:youtube-video-id",
  "revision": 1,
  "data": {}
}
```

`senderSessionId` identifies the sender process and is established by `HELLO`;
a sender restart establishes a new epoch so its revisions can safely start over.
Every message after `HELLO` carries that ID, and the receiver ignores messages
from earlier epochs. `mediaId` identifies a song; `queueEntryId` distinguishes
repeated appearances of that song in a queue. The receiver applies snapshots
only for the current CAF queue entry and lyrics only for the accepted snapshot
revision of that entry.

| Type | Direction | `data` |
| --- | --- | --- |
| `HELLO` | Sender → receiver | `{}`; asks a newly connected sender to confirm receiver readiness |
| `READY` | Receiver → sender | `{ capabilities: ["player", "lyrics", "artwork"] }` |
| `SNAPSHOT` | Sender → receiver | `{ track: { title, artist, album, artwork }, lines: [], mode }` |
| `LYRICS_CHUNK` | Sender → receiver | `{ transferId, index, count, chunk }`; concatenated chunks form JSON `{ lines: LyricLine[] }` |
| `ACK` | Receiver → sender | `{ transferId, index }`; acknowledges a valid chunk |
| `SET_VIEW_MODE` | Sender → receiver | `{ mode: "player" \| "lyrics" \| "artwork" }` |

Line and word times are milliseconds. Lyrics use UTF-8 chunks no larger than
16 KiB and a complete payload no larger than 1 MiB. Transfers contain at most
128 chunks; the sender waits five seconds for each acknowledgement and retries
once. Duplicate chunks are idempotent, and the receiver bounds in-progress
transfers.

Playback URLs and credentials are not part of this channel. CAF loads the media
URL from the normal Cast `LOAD`/queue request; the receiver only receives
presentation metadata and lyrics here.
