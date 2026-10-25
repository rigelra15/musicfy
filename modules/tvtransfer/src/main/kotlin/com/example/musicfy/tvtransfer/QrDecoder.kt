package com.example.musicfy.tvtransfer

import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.NotFoundException
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer

/** Reads a QR code out of one camera frame's brightness plane. Nothing here knows about the camera. */
class QrDecoder {
    private val reader = MultiFormatReader().apply {
        setHints(mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE), DecodeHintType.TRY_HARDER to true))
    }

    /**
     * `luma` is the Y plane, `rowStride` bytes per row (it can be wider than `width`). Returns the text, or null when the
     * frame holds no readable code, which is the normal case for most frames.
     */
    fun decode(luma: ByteArray, width: Int, height: Int, rowStride: Int = width): String? {
        require(width > 0 && height > 0 && rowStride >= width) { "bad frame" }
        val tight = if (rowStride == width) luma else ByteArray(width * height).also { out ->
            for (row in 0 until height) System.arraycopy(luma, row * rowStride, out, row * width, width)
        }
        val bitmap = BinaryBitmap(HybridBinarizer(PlanarYUVLuminanceSource(tight, width, height, 0, 0, width, height, false)))
        return try {
            reader.decodeWithState(bitmap).text
        } catch (e: NotFoundException) {
            null
        } catch (e: com.google.zxing.ChecksumException) {
            null
        } catch (e: com.google.zxing.FormatException) {
            null
        } finally {
            reader.reset()
        }
    }
}
