package com.example.musicfy.tvtransfer

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyPair
import java.security.interfaces.ECPrivateKey

enum class TransferKind(val wire: String, val maxBytes: Long) {
    CSV("csv", 10L * 1024 * 1024),
    PORTABLE("portable", 64L * 1024 * 1024),
    /** An account session (Apple Music). The TV keeps it inside its own service and never shows it to its screen. */
    APPLE_SESSION("applemusic-session", 16L * 1024),
}

/** One HTTP POST with a JSON body. Swappable so the flow is tested without a network. */
fun interface Transport {
    fun post(url: String, body: String): Reply
    class Reply(val status: Int, val body: String)
}

/** `HttpURLConnection` with short timeouts, to the TV's address only (the code was checked to be local). */
object HttpTransport : Transport {
    override fun post(url: String, body: String): Transport.Reply {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 5_000
            connection.readTimeout = 30_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body.toByteArray()) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            return Transport.Reply(status, stream?.bufferedReader()?.use { it.readText() }.orEmpty())
        } catch (e: IOException) {
            throw TransferException("HP tidak bisa menghubungi TV. Pastikan keduanya di jaringan Wi-Fi yang sama.")
        } finally {
            connection.disconnect()
        }
    }
}

/**
 * The phone's side of a transfer: pair with the code the TV shows, then send one payload (a portable
 * backup or a CSV) as numbered, encrypted messages. Nothing leaves the local network, and nothing is
 * sent before the TV has proven it holds the pairing secret.
 */
class TvTransferClient(
    private val code: PairingCode,
    private val transport: Transport = HttpTransport,
    private val keyPair: () -> KeyPair = TransferCrypto::generateKeyPair,
) {
    private var keys: TransferCrypto.Keys? = null
    private var seq = 0L
    private val base get() = "http://${code.host}:${code.port}/t/${code.sessionId}"
    private val json = Json

    class Peer(val chunkBytes: Int)

    /** Pairs with the TV. Throws if the TV does not answer, refuses, or cannot prove it knows the secret. */
    fun connect(): Peer {
        val pair = keyPair()
        val phonePublic = TransferCrypto.publicBytes(pair.public as java.security.interfaces.ECPublicKey)
        val body = buildJsonObject {
            put("pub", Base64Url.encode(phonePublic))
            put("proof", Base64Url.encode(TransferCrypto.helloProof(code.secret, code.sessionId, phonePublic)))
        }
        val reply = post("hello", body)
        if (reply.status != 200) throw refusal(reply)
        val shared = TransferCrypto.sharedSecret(pair.private as ECPrivateKey, TransferCrypto.publicFromBytes(code.tvPublicKey))
        val derived = TransferCrypto.deriveKeys(shared, code.secret, code.sessionId, code.tvPublicKey, phonePublic)
        shared.fill(0)
        val confirm = reply.json()["confirm"]?.jsonPrimitive?.contentOrNull
        val expected = TransferCrypto.tvReadyProof(derived, code.sessionId)
        if (confirm == null || !TransferCrypto.constantTimeEquals(runCatching { Base64Url.decode(confirm) }.getOrDefault(ByteArray(0)), expected)) {
            throw TransferException("Perangkat ini tidak bisa membuktikan bahwa ini TV kamu. Pengiriman dihentikan.")
        }
        keys = derived
        seq = 0
        return Peer(reply.json()["chunkBytes"]?.jsonPrimitive?.intOrNull?.takeIf { it in 1024..(1024 * 1024) } ?: DEFAULT_CHUNK)
    }

    /** Sends `data` as `kind`. `onProgress(sent, total)` counts payload bytes the TV has accepted. */
    fun send(kind: TransferKind, data: ByteArray, name: String, deviceName: String, chunkBytes: Int = DEFAULT_CHUNK, onProgress: (Long, Long) -> Unit = { _, _ -> }) {
        val active = keys ?: throw TransferException("Belum terhubung ke TV.")
        if (data.isEmpty()) throw TransferException("Tidak ada data untuk dikirim.")
        if (data.size > kind.maxBytes) throw TransferException("Data terlalu besar untuk dikirim (maksimal ${kind.maxBytes / (1024 * 1024)} MiB).")
        val chunks = (data.size + chunkBytes - 1) / chunkBytes
        val header = buildJsonObject {
            put("type", "header"); put("kind", kind.wire); put("name", name.take(120)); put("device", deviceName.take(80))
            put("size", data.size); put("chunks", chunks); put("sha256", TransferCrypto.sha256Hex(data))
        }
        message(active, header.toString().toByteArray())
        var sent = 0L
        for (offset in data.indices step chunkBytes) {
            val part = data.copyOfRange(offset, minOf(data.size, offset + chunkBytes))
            message(active, part)
            sent += part.size
            onProgress(sent, data.size.toLong())
        }
    }

    /** Tells the TV to stop. Best effort: the TV also stops by itself when the session ends. */
    fun cancel() {
        val active = keys ?: return
        runCatching { post("cancel", buildJsonObject { put("proof", Base64Url.encode(TransferCrypto.cancelProof(active, code.sessionId))) }) }
    }

    private fun message(active: TransferCrypto.Keys, plain: ByteArray) {
        val number = seq
        val body = buildJsonObject {
            put("seq", number)
            put("ct", Base64Url.encode(TransferCrypto.encrypt(active.phoneToTv, code.sessionId, number, plain)))
        }
        val reply = post("send", body)
        if (reply.status != 200) throw refusal(reply)
        seq += 1
    }

    private fun post(route: String, body: JsonObject): Transport.Reply = transport.post("$base/$route", body.toString())

    private fun Transport.Reply.json(): JsonObject = runCatching { json.parseToJsonElement(body).jsonObject }.getOrDefault(JsonObject(emptyMap()))

    private fun refusal(reply: Transport.Reply): TransferException {
        val message = when (reply.status) {
            403 -> "Kode ditolak oleh TV. Pindai kode QR yang baru."
            404, 410 -> "Sambungan di TV sudah berakhir. Mulai lagi dari TV."
            409 -> "TV sudah terhubung ke perangkat lain atau urutan data salah."
            413 -> "TV menolak data karena terlalu besar."
            422 -> "Data rusak di perjalanan."
            else -> "TV menolak pengiriman (${reply.status})."
        }
        return TransferException(message, reply.status)
    }

    companion object { const val DEFAULT_CHUNK = 256 * 1024 }
}

