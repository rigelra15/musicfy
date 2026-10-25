package com.example.musicfy.tvtransfer

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class QrDecoderTest {
    private val payload = "musicfy://pair?v=1&h=192.168.100.200&p=45123&s=c2lkLWZvci10ZXN0cw&k=AAECAwQFBgcICQoLDA0ODw&t=BB4YUy_UdUwC8wQdnHXOszuD_9gax85P6ILMscmLxYlupGwxHE4v9A3ZajZT5uRURdMt_khuztdcepDGoYiBwKM&n=Ruang%20Tamu"

    /** A camera-like frame: dark modules on light, scaled up, with a quiet zone. */
    private fun frame(text: String, scale: Int, ecc: ErrorCorrectionLevel = ErrorCorrectionLevel.M): Triple<ByteArray, Int, Int> {
        val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, mapOf(EncodeHintType.ERROR_CORRECTION to ecc, EncodeHintType.MARGIN to 4))
        val width = matrix.width * scale
        val height = matrix.height * scale
        val luma = ByteArray(width * height) { 0x7f }
        for (y in 0 until height) for (x in 0 until width) luma[y * width + x] = if (matrix.get(x / scale, y / scale)) 0x10 else 0xf0.toByte()
        return Triple(luma, width, height)
    }

    @Test fun `reads the pairing code the TV draws`() {
        val (luma, w, h) = frame(payload, 4)
        assertEquals(payload, QrDecoder().decode(luma, w, h))
    }

    @Test fun `reads frames whose rows are padded, as camera planes often are`() {
        val (tight, w, h) = frame(payload, 3)
        val stride = w + 64
        val padded = ByteArray(stride * h) { 0x55 }
        for (y in 0 until h) System.arraycopy(tight, y * w, padded, y * stride, w)
        assertEquals(payload, QrDecoder().decode(padded, w, h, stride))
    }

    @Test fun `a frame with no code gives nothing, and the decoder keeps working afterwards`() {
        val decoder = QrDecoder()
        assertNull(decoder.decode(ByteArray(200 * 200) { (it % 251).toByte() }, 200, 200))
        assertNull(decoder.decode(ByteArray(64 * 64) { 0x80.toByte() }, 64, 64))
        val (luma, w, h) = frame(payload, 4)
        assertEquals(payload, decoder.decode(luma, w, h))
    }

    @Test fun `a code with damage is still read thanks to error correction`() {
        val (luma, w, h) = frame(payload, 5, ecc = ErrorCorrectionLevel.H)
        for (y in h / 2 until h / 2 + 12) for (x in w / 2 until w / 2 + 12) luma[y * w + x] = 0x10
        assertEquals(payload, QrDecoder().decode(luma, w, h))
    }

    @Test fun `what is decoded goes straight into the pairing parser`() {
        val (luma, w, h) = frame(payload, 4)
        val code = PairingCode.parse(QrDecoder().decode(luma, w, h)!!)
        assertEquals("192.168.100.200", code.host)
        assertEquals("Ruang Tamu", code.tvName)
    }
}
