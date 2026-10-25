package com.example.musicfy.tvtransfer

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

/** Phone's database → the portable backup the TV reads (see PortableBackup). Only songs that something refers to are listed. */
object PortableBackupBuilder {
    const val LIKED_PLAYLIST_ID = "LP_LIKED"
    const val DOWNLOADED_PLAYLIST_ID = "LP_DOWNLOADED"
    private const val MAX_PINS = 9

    /** Android preference name -> (TV name, conversion). A value of the wrong kind is simply not sent. */
    private val PREF_MAP: Map<String, Pair<String, (Any?) -> JsonElement?>> = mapOf(
        "appLanguage" to ("ui.language" to { v: Any? -> (v as? String)?.takeIf { it == "id" || it == "en" }?.let(::JsonPrimitive) }),
        "hideExplicit" to ("content.hideExplicit" to { v: Any? -> (v as? Boolean)?.let(::JsonPrimitive) }),
        "hideVideoSongs" to ("content.hideVideoSongs" to { v: Any? -> (v as? Boolean)?.let(::JsonPrimitive) }),
        "pauseListenHistory" to ("history.paused" to { v: Any? -> (v as? Boolean)?.let(::JsonPrimitive) }),
        "historyDuration" to ("history.minSeconds" to { v: Any? -> (v as? Number)?.toDouble()?.takeIf { it in 0.0..600.0 }?.let { JsonPrimitive(it.toInt()) } }),
        "playerMenuSlots" to ("player.menuSlots" to { v: Any? -> (v as? String)?.takeIf { it.isNotBlank() && it.length <= 200 }?.let(::JsonPrimitive) }),
        "playerSideButton" to ("player.sideButton" to { v: Any? -> (v as? String)?.takeIf { it.isNotBlank() && it.length <= 40 }?.let(::JsonPrimitive) }),
    )

    /**
     * What the TV needs to play the person's own Apple Music: the music-user token and, when known, the web
     * player's developer token. Null when there is no session. Sent only as its own, explicitly chosen transfer,
     * never inside a backup.
     */
    fun appleSession(userToken: String?, developerToken: String?): ByteArray? {
        val user = userToken?.trim()?.takeIf { it.length in 20..4096 } ?: return null
        val developer = developerToken?.trim()?.takeIf { it.startsWith("eyJ") && it.length < 4096 }
        val fields = buildMap<String, JsonElement> {
            put("userToken", JsonPrimitive(user))
            if (developer != null) put("developerToken", JsonPrimitive(developer))
        }
        return kotlinx.serialization.json.JsonObject(fields).toString().toByteArray(Charsets.UTF_8)
    }

    private fun trackKey(provider: String, id: String) = "$provider:track:$id"
    private fun https(url: String?) = url?.takeIf { it.startsWith("https://") && it.length <= 2000 }

