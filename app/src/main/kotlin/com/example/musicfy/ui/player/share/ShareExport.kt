// ShareExport.kt
//
// Turning the finished picture into a file: one in the cache for the share sheet, or one in
// Pictures/Musicfy to keep. Also reads the cover's colours, which the backgrounds, the card and
// the line picker are all tinted with.

package com.example.musicfy.ui.player.share

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.toArgb
import androidx.core.content.FileProvider
import androidx.palette.graphics.Palette
import coil3.imageLoader
import coil3.request.ImageRequest
import coil3.request.allowHardware
import coil3.toBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

private const val ShareDir = "lyrics_share"

/** The recorded picture as a plain bitmap that can be written to a file. */
internal suspend fun GraphicsLayer.toShareBitmap(): Bitmap {
    val bitmap = toImageBitmap().asAndroidBitmap()
    // a hardware bitmap can't be compressed; copy it into memory first. HARDWARE only exists on
    // Android 8+, so the check reads it only there
    val hardware = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && bitmap.config == Bitmap.Config.HARDWARE
    return if (hardware) bitmap.copy(Bitmap.Config.ARGB_8888, false) else bitmap
}

/** Writes the picture to the cache (older shares are cleared first) and hands back a shareable uri. */
internal suspend fun cacheShareImage(context: Context, bitmap: Bitmap): Uri = withContext(Dispatchers.IO) {
    val dir = File(context.cacheDir, ShareDir).apply { mkdirs() }
    dir.listFiles()?.forEach { it.delete() }
    val file = File(dir, "musicfy-lyrics-${System.currentTimeMillis()}.png")
    file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    FileProvider.getUriForFile(context, "${context.packageName}.FileProvider", file)
}

internal fun openShareSheet(context: Context, uri: Uri, song: ShareSong) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "image/png"
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_TEXT, "${song.title} · ${song.artist}")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(send, "Share lyrics").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

/** Keeping a copy needs the shared Pictures folder, which apps can only write to freely on Android 10+. */
internal val CanSaveToGallery: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q

internal suspend fun saveShareImage(context: Context, bitmap: Bitmap): Boolean = withContext(Dispatchers.IO) {
    if (!CanSaveToGallery) return@withContext false
    runCatching {
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, "musicfy-lyrics-${System.currentTimeMillis()}.png")
            put(MediaStore.MediaColumns.MIME_TYPE, "image/png")
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Musicfy")
        }
        val uri = context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return@runCatching false
        context.contentResolver.openOutputStream(uri)?.use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) } != null
    }.getOrDefault(false)
}

/**
 * The cover's colours, strongest first, each pulled into a range where white text reads well on
 * it. Never empty once it returns: a cover that won't load gives a pair of greys.
 */
internal suspend fun coverPalette(context: Context, thumbnailUrl: String?): List<Color> = withContext(Dispatchers.IO) {
    val fallback = listOf(Color(0xFF3A3A3C), Color(0xFF242426))
    if (thumbnailUrl == null) return@withContext fallback
    val bitmap = runCatching {
        context.imageLoader.execute(
            ImageRequest.Builder(context).data(thumbnailUrl).size(128).allowHardware(false).build(),
        ).image?.toBitmap()
    }.getOrNull() ?: return@withContext fallback
    val palette = Palette.from(bitmap).maximumColorCount(16).generate()
    val swatches = listOfNotNull(
        palette.vibrantSwatch,
        palette.dominantSwatch,
        palette.darkVibrantSwatch,
        palette.mutedSwatch,
        palette.lightVibrantSwatch,
        palette.darkMutedSwatch,
    ) + palette.swatches.sortedByDescending { it.population }
    swatches
        .map { readableTone(it.rgb) }
        .distinctBy { it.toArgb() }
        .take(6)
        .ifEmpty { fallback }
}

/** Keeps the hue, caps the brightness so white text stays readable, and lifts colours that are near black. */
private fun readableTone(rgb: Int): Color {
    val hsv = FloatArray(3)
    android.graphics.Color.colorToHSV(rgb, hsv)
    hsv[1] = hsv[1].coerceIn(0.12f, 0.85f)
    hsv[2] = hsv[2].coerceIn(0.22f, 0.62f)
    return Color(android.graphics.Color.HSVToColor(hsv))
}
