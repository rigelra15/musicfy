package com.example.musicfy.tvtransfer

import java.net.URLDecoder

/** What the TV's QR code says: where to connect, the one-time session, and the secret that proves this phone saw the code. */
class PairingCode(
    val host: String,
    val port: Int,
    val sessionId: String,
    val secret: ByteArray,
    val tvPublicKey: ByteArray,
    val tvName: String,
) {
    companion object {
        /**
         * Reads `musicfy://pair?v=1&h=…&p=…&s=…&k=…&t=…&n=…`. A code that points anywhere but the local
         * network is refused, so a crafted code cannot make the phone send a collection to the internet.
         */
        fun parse(text: String): PairingCode {
            val trimmed = text.trim()
            if (!trimmed.startsWith("musicfy://pair?")) throw TransferException("Ini bukan kode Musicfy TV.")
            val params = trimmed.substringAfter('?').split('&').filter { it.isNotEmpty() }.associate {
                val key = it.substringBefore('=')
                key to URLDecoder.decode(it.substringAfter('=', ""), "UTF-8")
            }
            if (params["v"] != "1") throw TransferException("Kode ini dari versi Musicfy yang berbeda. Perbarui aplikasi di HP dan TV.")
            val host = params["h"].orEmpty()
            if (!isLocalAddress(host)) throw TransferException("Kode ini menunjuk ke luar jaringan rumah, jadi ditolak.")
            val port = params["p"]?.toIntOrNull()?.takeIf { it in 1024..65535 } ?: throw TransferException("Kode tidak valid.")
            val sid = params["s"]?.takeIf { Regex("[A-Za-z0-9_-]{8,40}").matches(it) } ?: throw TransferException("Kode tidak valid.")
            val secret = decode(params["k"]).takeIf { it.size == 16 } ?: throw TransferException("Kode tidak valid.")
            val tvKey = decode(params["t"]).takeIf { it.size == 65 && it[0] == 4.toByte() } ?: throw TransferException("Kode tidak valid.")
            return PairingCode(host, port, sid, secret, tvKey, params["n"].orEmpty().take(40))
        }

        private fun decode(value: String?): ByteArray = try {
            Base64Url.decode(value ?: "")
        } catch (e: IllegalArgumentException) {
            ByteArray(0)
        }

        /** Private IPv4 ranges and link-local only: 10/8, 172.16/12, 192.168/16, 169.254/16. */
        fun isLocalAddress(host: String): Boolean {
            val parts = host.split('.')
            if (parts.size != 4) return false
            val n = parts.map { it.toIntOrNull()?.takeIf { v -> v in 0..255 && it == v.toString() } ?: return false }
            return n[0] == 10 || (n[0] == 172 && n[1] in 16..31) || (n[0] == 192 && n[1] == 168) || (n[0] == 169 && n[1] == 254)
        }
    }
}

class TransferException(message: String, val status: Int = 0) : Exception(message)