    fun build(source: TransferSource, appVersion: String, now: Long): PortableBackup {
        val songs = source.songs.filter { it.title.isNotBlank() && it.id.isNotBlank() }.associateBy { it.id }
        val used = LinkedHashSet<String>()
        fun use(songId: String): String? = songs[songId]?.let { used += songId; trackKey(if (it.isLocal) "local" else "youtube", songId) }

        val library = songs.values.filter { it.inLibraryAt != null }.mapNotNull { song ->
            use(song.id)?.let { PortableBackup.LibraryItem(it, song.inLibraryAt!!, "manual") }
        }
        val likes = songs.values.filter { it.liked }.mapNotNull { song ->
            use(song.id)?.let { PortableBackup.Like(it, song.likedAt ?: song.inLibraryAt ?: now) }
        }

        val playlists = source.playlists
            .filter { it.id != LIKED_PLAYLIST_ID && it.id != DOWNLOADED_PLAYLIST_ID }
            .map { playlist ->
                val entries = playlist.entries.sortedBy { it.position }.mapNotNull { entry ->
                    use(entry.songId)?.let { PortableBackup.Entry("pe${entry.mapId}", it, playlist.createdAt ?: now) }
                }
                PortableBackup.Playlist(playlist.id, playlist.name.ifBlank { "Playlist" }.take(200), playlist.createdAt ?: now, playlist.updatedAt ?: playlist.createdAt ?: now, entries)
            }

        val history = source.events.mapNotNull { event ->
            use(event.songId)?.let { PortableBackup.Play("ev${event.id}", it, event.timestamp, event.playTimeMs.coerceAtLeast(0)) }
        }

        val lyricsEdits = source.userEditedLyrics.filter { it.lrc.isNotBlank() }.mapNotNull { lyrics ->
            use(lyrics.songId)?.let { PortableBackup.LyricsEdit(it, lyrics.lrc, lyrics.editedAt ?: now) }
        }

        // Pins: newest first, at most nine. A pinned album, artist or playlist also becomes a saved item so the TV has something to show.
        val extraSaved = LinkedHashMap<String, PortableBackup.Saved>()
        val pins = source.pins.sortedByDescending { it.createDate }.mapNotNull { pin ->
            val kind = when (pin.type) { "SONG" -> "track"; "ALBUM" -> "album"; "ARTIST" -> "artist"; "PLAYLIST" -> "playlist"; else -> null } ?: return@mapNotNull null
            if (kind == "track") {
                if (use(pin.id) == null) return@mapNotNull null
            } else {
                extraSaved["$kind:${pin.id}"] = PortableBackup.Saved(PortableBackup.Ref("youtube", kind, pin.id), pin.title, pin.subtitle, https(pin.thumbnailUrl), pin.createDate)
            }
            pin to kind
        }.take(MAX_PINS).mapIndexed { index, (pin, kind) -> PortableBackup.Pin(PortableBackup.Ref("youtube", kind, pin.id), index, pin.createDate) }

        val saved = LinkedHashMap<String, PortableBackup.Saved>()
        source.savedArtists.filter { it.id.startsWith("UC") }.forEach { saved["artist:${it.id}"] = PortableBackup.Saved(PortableBackup.Ref("youtube", "artist", it.id), it.name, null, https(it.thumbnailUrl), it.savedAt ?: now) }
        source.savedAlbums.forEach { saved["album:${it.id}"] = PortableBackup.Saved(PortableBackup.Ref("youtube", "album", it.id), it.title, null, https(it.thumbnailUrl), it.savedAt ?: now) }
        source.playlists.filter { it.browseId != null && it.bookmarkedAt != null }.forEach {
            saved["playlist:${it.browseId}"] = PortableBackup.Saved(PortableBackup.Ref("youtube", "playlist", it.browseId!!), it.name.ifBlank { "Playlist" }, null, https(it.thumbnailUrl), it.bookmarkedAt!!)
        }
        // Only keep pinned items that really are pinned; the rest of extraSaved is only there to give pins a face.
        val pinnedKeys = pins.map { "${it.ref.kind}:${it.ref.id}" }.toSet()
        extraSaved.filterKeys { it in pinnedKeys }.forEach { (key, value) -> saved.putIfAbsent(key, value) }

        val tracks = used.mapNotNull { id -> songs[id]?.let(::track) }
        val prefs = LinkedHashMap<String, JsonElement>()
        for ((name, mapping) in PREF_MAP) mapping.second(source.prefs[name])?.let { prefs[mapping.first] = it }

        return PortableBackup(
            exportId = "musicfy-android-${now.toString(36)}", exportedAt = now, exporter = PortableBackup.Exporter("musicfy-android", appVersion),
            tracks = tracks, library = library, likes = likes, pins = pins, savedEntities = saved.values.toList(), playlists = playlists,
            history = history, lyricsEdits = lyricsEdits, prefs = prefs,
        )
    }

    private fun track(song: TransferSource.Song): PortableBackup.Track {
        val real = song.artists.filter { it.name.isNotBlank() }
        return PortableBackup.Track(
            id = song.id, title = song.title.take(500), artist = real.joinToString(", ") { it.name }.take(500),
            durationMs = if (song.durationSeconds > 0) song.durationSeconds * 1000L else 0L,
            provider = if (song.isLocal) "local" else "youtube",
            album = song.albumName?.takeIf { it.isNotBlank() }?.take(500), albumId = song.albumId?.takeIf { it.isNotBlank() },
            artworkUrl = if (song.isLocal) null else https(song.thumbnailUrl),
            artists = real.map { PortableBackup.Artist(it.name, it.id?.takeIf { id -> !it.isLocal && id.isNotBlank() }) }.takeIf { it.isNotEmpty() },
            explicit = song.explicit.takeIf { it }, isVideo = song.isVideo.takeIf { it },
        )
    }

    /** What the screen tells the person before anything is sent. */
    class Summary(val songs: Int, val playlists: Int, val likes: Int, val history: Int, val localFiles: Int)
    fun summarize(backup: PortableBackup) = Summary(
        songs = backup.tracks.size, playlists = backup.playlists.size, likes = backup.likes.size, history = backup.history.size,
        localFiles = backup.tracks.count { it.provider == "local" },
    )
}
