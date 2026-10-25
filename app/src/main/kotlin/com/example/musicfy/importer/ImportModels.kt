// ImportModels.kt

package com.example.musicfy.importer

import com.music.innertube.models.SongItem

data class ImportedTrack(
    val title: String,
    val artist: String,
    val album: String?,
    val durationMs: Long? = null,
    /** Exact YouTube id when the source already knows it (Musicfy CSV, YouTube links) — no search needed. */
    val videoId: String? = null,
    val thumbnailUrl: String? = null,
    /** Full YouTube item when the source is YouTube itself, so nothing is lost converting back. */
    val ytItem: SongItem? = null,
    /** When it was added to the source's list (liked, saved to the library), so imports keep that order. */
    val addedAtMs: Long? = null,
    /** The track's own id on its service ("spotify:track:..."), which a hand-picked version is saved under. */
    val sourceId: String? = null,
)

/**
 * Where imported music came from. Kept with every imported song (see `ImportedSong`) so the Library
 * can list "Imported from Spotify" and the YouTube library sync knows to leave these songs alone.
 */
enum class ImportSource(val key: String, val label: String) {
    SPOTIFY("spotify", "Spotify"),
    APPLE_MUSIC("apple_music", "Apple Music"),
    TIDAL("tidal", "Tidal"),
    YOUTUBE_MUSIC("youtube_music", "YouTube Music"),
    DEEZER("deezer", "Deezer"),

    /** A file or a service with no name of its own (a TuneMyMusic CSV, a Musicfy backup). */
    OTHER("other", "other sources");

    /** The sources the Library gives a category of their own. */
    val isListed: Boolean get() = this != OTHER

    companion object {
        fun fromKey(key: String?): ImportSource? = entries.firstOrNull { it.key == key }
    }
}

data class ParsedImport(
    val likedSongs: List<ImportedTrack>,
    val playlists: Map<String, List<ImportedTrack>>,
    /** Songs that go straight into the Library (an account's whole song library), in no playlist. */
    val librarySongs: List<ImportedTrack> = emptyList(),
    /** Things the user should know before importing, e.g. a source that only shares part of a playlist. */
    val warnings: List<String> = emptyList(),
    /** Which service this came from; null when that isn't known (a plain CSV). */
    val provider: ImportSource? = null,
    /** Each playlist's own cover on the source service, by its name in [playlists]. */
    val playlistCovers: Map<String, String> = emptyMap(),
    /** Where each playlist lives on the service, by its name in [playlists], so it can be re-synced. */
    val playlistOrigins: Map<String, PlaylistOrigin> = emptyMap(),
) {
    val totalSongs: Int get() = likedSongs.size + librarySongs.size + playlists.values.sumOf { it.size }
    val totalPlaylists: Int get() = playlists.size
}

/** Where a playlist lives on its service. Either is enough for Re-sync to read it again. */
data class PlaylistOrigin(
    /** Its id on the service: what the service's account lists it under. */
    val remoteId: String? = null,
    /** The share link it was read from. */
    val remoteUrl: String? = null,
)

/** One Re-sync run: the playlist being read now, and what the run has done so far. */
data class ResyncSummary(
    val playlistName: String,
    /** How many playlists the run re-syncs (Re-sync all), and how many are finished. */
    val playlists: Int = 1,
    val done: Int = 0,
    /** New songs added over every playlist so far, and how many playlists got any. */
    val added: Int = 0,
    val playlistsChanged: Int = 0,
    /** Playlists that couldn't be read or added to. */
    val failed: List<String> = emptyList(),
    /** Something to know about how one was read, like a link that only shares part of the playlist. */
    val note: String? = null,
)

/** A Re-sync's read of a playlist: its songs on the service now, and where it was found. */
data class ResyncRead(
    val tracks: List<ImportedTrack>,
    val origin: PlaylistOrigin,
    val note: String? = null,
)

/**
 * One playlist for MusicImportService to re-sync. [read] runs inside the re-sync, so the wait for
 * the service already shows as progress.
 */
class ResyncRequest(
    val playlistId: String,
    val playlistName: String,
    val source: ImportSource,
    val read: suspend () -> ResyncRead,
)

data class ImportOptions(
    /** Also create the playlists (and likes) on the signed-in YouTube account. */
    val mirrorToYouTube: Boolean = false,
)

/** A track that couldn't be matched, with where it came from so the user can find it by hand. */
data class UnmatchedTrack(
    val track: ImportedTrack,
    val playlistName: String?,
)

data class ImportProgress(
    val isRunning: Boolean = false,
    val totalTracks: Int = 0,
    val processedTracks: Int = 0,
    val matchedTracks: Int = 0,
    val currentLabel: String = "",
    val isDone: Boolean = false,
    val cancelled: Boolean = false,
    /** The service being imported from, for the "Adding 12 of 340 tracks from Spotify" banner. */
    val source: ImportSource? = null,
    val playlistsCreated: Int = 0,
    val likedAdded: Int = 0,
    val unmatched: List<UnmatchedTrack> = emptyList(),
    /** Playlists that imported locally but couldn't be created or filled on YouTube. */
    val youtubeFailures: List<String> = emptyList(),
    val error: String? = null,
    /** Set while this run is a Re-sync of one playlist rather than an import. */
    val resync: ResyncSummary? = null,
)

/** A YouTube song needs no matching: the id is exact, and the full item is kept. */
internal fun SongItem.toImportedTrack() = ImportedTrack(
    title = title,
    artist = artists.joinToString(", ") { it.name },
    album = album?.name,
    durationMs = duration?.times(1000L),
    videoId = id,
    thumbnailUrl = thumbnail,
    ytItem = this,
)
