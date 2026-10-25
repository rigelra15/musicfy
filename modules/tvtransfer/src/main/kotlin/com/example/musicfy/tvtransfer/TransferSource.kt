package com.example.musicfy.tvtransfer

/**
 * What the phone's database holds, as plain values (times are epoch milliseconds, durations in
 * seconds like Room stores them). The Android layer fills these in; turning them into a backup is
 * pure logic and is tested here.
 */
class TransferSource(
    val songs: List<Song>,
    val playlists: List<Playlist>,
    val events: List<Event>,
    val userEditedLyrics: List<Lyrics>,
    val pins: List<Pin>,
    val savedArtists: List<SavedArtist>,
    val savedAlbums: List<SavedAlbum>,
    /** DataStore values by the phone's own preference names. */
    val prefs: Map<String, Any?>,
) {
    class Artist(val id: String?, val name: String, val isLocal: Boolean = false)
    class Song(
        val id: String, val title: String, val durationSeconds: Int, val thumbnailUrl: String?, val albumId: String?, val albumName: String?,
        val explicit: Boolean, val isLocal: Boolean, val isVideo: Boolean, val liked: Boolean, val likedAt: Long?, val inLibraryAt: Long?,
        val artists: List<Artist>,
    )
    class Entry(val mapId: Long, val songId: String, val position: Int)
    class Playlist(val id: String, val name: String, val createdAt: Long?, val updatedAt: Long?, val browseId: String?, val bookmarkedAt: Long?, val thumbnailUrl: String?, val entries: List<Entry>)
    class Event(val id: Long, val songId: String, val timestamp: Long, val playTimeMs: Long)
    class Lyrics(val songId: String, val lrc: String, val editedAt: Long?)
    /** A Speed dial pin: `type` is SONG, ALBUM, ARTIST or PLAYLIST. */
    class Pin(val id: String, val type: String, val title: String, val subtitle: String?, val thumbnailUrl: String?, val createDate: Long)
    class SavedArtist(val id: String, val name: String, val thumbnailUrl: String?, val savedAt: Long?)
    class SavedAlbum(val id: String, val title: String, val thumbnailUrl: String?, val savedAt: Long?)
}
