// TransferDao.kt

package com.example.musicfy.db.daos

import androidx.room.Dao
import androidx.room.Query
import com.example.musicfy.db.entities.AlbumEntity
import com.example.musicfy.db.entities.ArtistEntity
import com.example.musicfy.db.entities.Event
import com.example.musicfy.db.entities.LyricsEntity
import com.example.musicfy.db.entities.PlaylistEntity
import com.example.musicfy.db.entities.PlaylistSongMap
import com.example.musicfy.db.entities.SongArtistMap
import com.example.musicfy.db.entities.SongEntity
import com.example.musicfy.db.entities.SpeedDialItem

/** One-shot reads of everything "Transfer to TV" sends. Read-only: nothing here changes the library. */
@Dao
interface TransferDao {
    @Query("SELECT * FROM song")
    suspend fun songs(): List<SongEntity>

    @Query("SELECT * FROM artist")
    suspend fun artists(): List<ArtistEntity>

    @Query("SELECT * FROM song_artist_map ORDER BY songId, position")
    suspend fun songArtists(): List<SongArtistMap>

    @Query("SELECT * FROM playlist")
    suspend fun playlists(): List<PlaylistEntity>

    @Query("SELECT * FROM playlist_song_map ORDER BY playlistId, position")
    suspend fun playlistSongs(): List<PlaylistSongMap>

    @Query("SELECT * FROM event ORDER BY timestamp")
    suspend fun events(): List<Event>

    @Query("SELECT * FROM lyrics WHERE provider = 'UserEdited'")
    suspend fun editedLyrics(): List<LyricsEntity>

    @Query("SELECT * FROM speed_dial_item")
    suspend fun pins(): List<SpeedDialItem>

    @Query("SELECT * FROM album WHERE bookmarkedAt IS NOT NULL OR inLibrary IS NOT NULL")
    suspend fun savedAlbums(): List<AlbumEntity>
}
