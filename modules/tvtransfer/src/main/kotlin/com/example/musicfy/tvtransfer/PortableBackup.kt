package com.example.musicfy.tvtransfer

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * The Musicfy portable backup, version 1 (`*.musicfy.json`). The TV reads exactly this; see
 * webos-tv/src/backup/portable.ts. It never carries accounts, cookies, keys, signed URLs or audio files.
 * Songs that are files on the phone are listed with provider "local": the TV keeps their entries and
 * asks for the files again.
 */
@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class PortableBackup(
    @EncodeDefault val format: String = FORMAT,
    @EncodeDefault val version: Int = VERSION,
    val exportId: String,
    val exportedAt: Long,
    val exporter: Exporter,
    val tracks: List<Track> = emptyList(),
    val library: List<LibraryItem> = emptyList(),
    val likes: List<Like> = emptyList(),
    val pins: List<Pin> = emptyList(),
    val savedEntities: List<Saved> = emptyList(),
    val playlists: List<Playlist> = emptyList(),
    val history: List<Play> = emptyList(),
    val lyricsEdits: List<LyricsEdit> = emptyList(),
    val lyricsChoice: List<LyricsChoice> = emptyList(),
    val prefs: Map<String, JsonElement> = emptyMap(),
) {
    @Serializable data class Exporter(val app: String, val version: String)
    @Serializable data class Artist(val name: String, val id: String? = null)
    @Serializable data class Track(
        val id: String, val title: String, val artist: String, val durationMs: Long = 0, val provider: String = "youtube",
        val album: String? = null, val albumId: String? = null, val artworkUrl: String? = null, val isrc: String? = null,
        val artists: List<Artist>? = null, val explicit: Boolean? = null, val isVideo: Boolean? = null,
    ) { val trackKey: String get() = "$provider:track:$id" }
    @Serializable data class LibraryItem(val trackKey: String, val addedAt: Long, val source: String = "import:backup")
    @Serializable data class Like(val trackKey: String, val likedAt: Long)
    @Serializable data class Ref(val provider: String, val kind: String, val id: String)
    @Serializable data class Pin(val ref: Ref, val position: Int, val pinnedAt: Long)
    @Serializable data class Saved(val ref: Ref, val title: String, val subtitle: String? = null, val artworkUrl: String? = null, val savedAt: Long)
    @Serializable data class Entry(val entryId: String, val trackKey: String, val addedAt: Long)
    @Serializable data class Playlist(val id: String, val name: String, val createdAt: Long, val updatedAt: Long, val entries: List<Entry> = emptyList())
    @Serializable data class Play(val id: String, val trackKey: String, val startedAt: Long, val listenedMs: Long)
    @Serializable data class LyricsEdit(val trackKey: String, val lrc: String, val editedAt: Long)
    @Serializable data class LyricsChoice(val trackKey: String, val provider: String)

    fun encode(): String = JSON.encodeToString(serializer(), this)

    companion object {
        const val FORMAT = "musicfy-portable"
        const val VERSION = 1
        /** The settings that may travel; the TV applies the same list on its side. */
        val TRAVELLING_PREFS = setOf(
            "ui.language", "profile.name", "player.appearance", "player.menuSlots", "player.sideButton", "playback.speed", "playback.autoplay",
            "content.hideExplicit", "content.hideVideoSongs", "history.minSeconds", "history.paused",
            "lyrics.detail", "lyrics.motion", "lyrics.source", "lyrics.translate.target", "lyrics.translate.source", "lyrics.readings",
        )
        private val JSON = Json { encodeDefaults = false; explicitNulls = false; prettyPrint = false }
        fun decode(text: String): PortableBackup = Json { ignoreUnknownKeys = true }.decodeFromString(serializer(), text)
    }
}
