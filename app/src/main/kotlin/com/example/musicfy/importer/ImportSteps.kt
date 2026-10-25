// ImportSteps.kt

package com.example.musicfy.importer

import android.content.Context
import com.example.musicfy.db.MusicDatabase
import com.example.musicfy.db.entities.ImportSessionSong
import com.example.musicfy.db.entities.ImportedPlaylist
import com.example.musicfy.db.entities.ImportedSong
import com.example.musicfy.db.entities.PlaylistEntity
import com.example.musicfy.db.entities.PlaylistSongMap
import com.example.musicfy.extensions.isUserLoggedIn
import com.example.musicfy.models.toMediaMetadata
import com.music.innertube.YouTube
import com.music.innertube.models.SongItem
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import timber.log.Timber
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import kotlin.coroutines.coroutineContext

/**
 * The work of an import or a re-sync: matching tracks on YouTube Music, putting their songs in
 * the library, and making or topping up playlists. MusicImportService runs one at a time and owns
 * the [progress] these steps report into.
 */
internal class ImportSteps(
    private val context: Context,
    private val database: MusicDatabase,
    private val progress: MutableStateFlow<ImportProgress>,
) {
    /** Where the run comes from; set by the service before each run. */
    @Volatile var source: ImportSource = ImportSource.OTHER

    /** The session the run records what it changes under, so it can be undone. */
    @Volatile var sessionId: Long? = null

    /** Where each imported playlist lives on its service and what it had there, for Re-sync. */
    val record = PlaylistSourceRecord(database)

    /** A matcher for one run: it uses the versions the user picked and notes what it finds. */
    fun newMatcher() = TrackMatcher(ImportMatches.get(context), source)

    suspend fun runImport(parsed: ParsedImport, options: ImportOptions) {
        val matcher = newMatcher()
        val signedIn = context.isUserLoggedIn()
        val mirror = options.mirrorToYouTube && signedIn

        if (parsed.likedSongs.isNotEmpty()) importLiked(matcher, parsed.likedSongs, mirror)
        if (parsed.librarySongs.isNotEmpty()) importLibrarySongs(matcher, parsed.librarySongs)

        for ((name, tracks) in parsed.playlists) {
            coroutineContext.ensureActive()
            importPlaylist(matcher, name, tracks, parsed.playlistCovers[name], parsed.playlistOrigins[name], mirror, signedIn)
        }
    }

    private suspend fun importLiked(matcher: TrackMatcher, tracks: List<ImportedTrack>, mirror: Boolean) {
        val matched = matchAll(matcher, tracks, playlistName = null, label = "Liked songs").distinctBy { it.item.id }
        if (matched.isEmpty()) return

        database.withTransaction {
            matched.forEach { insert(it.item.toMediaMetadata()) }
        }
        val dates = sourceDates(matched)
        fileIntoLibrary(matched.map { it.item.id }, dates)

        // liked when they were liked on the source, so they sit among the existing likes in that order
        val newlyLiked = mutableListOf<String>()
        matched.forEach { (_, item) ->
            val song = database.getSongById(item.id)?.song ?: return@forEach
            if (!song.liked) {
                database.update(song.copy(liked = true, likedDate = dates.getValue(item.id)))
                sessionId?.let { database.markLikedByImport(it, item.id) }
                newlyLiked += item.id
            }
        }
        progress.update { it.copy(likedAdded = it.likedAdded + newlyLiked.size) }

        // remembered either way: a like that fails now (or before signing in) goes up on the next sync
        PendingYouTubeLikes.add(context, newlyLiked)
        if (mirror && newlyLiked.isNotEmpty()) {
            progress.update { it.copy(currentLabel = "Liking songs on YouTube") }
            val pushed = mutableListOf<String>()
            newlyLiked.forEach { id ->
                coroutineContext.ensureActive()
                if (YouTube.likeVideo(id, true).isSuccess) pushed += id
                delay(LIKE_DELAY_MS)
            }
            PendingYouTubeLikes.remove(context, pushed)
            if (pushed.size < newlyLiked.size) {
                progress.update { it.copy(youtubeFailures = it.youtubeFailures + "Liked songs (${newlyLiked.size - pushed.size} will retry on next sync)") }
            }
        }
    }

    /** An account's whole song library: into the Library's Songs, and nowhere else. */
    private suspend fun importLibrarySongs(matcher: TrackMatcher, tracks: List<ImportedTrack>) {
        val matched = matchAll(matcher, tracks, playlistName = null, label = "Library songs").distinctBy { it.item.id }
        if (matched.isEmpty()) return
        database.withTransaction {
            matched.forEach { insert(it.item.toMediaMetadata()) }
        }
        fileIntoLibrary(matched.map { it.item.id }, sourceDates(matched))
    }

    /**
     * When each song was added on the source, so the Library and Liked songs list them in the
     * source's order. A song the source gave no date gets one just before the song above it - a
     * source without dates lists newest first.
     */
    private fun sourceDates(matched: List<Matched>): Map<String, LocalDateTime> {
        val now = LocalDateTime.now()
        val dates = HashMap<String, LocalDateTime>()
        var previous: LocalDateTime? = null
        matched.forEach { (track, item) ->
            val date = track.addedAtMs?.let { LocalDateTime.ofInstant(Instant.ofEpochMilli(it), ZoneId.systemDefault()) }
                ?: previous?.minusSeconds(1)
                ?: now
            dates[item.id] = date
            previous = date
        }
        return dates
    }

    /** [cover] is the playlist's own picture on the source; without one the app shows its songs' covers. */
    private suspend fun importPlaylist(
        matcher: TrackMatcher,
        name: String,
        tracks: List<ImportedTrack>,
        cover: String?,
        origin: PlaylistOrigin?,
        mirror: Boolean,
        signedIn: Boolean,
    ) {
        // importing a playlist again tops up the copy made last time instead of duplicating it
        record.existingCopy(source, name, origin)?.let { existing ->
            // topping up one that has no picture of its own: it gets the source's
            if (existing.thumbnailUrl == null && cover != null) database.update(existing.copy(thumbnailUrl = cover))
            val fresh = record.newTracks(existing.id, tracks)
            countAsDone(tracks.size - fresh.size)
            val added = topUp(matcher, existing, fresh, signedIn, intoLibrary = true)
            record.remember(source, existing.id, tracks, origin)
            if (existing.browseId == null && mirror && added.isNotEmpty()) mirrorPlaylist(existing.id, name)
            return
        }

        val matched = matchAll(matcher, tracks, playlistName = name, label = name).map { it.item }
        val songIds = matched.map { it.id }.distinct()
        // nothing found: don't leave an empty playlist behind (an intentionally empty one has no tracks at all)
        if (songIds.isEmpty() && tracks.isNotEmpty()) return

        val playlist = PlaylistEntity(
            name = name,
            bookmarkedAt = LocalDateTime.now(),
            isEditable = true,
            thumbnailUrl = cover,
        )
        database.withTransaction {
            insert(playlist)
            insert(
                ImportedPlaylist(
                    playlistId = playlist.id,
                    source = source.key,
                    sessionId = sessionId,
                    importedAt = LocalDateTime.now(),
                    remoteId = origin?.remoteId,
                    remoteUrl = origin?.remoteUrl,
                ),
            )
            matched.distinctBy { it.id }.forEach { insert(it.toMediaMetadata()) }
            songIds.forEachIndexed { index, songId ->
                insert(PlaylistSongMap(songId = songId, playlistId = playlist.id, position = index))
            }
        }
        record.remember(source, playlist.id, tracks, origin)
        fileIntoLibrary(songIds)
        progress.update { it.copy(playlistsCreated = it.playlistsCreated + 1) }
        if (mirror) mirrorPlaylist(playlist.id, name)
    }

    /** Tracks a playlist already had count as found, so the progress still reaches the end. */
    private fun countAsDone(tracks: Int) {
        if (tracks <= 0) return
        progress.update { it.copy(processedTracks = it.processedTracks + tracks, matchedTracks = it.matchedTracks + tracks) }
    }

    /** Finds [tracks] on YouTube Music and adds them to the end of [playlist], skipping any it has. Returns the ids added. */
    suspend fun topUp(
        matcher: TrackMatcher,
        playlist: PlaylistEntity,
        tracks: List<ImportedTrack>,
        signedIn: Boolean,
        intoLibrary: Boolean,
    ): List<String> {
        if (tracks.isEmpty()) return emptyList()
        val matched = matchAll(matcher, tracks, playlistName = playlist.name, label = playlist.name).map { it.item }
        val songIds = matched.map { it.id }.distinct()
        if (songIds.isEmpty()) return emptyList()

        // after the last position rather than the count: removing songs leaves gaps
        val start = (database.playlistSongs(playlist.id).first().maxOfOrNull { it.map.position } ?: -1) + 1
        var added: List<String> = emptyList()
        database.withTransaction {
            matched.distinctBy { it.id }.forEach { insert(it.toMediaMetadata()) }
            val already = playlistDuplicates(playlist.id, songIds).toSet()
            added = songIds.filterNot { it in already }
            added.forEachIndexed { index, songId ->
                insert(PlaylistSongMap(songId = songId, playlistId = playlist.id, position = start + index))
            }
        }
        if (intoLibrary) fileIntoLibrary(songIds)

        // already linked to YouTube: keep both sides in step
        val browseId = playlist.browseId
        if (browseId != null && signedIn && added.isNotEmpty()) {
            progress.update { it.copy(currentLabel = "Adding to \"${playlist.name}\" on YouTube") }
            YouTube.addVideosToPlaylist(browseId, added).onFailure {
                progress.update { p -> p.copy(youtubeFailures = p.youtubeFailures + playlist.name) }
            }
        }
        return added
    }

    /**
     * Puts imported songs where all music lives. The Library's Songs, Artists and Albums list what
     * is `inLibrary`, so an imported song that only sat in a playlist - or in Liked songs - never
     * showed up there. Each is also recorded as imported from [source], which is what the
     * "Imported from" cards list and what the YouTube library sync reads to leave these songs be.
     *
     * Local only: this does not touch the user's YouTube library (see mirrorToYouTube for that).
     */
    suspend fun fileIntoLibrary(songIds: List<String>, addedAt: Map<String, LocalDateTime> = emptyMap()) {
        if (songIds.isEmpty()) return
        val now = LocalDateTime.now()
        val from = source.key
        val session = sessionId
        database.withTransaction {
            songIds.distinct().forEach { id ->
                val song = getSongById(id)?.song ?: return@forEach
                val adding = song.inLibrary == null
                if (adding) update(song.copy(inLibrary = addedAt[id] ?: now))
                insert(ImportedSong(songId = id, source = from, importedAt = now))
                // the first step to touch a song records it; a later one finds it already in
                if (session != null) insert(ImportSessionSong(session, id, addedToLibrary = adding, liked = false))
            }
        }
    }

    private suspend fun mirrorPlaylist(playlistId: String, name: String) {
        progress.update { it.copy(currentLabel = "Creating \"$name\" on YouTube") }
        if (!YouTubePlaylistMirror.mirror(database, playlistId, name)) {
            progress.update { it.copy(youtubeFailures = it.youtubeFailures + name) }
        }
    }

    /** A source track and the YouTube Music song found for it. */
    private data class Matched(val track: ImportedTrack, val item: SongItem)

    /** Matches in parallel (a few searches at a time) and keeps the source order. */
    private suspend fun matchAll(
        matcher: TrackMatcher,
        tracks: List<ImportedTrack>,
        playlistName: String?,
        label: String,
    ): List<Matched> = coroutineScope {
        val semaphore = Semaphore(MATCH_PARALLELISM)
        tracks.map { track ->
            async {
                semaphore.withPermit {
                    val item = try {
                        matcher.match(track)
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        Timber.w(e, "Match failed for ${track.title}")
                        null
                    }
                    progress.update { p ->
                        p.copy(
                            processedTracks = p.processedTracks + 1,
                            matchedTracks = p.matchedTracks + if (item != null) 1 else 0,
                            currentLabel = "$label — ${track.title}",
                            unmatched = if (item == null) p.unmatched + UnmatchedTrack(track, playlistName) else p.unmatched,
                        )
                    }
                    item?.let { Matched(track, it) }
                }
            }
        }.awaitAll().filterNotNull().also { matcher.flush() }
    }

    private companion object {
        const val MATCH_PARALLELISM = 4
        const val LIKE_DELAY_MS = 120L
    }
}
