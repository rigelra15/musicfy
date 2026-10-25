package com.example.musicfy.tvtransfer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingCodeTest {
    private val key = "AAECAwQFBgcICQoLDA0ODw"
    private val pub = "BB4YUy_UdUwC8wQdnHXOszuD_9gax85P6ILMscmLxYlupGwxHE4v9A3ZajZT5uRURdMt_khuztdcepDGoYiBwKM"
    private fun code(host: String = "192.168.1.20", extra: String = "") = "musicfy://pair?v=1&h=$host&p=45000&s=c2lkLWZvci10ZXN0cw&k=$key&t=$pub&n=Ruang%20Tamu$extra"

    @Test fun `reads what the TV shows`() {
        val parsed = PairingCode.parse(code())
        assertEquals("192.168.1.20", parsed.host)
        assertEquals(45000, parsed.port)
        assertEquals("c2lkLWZvci10ZXN0cw", parsed.sessionId)
        assertEquals(16, parsed.secret.size)
        assertEquals(65, parsed.tvPublicKey.size)
        assertEquals("Ruang Tamu", parsed.tvName)
    }

    @Test fun `only addresses on the home network are accepted`() {
        for (host in listOf("10.0.0.5", "172.16.0.1", "172.31.255.254", "192.168.0.1", "169.254.10.10")) assertTrue(host, PairingCode.isLocalAddress(host))
        for (host in listOf("8.8.8.8", "172.32.0.1", "172.15.0.1", "192.169.0.1", "example.com", "127.0.0.1", "192.168.1", "192.168.1.256", "192.168.01.1", "::1", "")) assertFalse(host, PairingCode.isLocalAddress(host))
        assertThrows(TransferException::class.java) { PairingCode.parse(code(host = "8.8.8.8")) }
        assertThrows(TransferException::class.java) { PairingCode.parse(code(host = "evil.example.com")) }
    }

    @Test fun `anything else is not a Musicfy TV code`() {
        for (text in listOf("", "https://example.com", "musicfy://pair?v=2&h=192.168.1.2", code().replace("p=45000", "p=80"), code().replace("k=$key", "k=AAAA"), code().replace("t=$pub", "t=AAAA"), code().replace("s=c2lkLWZvci10ZXN0cw", "s=../x")))
            assertThrows(text, TransferException::class.java) { PairingCode.parse(text) }
    }
}
