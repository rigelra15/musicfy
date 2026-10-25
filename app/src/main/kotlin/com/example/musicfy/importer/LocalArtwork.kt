// LocalArtwork.kt

package com.example.musicfy.importer

import android.content.Context
import android.net.Uri
import androidx.core.net.toUri
import com.example.musicfy.db.MusicDatabase
import com.example.musicfy.ui.screens.extractAudioMetadata
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import timber.log.Timber
import java.io.File

/**
 * Covers taken out of local audio files. They live in the app's own files folder. They used to be
 * saved in the cache folder, which Android (and phone cleaners like MIUI's) empties whenever it
 * likes, and since a song that had a cover path was never read again, its cover was gone for good.
 */
object LocalArtwork {
    private const val FOLDER = "local_artwork"

    /** Saves [bytes] as [songId]'s cover and returns the file's uri, or null if it couldn't be written. */
    fun save(context: Context, songId: String, bytes: ByteArray): String? = runCatching {
        val folder = File(context.filesDir, FOLDER).apply { mkdirs() }
        val file = File(folder, "${songId.replace(UnsafeInName, "_")}.jpg")
        // write-then-rename, so a crash mid-write never leaves a broken picture behind
        val temp = File(folder, "${file.name}.tmp")
        temp.writeBytes(bytes)
        if (!temp.renameTo(file)) {
            file.writeBytes(bytes)
            temp.delete()
        }
        Uri.fromFile(file).toString()
    }.getOrNull()

    /** True for a cover file on this phone that is gone, or that sits where it could vanish. */
    fun needsRepair(context: Context, thumbnailUrl: String?): Boolean {
        val uri = thumbnailUrl?.toUri() ?: return false
        if (uri.scheme != "file") return false
        val path = uri.path ?: return true
        return !File(path).exists() || path.startsWith(context.cacheDir.path)
    }

    /**
     * Fixes the covers of local songs: moves any still in the cache folder to where they stay, and
     * reads the song's file again for one that's gone. With [includeMissing], songs that never had
     * a cover get another look too (a re-scan, where the file may have been retagged since).
     * Returns how many covers it fixed.
     */
    suspend fun repair(context: Context, database: MusicDatabase, includeMissing: Boolean = false): Int =
        withContext(Dispatchers.IO) {
            val songs = database.localSongsByRowIdAsc().first().map { it.song }
            var fixed = 0
            for (song in songs) {
                val current = song.thumbnailUrl
                val wanted = when {
                    needsRepair(context, current) -> true
                    includeMissing && current == null -> true
                    else -> false
                }
                if (!wanted) continue
                val newUrl = try {
                    moveOutOfCache(context, song.id, current) ?: readFromFile(context, song.id, song.localUri)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Timber.w(e, "Couldn't repair the cover of ${song.id}")
                    null
                }
                // a cover that's gone for good is cleared, so the song shows the plain placeholder
                // rather than a broken picture, and playing it tries the file again
                if (newUrl != current && (newUrl != null || current != null)) {
                    database.query { update(song.copy(thumbnailUrl = newUrl)) }
                    if (newUrl != null) fixed++
                }
            }
            fixed
        }

    /** A cover still in the cache folder, copied out before Android clears it. */
    private fun moveOutOfCache(context: Context, songId: String, thumbnailUrl: String?): String? {
        val path = thumbnailUrl?.toUri()?.path ?: return null
        val file = File(path)
        if (!file.exists()) return null
        val saved = save(context, songId, file.readBytes()) ?: return null
        file.delete()
        return saved
    }

    private fun readFromFile(context: Context, songId: String, localUri: String?): String? {
        val uri = localUri?.toUri() ?: return null
        val bytes = extractAudioMetadata(context, uri).embeddedArtwork ?: return null
        return save(context, songId, bytes)
    }

    private val UnsafeInName = Regex("[^A-Za-z0-9_.-]")
}
