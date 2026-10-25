package com.example.musicfy.tvtransfer

import com.example.musicfy.tvtransfer.TransferSource.Artist
import com.example.musicfy.tvtransfer.TransferSource.Entry
import com.example.musicfy.tvtransfer.TransferSource.Event
import com.example.musicfy.tvtransfer.TransferSource.Lyrics
import com.example.musicfy.tvtransfer.TransferSource.Pin
import com.example.musicfy.tvtransfer.TransferSource.Playlist
import com.example.musicfy.tvtransfer.TransferSource.SavedAlbum
import com.example.musicfy.tvtransfer.TransferSource.SavedArtist
import com.example.musicfy.tvtransfer.TransferSource.Song
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PortableBackupBuilderTest {
    private val now = 1_800_000_000_000L
    private fun song(id: String, title: String = "Lagu $id", inLibrary: Long? = null, liked: Boolean = false, local: Boolean = false, artists: List<Artist> = listOf(Artist("UC$id", "Senja"))) =
        Song(id, title, 200, "https://img.example/$id.jpg", "MPRE$id", "Album $id", false, local, false, liked, if (liked) 1_700_000_100_000 else null, inLibrary, artists)
    private fun source(songs: List<Song>, playlists: List<Playlist> = emptyList(), events: List<Event> = emptyList(), lyrics: List<Lyrics> = emptyList(),
                        pins: List<Pin> = emptyList(), artists: List<SavedArtist> = emptyList(), albums: List<SavedAlbum> = emptyList(), prefs: Map<String, Any?> = emptyMap()) =
        TransferSource(songs, playlists, events, lyrics, pins, artists, albums, prefs)
    private fun build(source: TransferSource) = PortableBackupBuilder.build(source, "8.1.0", now)

    @Test fun `library and likes carry their times, and a liked song is listed as a like`() {
        val backup = build(source(listOf(song("a", inLibrary = 1_700_000_000_000), song("b", liked = true), song("c"))))
        assertEquals(listOf("youtube:track:a"), backup.library.map { it.trackKey })
        assertEquals(1_700_000_000_000, backup.library[0].addedAt)
        assertEquals(listOf("youtube:track:b"), backup.likes.map { it.trackKey })
        assertEquals(setOf("a", "b"), backup.tracks.map { it.id }.toSet())            // c has nothing that refers to it
    }

    @Test fun `a track keeps what the TV shows and drops what it cannot use`() {
        val backup = build(source(listOf(song("a", inLibrary = 1, artists = listOf(Artist("UC1", "Senja"), Artist("UC2", "Fajar"), Artist("x", " "))))))
        val track = backup.tracks.single()
        assertEquals("Senja, Fajar", track.artist)
        assertEquals(200_000, track.durationMs)
        assertEquals("https://img.example/a.jpg", track.artworkUrl)
        assertEquals(listOf("UC1", "UC2"), track.artists!!.map { it.id })
        assertEquals("Album a", track.album)
        val insecure = build(source(listOf(Song("z", "Z", -1, "http://insecure.example/z.jpg", null, null, true, false, true, false, null, 1, emptyList()))))
        assertEquals(null, insecure.tracks.single().artworkUrl)
        assertEquals(0, insecure.tracks.single().durationMs)
        assertEquals(true, insecure.tracks.single().explicit)
        assertEquals(true, insecure.tracks.single().isVideo)
    }

    @Test fun `files on the phone are marked local and keep no artwork address`() {
        val backup = build(source(listOf(song("file-1", inLibrary = 1, local = true, artists = listOf(Artist("loc", "Aku", isLocal = true))))))
        val track = backup.tracks.single()
        assertEquals("local", track.provider)
        assertEquals("local:track:file-1", backup.library.single().trackKey)
        assertEquals(null, track.artworkUrl)
        assertEquals(null, track.artists!!.single().id)
        assertEquals(1, PortableBackupBuilder.summarize(backup).localFiles)
    }

    @Test fun `playlists keep their order and their repeats, and the system ones stay behind`() {
        val songs = listOf(song("a"), song("b"))
        val backup = build(source(songs, playlists = listOf(
            Playlist("LP1", "Santai", 10, 20, null, null, null, listOf(Entry(5, "b", 1), Entry(4, "a", 0), Entry(6, "a", 2), Entry(7, "ghost", 3))),
            Playlist("LP_LIKED", "Liked", 1, 1, null, null, null, listOf(Entry(9, "a", 0))),
            Playlist("LP_DOWNLOADED", "Downloaded", 1, 1, null, null, null, listOf(Entry(10, "a", 0))),
            Playlist("LP2", "", 1, null, null, null, null, emptyList()),
        )))
        assertEquals(listOf("LP1", "LP2"), backup.playlists.map { it.id })
        assertEquals(listOf("youtube:track:a", "youtube:track:b", "youtube:track:a"), backup.playlists[0].entries.map { it.trackKey })
        assertEquals(listOf("pe4", "pe5", "pe6"), backup.playlists[0].entries.map { it.entryId })
        assertEquals("Playlist", backup.playlists[1].name)
        assertEquals(setOf("a", "b"), backup.tracks.map { it.id }.toSet())
    }

    @Test fun `history becomes plays with a stable id, only for songs that are known`() {
        val backup = build(source(listOf(song("a")), events = listOf(Event(1, "a", 1_700_000_300_000, 45_000), Event(2, "ghost", 1, 1), Event(3, "a", 1_700_000_400_000, -5))))
        assertEquals(listOf("ev1", "ev3"), backup.history.map { it.id })
        assertEquals(listOf(45_000L, 0L), backup.history.map { it.listenedMs })
    }

    @Test fun `only the user's own lyric edits travel`() {
        val backup = build(source(listOf(song("a")), lyrics = listOf(Lyrics("a", "[00:01.00]halo", 5), Lyrics("a2", "x", 1), Lyrics("a", "  ", 1))))
        assertEquals(1, backup.lyricsEdits.size)
        assertEquals("[00:01.00]halo", backup.lyricsEdits[0].lrc)
    }

    @Test fun `pins are newest first, at most nine, and a pinned album gets a face on the TV`() {
        val pins = (1..12).map { Pin("A$it", "ALBUM", "Album $it", "Senja", "https://img.example/$it.jpg", it.toLong()) } + Pin("a", "SONG", "Lagu a", null, null, 100) + Pin("ghost", "SONG", "x", null, null, 101) + Pin("q", "WEIRD", "x", null, null, 102)
        val backup = build(source(listOf(song("a")), pins = pins))
        assertEquals(9, backup.pins.size)
        assertEquals(listOf("a", "A12", "A11"), backup.pins.take(3).map { it.ref.id })
        assertEquals(listOf(0, 1, 2), backup.pins.take(3).map { it.position })
        assertEquals("track", backup.pins[0].ref.kind)
        assertTrue(backup.savedEntities.any { it.ref.kind == "album" && it.ref.id == "A12" })
        assertFalse(backup.savedEntities.any { it.ref.id == "A1" })                    // not pinned (cut off by the limit), so no extra item
    }

    @Test fun `followed artists, albums and online playlists become saved items`() {
        val backup = build(source(emptyList(),
            playlists = listOf(Playlist("LPx", "Online", 1, 2, "PLabc", 7, "https://img.example/p.jpg", emptyList()), Playlist("LPy", "Not saved", 1, 2, "PLdef", null, null, emptyList())),
            artists = listOf(SavedArtist("UC1", "Senja", "https://img.example/u.jpg", 5), SavedArtist("local-artist", "Aku", null, 5)),
            albums = listOf(SavedAlbum("MPREx", "Album X", "https://img.example/x.jpg", 6))))
        assertEquals(setOf("artist:UC1", "album:MPREx", "playlist:PLabc"), backup.savedEntities.map { "${it.ref.kind}:${it.ref.id}" }.toSet())
    }

    @Test fun `only settings the TV understands are sent, and only with the right kind of value`() {
        val backup = build(source(emptyList(), prefs = mapOf(
            "appLanguage" to "id", "hideExplicit" to true, "hideVideoSongs" to "yes", "pauseListenHistory" to false, "historyDuration" to 45f,
            "playerMenuSlots" to "SHUFFLE,QUEUE,SPEED,OUTPUT", "playerSideButton" to "LIKE", "discordAccessToken" to "SECRET", "LastFmSessionKey" to "SECRET2")))
        assertEquals(setOf("ui.language", "content.hideExplicit", "history.paused", "history.minSeconds", "player.menuSlots", "player.sideButton"), backup.prefs.keys)
        assertEquals(JsonPrimitive(45), backup.prefs["history.minSeconds"])
        assertEquals(JsonPrimitive("id"), backup.prefs["ui.language"])
        assertFalse(backup.encode().contains("SECRET"))
        assertEquals(emptySet<String>(), build(source(emptyList(), prefs = mapOf("appLanguage" to "SYSTEM_DEFAULT"))).prefs.keys)
    }

    @Test fun `what is built is a valid portable backup that decodes back to itself`() {
        val backup = build(source(listOf(song("a", inLibrary = 1, liked = true)), playlists = listOf(Playlist("LP1", "P", 1, 2, null, null, null, listOf(Entry(1, "a", 0))))))
        assertEquals(backup, PortableBackup.decode(backup.encode()))
        val summary = PortableBackupBuilder.summarize(backup)
        assertEquals(1, summary.songs); assertEquals(1, summary.playlists); assertEquals(1, summary.likes); assertEquals(0, summary.history)
    }

    @Test fun `an Apple session needs a real token, and carries only the two tokens`() {
        assertEquals(null, PortableBackupBuilder.appleSession(null, null))
        assertEquals(null, PortableBackupBuilder.appleSession("short", "eyJabc"))
        val text = PortableBackupBuilder.appleSession("U".repeat(40), "eyJhbGciOiJFUzI1NiJ9.e30.c2ln")!!.decodeToString()
        assertEquals("""{"userToken":"${"U".repeat(40)}","developerToken":"eyJhbGciOiJFUzI1NiJ9.e30.c2ln"}""", text)
        assertFalse(PortableBackupBuilder.appleSession("U".repeat(40), "not-a-jwt")!!.decodeToString().contains("developerToken"))
    }

    @Test fun `a backup never contains a session`() {
        val backup = build(source(listOf(song("a", inLibrary = 1)), prefs = mapOf("user_token" to "U".repeat(40), "developer_token" to "eyJabc.def.ghi")))
        assertFalse(backup.encode().contains("UUUU"))
        assertFalse(backup.encode().contains("eyJabc"))
    }
}
