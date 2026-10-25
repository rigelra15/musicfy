package com.example.musicfy.tvtransfer

import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PortableBackupTest {
    private fun sample() = PortableBackup(
        exportId = "musicfy-android-test", exportedAt = 1_800_000_000_000, exporter = PortableBackup.Exporter("musicfy-android", "8.1.0"),
        tracks = listOf(
            PortableBackup.Track("abcdefghijk", "Lagu A", "Senja", 200_000, album = "Album A", albumId = "MPREa", artworkUrl = "https://img.example/a.jpg", artists = listOf(PortableBackup.Artist("Senja", "UC1"))),
            PortableBackup.Track("file-1", "Rekaman", "Aku", 90_000, provider = "local"),
        ),
        library = listOf(PortableBackup.LibraryItem("youtube:track:abcdefghijk", 1_700_000_000_000, "manual")),
        likes = listOf(PortableBackup.Like("youtube:track:abcdefghijk", 1_700_000_100_000)),
        pins = listOf(PortableBackup.Pin(PortableBackup.Ref("youtube", "track", "abcdefghijk"), 0, 1_700_000_200_000)),
        playlists = listOf(PortableBackup.Playlist("12", "Santai", 1, 2, listOf(PortableBackup.Entry("e1", "youtube:track:abcdefghijk", 3), PortableBackup.Entry("e2", "youtube:track:abcdefghijk", 4)))),
        history = listOf(PortableBackup.Play("android:1", "youtube:track:abcdefghijk", 1_700_000_300_000, 45_000)),
        lyricsEdits = listOf(PortableBackup.LyricsEdit("youtube:track:abcdefghijk", "[00:01.00]halo", 5)),
        prefs = mapOf("ui.language" to JsonPrimitive("id")),
    )

    @Test fun `encodes the exact JSON the TV is tested against`() {
        val golden = javaClass.getResource("/portable-v1.json")!!.readText().trim()
        assertEquals(golden, sample().encode())
    }

    @Test fun `round-trips, and carries nothing that is a secret`() {
        val text = sample().encode()
        assertEquals(sample(), PortableBackup.decode(text))
        assertFalse(Regex("token|cookie|apikey|password|signature", RegexOption.IGNORE_CASE).containsMatchIn(text))
        assertTrue(text.contains("\"format\":\"musicfy-portable\""))
        assertTrue(text.contains("\"version\":1"))
    }

    @Test fun `a track key is provider, kind and id`() {
        assertEquals("youtube:track:abcdefghijk", sample().tracks[0].trackKey)
        assertEquals("local:track:file-1", sample().tracks[1].trackKey)
    }
}
