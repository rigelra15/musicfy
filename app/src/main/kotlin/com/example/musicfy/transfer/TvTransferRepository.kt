// TvTransferRepository.kt

package com.example.musicfy.transfer

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import com.example.musicfy.BuildConfig
import com.example.musicfy.db.MusicDatabase
import com.example.musicfy.db.entities.PlaylistEntity
import com.example.musicfy.importer.MusicfyCsvExporter
import com.example.musicfy.tvtransfer.PortableBackup
import com.example.musicfy.tvtransfer.PortableBackupBuilder
import com.example.musicfy.tvtransfer.TransferSource
import com.example.musicfy.utils.dataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import java.time.LocalDateTime
import java.time.ZoneId
import javax.inject.Inject
import javax.inject.Singleton

/** Reads the library for "Transfer to TV". Read-only: it never changes anything in the database or the settings. */
@Singleton
class TvTransferRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val database: MusicDatabase,
) {
    /**
     * The database stores wall-clock time as if it were UTC (see Converters), so a time read back
     * is a clock reading; the instant it meant is that reading in this phone's own zone.
     */
    private fun LocalDateTime?.ms(): Long? = this?.atZone(ZoneId.systemDefault())?.toInstant()?.toEpochMilli()

    suspend fun readSource(): TransferSource = withContext(Dispatchers.IO) {
        val dao = database.transferDao
        val artistsById = dao.artists().associateBy { it.id }
        val artistsOf = dao.songArtists().groupBy { it.songId }
        val songs = dao.songs().map { song ->
            val artists = artistsOf[song.id].orEmpty().sortedBy { it.position }.mapNotNull { map ->
                artistsById[map.artistId]?.let { TransferSource.Artist(it.id, it.name, it.isLocal) }
            }
            TransferSource.Song(
                id = song.id, title = song.title, durationSeconds = song.duration, thumbnailUrl = song.thumbnailUrl,
                albumId = song.albumId, albumName = song.albumName, explicit = song.explicit, isLocal = song.isLocal, isVideo = song.isVideo,
                liked = song.liked, likedAt = song.likedDate.ms(), inLibraryAt = song.inLibrary.ms(), artists = artists,
            )
        }
        val entriesOf = dao.playlistSongs().groupBy { it.playlistId }
        val playlists = dao.playlists().map { playlist ->
            TransferSource.Playlist(
                id = playlist.id, name = playlist.name, createdAt = playlist.createdAt.ms(), updatedAt = playlist.lastUpdateTime.ms(),
                browseId = playlist.browseId, bookmarkedAt = playlist.bookmarkedAt.ms(), thumbnailUrl = playlist.thumbnailUrl,
                entries = entriesOf[playlist.id].orEmpty().map { TransferSource.Entry(it.id.toLong(), it.songId, it.position) },
            )
        }.filter { it.id != PlaylistEntity.LIKED_PLAYLIST_ID && it.id != PlaylistEntity.DOWNLOADED_PLAYLIST_ID }
        val events = dao.events().mapNotNull { event -> event.timestamp.ms()?.let { TransferSource.Event(event.id, event.songId, it, event.playTime) } }
        val lyrics = dao.editedLyrics().map { TransferSource.Lyrics(it.id, it.lyrics, null) }
        val pins = dao.pins().map { TransferSource.Pin(it.id, it.type, it.title, it.subtitle, it.thumbnailUrl, it.createDate) }
        val savedArtists = artistsById.values.filter { it.bookmarkedAt != null && !it.isLocal }.map { TransferSource.SavedArtist(it.id, it.name, it.thumbnailUrl, it.bookmarkedAt.ms()) }
        val savedAlbums = dao.savedAlbums().filter { !it.isLocal }.map { TransferSource.SavedAlbum(it.id, it.title, it.thumbnailUrl, (it.bookmarkedAt ?: it.inLibrary).ms()) }
        val prefs: Map<String, Any?> = context.dataStore.data.first().asMap().entries.associate { (key: Preferences.Key<*>, value) -> key.name to value }
        TransferSource(songs, playlists, events, lyrics, pins, savedArtists, savedAlbums, prefs)
    }

    suspend fun backup(): PortableBackup {
        val source = readSource()
        return withContext(Dispatchers.Default) { PortableBackupBuilder.build(source, BuildConfig.VERSION_NAME.substringBefore(' '), System.currentTimeMillis()) }
    }

    /**
     * The Apple Music session stored by the module (null when signed out). Read only to be sent when the person
     * chooses to, as its own transfer; it is never part of the backup.
     */
    fun appleSession(): ByteArray? {
        val store = context.getSharedPreferences("module_applemusic", Context.MODE_PRIVATE)
        return PortableBackupBuilder.appleSession(store.getString("user_token", null), store.getString("developer_token", null))
    }

    /** Liked songs and playlists as the CSV Musicfy already exports. */
    suspend fun csv(): ByteArray = MusicfyCsvExporter.build(database).first.toByteArray(Charsets.UTF_8)
}
