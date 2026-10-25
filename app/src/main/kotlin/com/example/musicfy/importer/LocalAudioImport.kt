// LocalAudioImport.kt
//
// Turning one audio file into a song in the library: tags, artwork, artist, lyrics and format row.
// Used by the local import (files picked or found on the phone, see LocalImportService) and by
// audio files shared into Musicfy from other apps.

package com.example.musicfy.importer

import android.content.Context
import android.net.Uri
import com.example.musicfy.db.MusicDatabase
import com.example.musicfy.db.entities.ArtistEntity
import com.example.musicfy.db.entities.FormatEntity
import com.example.musicfy.db.entities.SongArtistMap
import com.example.musicfy.db.entities.SongEntity
import com.example.musicfy.ui.screens.extractAudioMetadata
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.LocalDateTime
import java.util.UUID

/**
 * Adds one audio file to the library as a local song and returns the new song's id.
 * [uri] has to stay readable, so a shared file is copied into the app first (see [importSharedAudio]).
 */
suspend fun importLocalAudio(
    context: Context,
    database: MusicDatabase,
    uri: Uri,
): String {
    val metadata = withContext(Dispatchers.IO) {
        extractAudioMetadata(context, uri)
    }

    // the file's own lyrics, if its tags have any: saved with it, so they're
    // there offline from the first play
    val embeddedLyrics = withContext(Dispatchers.IO) {
        com.example.musicfy.lyrics.readEmbeddedLyrics(context, uri)
    }

    val songId = "LOCAL_${UUID.randomUUID()}"
    val thumbnailUrl = withContext(Dispatchers.IO) {
        metadata.embeddedArtwork?.let { LocalArtwork.save(context, songId, it) }
    }

    withContext(Dispatchers.IO) {
        database.transaction {
            insert(
                SongEntity(
                    id = songId,
                    title = metadata.title,
                    duration = metadata.durationSeconds,
                    thumbnailUrl = thumbnailUrl,
                    albumName = metadata.album,
                    isLocal = true,
                    inLibrary = LocalDateTime.now(),
                    localUri = uri.toString(),
                ),
            )

            val artistName = metadata.artist
            val artistId = artistByName(artistName)?.id
                ?: ArtistEntity.generateArtistId()
            insert(
                ArtistEntity(
                    id = artistId,
                    name = artistName,
                    isLocal = true,
                ),
            )
            insert(
                SongArtistMap(
                    songId = songId,
                    artistId = artistId,
                    position = 0,
                ),
            )

            embeddedLyrics?.let { lyrics ->
                upsert(
                    com.example.musicfy.db.entities.LyricsEntity(
                        id = songId,
                        lyrics = lyrics,
                        provider = com.example.musicfy.lyrics.EmbeddedLyrics.Provider,
                    ),
                )
            }

            val mimeType = metadata.mimeType ?: "audio/mpeg"
            val codecs = when {
                mimeType.contains("flac") -> "flac"
                mimeType.contains("opus") || mimeType.contains("ogg") -> "opus"
                mimeType.contains("mp4") || mimeType.contains("m4a") || mimeType.contains("aac") -> "mp4a.40.2"
                mimeType.contains("wav") -> "pcm"
                else -> "mp3"
            }
            upsert(
                FormatEntity(
                    id = songId,
                    itag = -1,
                    mimeType = mimeType,
                    codecs = codecs,
                    bitrate = metadata.bitrate ?: 0,
                    sampleRate = metadata.sampleRate,
                    contentLength = 0L,
                    loudnessDb = null,
                    perceptualLoudnessDb = null,
                    playbackUrl = null,
                ),
            )
        }
    }
    return songId
}

/** Copies a file another app shared into the app's own storage, then imports it. */
suspend fun importSharedAudio(
    context: Context,
    database: MusicDatabase,
    shared: Uri,
) {
    val name = withContext(Dispatchers.IO) {
        context.contentResolver.query(shared, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { if (it.moveToFirst()) it.getString(0) else null }
    }?.replace(Regex("[\\\\/:*?\"<>|]"), "_") ?: "audio"
    val copy = withContext(Dispatchers.IO) {
        val dir = java.io.File(context.filesDir, "shared_audio/${UUID.randomUUID()}").apply { mkdirs() }
        java.io.File(dir, name).also { file ->
            context.contentResolver.openInputStream(shared)!!.use { input ->
                file.outputStream().use { input.copyTo(it) }
            }
        }
    }
    try {
        importLocalAudio(context, database, Uri.fromFile(copy))
    } catch (e: Exception) {
        copy.parentFile?.deleteRecursively()
        throw e
    }
}
