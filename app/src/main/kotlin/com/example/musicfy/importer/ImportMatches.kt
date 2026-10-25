// ImportMatches.kt

package com.example.musicfy.importer

import android.content.Context
import com.music.innertube.models.Artist
import com.music.innertube.models.SongItem
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import timber.log.Timber
import java.io.File

/**
 * One track from another service and the YouTube song it became. [key] is the track's id on that
 * service when it has one (Spotify's track id), otherwise its cleaned-up title and artist.
 */
@Serializable
data class TrackMatch(
    val key: String,
    /** The track as the service has it: what "Choose different version" searches with. */
    val title: String,
    val artist: String,
    val album: String? = null,
    val durationMs: Long? = null,
    /** An ImportSource key. */
    val source: String,
    val songId: String,
    /** Picked by hand, so every later import and Re-sync uses this song without searching. */
    val pinned: Boolean = false,
    // a pinned song's own details, to rebuild it if it has left the database since
    val songTitle: String? = null,
    val songArtists: List<String> = emptyList(),
    val songDuration: Int? = null,
    val songThumbnail: String? = null,
) {
    val track: ImportedTrack
        get() = ImportedTrack(title = title, artist = artist, album = album, durationMs = durationMs)

    fun pinnedSong(): SongItem = SongItem(
        id = songId,
        title = songTitle ?: title,
        artists = songArtists.ifEmpty { listOf(artist) }.map { Artist(name = it, id = null) },
        duration = songDuration,
        thumbnail = songThumbnail ?: "https://i.ytimg.com/vi/$songId/hqdefault.jpg",
    )
}

/**
 * Which YouTube song each imported track became, and the versions the user picked by hand. A pick
 * holds for that track in every later import and Re-sync, and "Choose different version" uses the
 * track's own title, artist and length to search again.
 *
 * A small file rather than a table: it's only read by imports and by the version picker.
 */
class ImportMatches private constructor(private val file: File) {
    private val lock = Any()
    private var loaded: HashMap<String, TrackMatch>? = null
    private var dirty = false

    private fun all(): HashMap<String, TrackMatch> =
        loaded ?: load().also { loaded = it }

    /**
     * The song the user picked for this track, if they did. Picks made on songs imported before
     * tracks kept their service id are saved by title and artist, so that's looked at too.
     */
    fun pinned(track: ImportedTrack): TrackMatch? = synchronized(lock) {
        all()[track.matchKey()]?.takeIf { it.pinned }
            ?: all()[track.trackKey()]?.takeIf { it.pinned }
    }

    /** Notes the song an import found for [track]. A hand-picked song is never replaced here. */
    fun remember(track: ImportedTrack, source: ImportSource, song: SongItem) = synchronized(lock) {
        val key = track.matchKey()
        if (key.startsWith("yt:")) return@synchronized
        val existing = all()[key]
        if (existing?.pinned == true || existing?.songId == song.id) return@synchronized
        all()[key] = TrackMatch(
            key = key,
            title = track.title,
            artist = track.artist,
            album = track.album,
            durationMs = track.durationMs,
            source = source.key,
            songId = song.id,
        )
        dirty = true
    }

    /** The track [songId] was imported as, a hand-picked one first. */
    fun forSong(songId: String): TrackMatch? = synchronized(lock) {
        val matches = all().values.filter { it.songId == songId }
        matches.firstOrNull { it.pinned } ?: matches.firstOrNull()
    }

    /** From now on [match]'s track is [song], in this import and every later one. */
    fun pin(match: TrackMatch, song: SongItem) = synchronized(lock) {
        all()[match.key] = match.copy(
            songId = song.id,
            pinned = true,
            songTitle = song.title,
            songArtists = song.artists.map { it.name },
            songDuration = song.duration,
            songThumbnail = song.thumbnail,
        )
        dirty = true
        flushLocked()
    }

    /** [match]'s track became [song] by a fresh search (Refetch), not by hand. */
    fun moveTo(match: TrackMatch, song: SongItem) = synchronized(lock) {
        all()[match.key] = match.copy(songId = song.id, pinned = false)
        dirty = true
        flushLocked()
    }

    /** Lets imports search for [match]'s track again. */
    fun unpin(match: TrackMatch) = synchronized(lock) {
        val current = all()[match.key] ?: return@synchronized
        if (!current.pinned) return@synchronized
        all()[match.key] = current.copy(pinned = false)
        dirty = true
        flushLocked()
    }

    /** Writes what changed since the last write. Imports call this once per playlist, not per song. */
    fun flush() = synchronized(lock) { flushLocked() }

    private fun flushLocked() {
        if (!dirty) return
        val matches = loaded ?: return
        runCatching {
            // write-then-rename so a crash mid-write never leaves half a file
            val temp = File(file.parentFile, "${file.name}.tmp")
            temp.writeText(json.encodeToString(matches.values.toList()))
            if (!temp.renameTo(file)) {
                file.writeText(temp.readText())
                temp.delete()
            }
            dirty = false
        }.onFailure { Timber.w(it, "Couldn't save import matches") }
    }

    private fun load(): HashMap<String, TrackMatch> {
        val list = runCatching {
            if (file.exists()) json.decodeFromString<List<TrackMatch>>(file.readText()) else emptyList()
        }.getOrElse {
            Timber.w(it, "Couldn't read import matches")
            emptyList()
        }
        return list.associateByTo(HashMap()) { it.key }
    }

    companion object {
        private const val FILE_NAME = "import_matches.json"
        private val json = Json { ignoreUnknownKeys = true }

        @Volatile private var instance: ImportMatches? = null

        fun get(context: Context): ImportMatches =
            instance ?: synchronized(this) {
                instance ?: ImportMatches(File(context.applicationContext.filesDir, FILE_NAME)).also { instance = it }
            }
    }
}

/**
 * What a hand-picked version is saved under: the service's own id for the track when it gave one,
 * so the pick survives the track being renamed there, otherwise its title and artist.
 */
internal fun ImportedTrack.matchKey(): String = sourceId ?: trackKey()
