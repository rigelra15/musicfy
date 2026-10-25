package com.example.musicfy.tvtransfer

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** A TV written the way service/transfer.cjs behaves, to check that the phone sends what the TV accepts. */
private class FakeTv(private val code: PairingCode, private val tvPrivate: ByteArray, private val honest: Boolean = true) : Transport {
    var keys: TransferCrypto.Keys? = null
    var expected = 0L
    val received = java.io.ByteArrayOutputStream()
    val log = mutableListOf<String>()
    var header: kotlinx.serialization.json.JsonObject? = null
    var cancelled = false
    var statusForSend = 200

    override fun post(url: String, body: String): Transport.Reply {
        val route = url.substringAfterLast('/')
        log += route
        require(url.startsWith("http://${code.host}:${code.port}/t/${code.sessionId}/")) { url }
        val json = Json.parseToJsonElement(body).jsonObject
        return when (route) {
            "hello" -> {
                val phonePub = Base64Url.decode(json["pub"]!!.jsonPrimitive.content)
                val proof = Base64Url.decode(json["proof"]!!.jsonPrimitive.content)
                if (!TransferCrypto.constantTimeEquals(proof, TransferCrypto.helloProof(code.secret, code.sessionId, phonePub))) return Transport.Reply(403, "{}")
                val shared = TransferCrypto.sharedSecret(TransferCrypto.privateFromBytes(tvPrivate), TransferCrypto.publicFromBytes(phonePub))
                val derived = TransferCrypto.deriveKeys(shared, code.secret, code.sessionId, code.tvPublicKey, phonePub)
                keys = derived
                val confirm = if (honest) TransferCrypto.tvReadyProof(derived, code.sessionId) else ByteArray(32)
                Transport.Reply(200, """{"confirm":"${Base64Url.encode(confirm)}","chunkBytes":1024}""")
            }
            "send" -> {
                if (statusForSend != 200) return Transport.Reply(statusForSend, "{}")
                val seq = json["seq"]!!.jsonPrimitive.content.toLong()
                if (seq != expected) return Transport.Reply(409, "{}")
                val plain = TransferCrypto.decrypt(keys!!.phoneToTv, code.sessionId, seq, Base64Url.decode(json["ct"]!!.jsonPrimitive.content))
                if (seq == 0L) header = Json.parseToJsonElement(String(plain)).jsonObject else received.write(plain)
                expected += 1
                Transport.Reply(200, """{"next":$expected}""")
            }
            "cancel" -> {
                cancelled = TransferCrypto.constantTimeEquals(Base64Url.decode(json["proof"]!!.jsonPrimitive.content), TransferCrypto.cancelProof(keys!!, code.sessionId))
                Transport.Reply(200, "{}")
            }
            else -> Transport.Reply(404, "{}")
        }
    }
}

class TvTransferClientTest {
    private val tvPriv = Base64Url.decode("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc")
    private val code = PairingCode.parse("musicfy://pair?v=1&h=192.168.1.20&p=45000&s=c2lkLWZvci10ZXN0cw&k=AAECAwQFBgcICQoLDA0ODw&t=BB4YUy_UdUwC8wQdnHXOszuD_9gax85P6ILMscmLxYlupGwxHE4v9A3ZajZT5uRURdMt_khuztdcepDGoYiBwKM&n=TV")

    @Test fun `pairs, then sends a header and chunks the TV can verify`() {
        val tv = FakeTv(code, tvPriv)
        val client = TvTransferClient(code, tv)
        val peer = client.connect()
        assertEquals(1024, peer.chunkBytes)
        val data = ByteArray(2500) { (it % 251).toByte() }
        val progress = mutableListOf<Long>()
        client.send(TransferKind.PORTABLE, data, "cadangan.musicfy.json", "Pixel 8", peer.chunkBytes) { sent, total -> progress += sent; assertEquals(2500L, total) }
        assertEquals(listOf("hello", "send", "send", "send", "send"), tv.log)
        assertArrayEquals(data, tv.received.toByteArray())
        val header = tv.header!!
        assertEquals("portable", header["kind"]!!.jsonPrimitive.content)
        assertEquals("3", header["chunks"]!!.jsonPrimitive.content)
        assertEquals("2500", header["size"]!!.jsonPrimitive.content)
        assertEquals(TransferCrypto.sha256Hex(data), header["sha256"]!!.jsonPrimitive.content)
        assertEquals("Pixel 8", header["device"]!!.jsonPrimitive.content)
        assertEquals(listOf(1024L, 2048L, 2500L), progress)
    }

    @Test fun `a TV that cannot prove it holds the secret gets nothing`() {
        val tv = FakeTv(code, tvPriv, honest = false)
        val client = TvTransferClient(code, tv)
        assertThrows(TransferException::class.java) { client.connect() }
        assertThrows(TransferException::class.java) { client.send(TransferKind.CSV, byteArrayOf(1), "a.csv", "Pixel") }
        assertEquals(listOf("hello"), tv.log)
    }

    @Test fun `a wrong code is refused with a clear message, and nothing is sent`() {
        val wrong = PairingCode(code.host, code.port, code.sessionId, ByteArray(16) { 9 }, code.tvPublicKey, "TV")
        val tv = FakeTv(code, tvPriv)
        val error = assertThrows(TransferException::class.java) { TvTransferClient(wrong, tv).connect() }
        assertEquals(403, error.status)
        assertTrue(error.message!!.contains("ditolak"))
    }

    @Test fun `sending before pairing, nothing, or too much is refused on the phone`() {
        val client = TvTransferClient(code, FakeTv(code, tvPriv))
        assertThrows(TransferException::class.java) { client.send(TransferKind.CSV, byteArrayOf(1), "a", "p") }
        client.connect()
        assertThrows(TransferException::class.java) { client.send(TransferKind.CSV, ByteArray(0), "a", "p") }
        assertThrows(TransferException::class.java) { client.send(TransferKind.CSV, ByteArray((10 * 1024 * 1024 + 1)), "a", "p") }
    }

    @Test fun `the TV ending the session shows as a message, not a crash`() {
        val tv = FakeTv(code, tvPriv)
        val client = TvTransferClient(code, tv)
        client.connect()
        tv.statusForSend = 410
        val error = assertThrows(TransferException::class.java) { client.send(TransferKind.CSV, byteArrayOf(1, 2, 3), "a", "p") }
        assertTrue(error.message!!.contains("berakhir"))
    }

    @Test fun `cancel sends a proof the TV accepts, and does nothing before pairing`() {
        val tv = FakeTv(code, tvPriv)
        val client = TvTransferClient(code, tv)
        client.cancel()
        assertTrue(tv.log.isEmpty())
        client.connect()
        client.cancel()
        assertTrue(tv.cancelled)
    }

    @Test fun `an account session goes as its own kind, is capped at 16 KiB, and the header says so`() {
        val tv = FakeTv(code, tvPriv)
        val client = TvTransferClient(code, tv)
        client.connect()
        val session = PortableBackupBuilder.appleSession("U".repeat(40), "eyJhbGciOiJFUzI1NiJ9.e30.c2ln")!!
        client.send(TransferKind.APPLE_SESSION, session, "applemusic-session", "Pixel 8")
        assertEquals("applemusic-session", tv.header!!["kind"]!!.jsonPrimitive.content)
        assertArrayEquals(session, tv.received.toByteArray())
        assertThrows(TransferException::class.java) { client.send(TransferKind.APPLE_SESSION, ByteArray(16 * 1024 + 1), "x", "p") }
    }
}
