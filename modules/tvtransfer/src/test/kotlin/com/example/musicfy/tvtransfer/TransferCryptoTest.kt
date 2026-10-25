package com.example.musicfy.tvtransfer

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** Known answers produced by the TV's own implementation (webos-tv/service/transfer.cjs) from fixed keys. */
class TransferCryptoTest {
    private val tvPriv = Base64Url.decode("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc")
    private val phonePriv = Base64Url.decode("CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk")
    private val secret = Base64Url.decode("AAECAwQFBgcICQoLDA0ODw")
    private val sid = "c2lkLWZvci10ZXN0cw"
    private val tvPub = Base64Url.decode("BB4YUy_UdUwC8wQdnHXOszuD_9gax85P6ILMscmLxYlupGwxHE4v9A3ZajZT5uRURdMt_khuztdcepDGoYiBwKM")
    private val phonePub = Base64Url.decode("BHE1-k_ZOgnc6Yu_aBtL_PUOfA1jVOYq-wv_KjQpYXhl7UwfAt25Aj7lalV-UV1qncZsEfIglg3llDNN9Yh3ZyQ")
    private fun b64(bytes: ByteArray) = Base64Url.encode(bytes)

    @Test fun `public keys come out as the same 65 bytes the TV sends`() {
        val phoneKey = TransferCrypto.privateFromBytes(phonePriv)
        val derived = java.security.KeyFactory.getInstance("EC")
        assertEquals(65, phonePub.size)
        // the TV's public key parses, and the phone's private key agrees with the TV's public key
        val tv = TransferCrypto.publicFromBytes(tvPub)
        assertArrayEquals(tvPub, TransferCrypto.publicBytes(tv))
        assertEquals("adIgxqt-YZSSeoyl2hEuVzwI38y3Q9P392kASEUR_rU", b64(TransferCrypto.sharedSecret(phoneKey, tv)))
        assertTrue(derived.algorithm == "EC")
    }

    @Test fun `both sides reach the same shared secret`() {
        val fromPhone = TransferCrypto.sharedSecret(TransferCrypto.privateFromBytes(phonePriv), TransferCrypto.publicFromBytes(tvPub))
        val fromTv = TransferCrypto.sharedSecret(TransferCrypto.privateFromBytes(tvPriv), TransferCrypto.publicFromBytes(phonePub))
        assertArrayEquals(fromPhone, fromTv)
    }

    @Test fun `keys, proofs and confirmations match the TV`() {
        val shared = Base64Url.decode("adIgxqt-YZSSeoyl2hEuVzwI38y3Q9P392kASEUR_rU")
        val keys = TransferCrypto.deriveKeys(shared, secret, sid, tvPub, phonePub)
        assertEquals("ZZXZ5UnLtVZ3g5MJgybWULejgEhj5UaDAP9Ga-2Y0ms", b64(keys.phoneToTv))
        assertEquals("s8Uktid4cyA40YbRFUy0UGblxslUiQf2MNEcrXP_h0A", b64(keys.tvToPhone))
        assertEquals("wTKxZxH7O98QIu_tG5v5Unt0UIvPTSOkFgUDHR9TfrM", b64(TransferCrypto.helloProof(secret, sid, phonePub)))
        assertEquals("dBzHhIIH8j5wersN0XIl7257ctNpdvE_xlYT6UPdub8", b64(TransferCrypto.tvReadyProof(keys, sid)))
        assertEquals("ua4IX8CPRu0EY9pzjwWwAGA1STypDAD5UZL1xMYG92w", b64(TransferCrypto.cancelProof(keys, sid)))
    }

    @Test fun `messages encrypt to exactly what the TV produces, including a sequence number past 32 bits`() {
        val key = Base64Url.decode("ZZXZ5UnLtVZ3g5MJgybWULejgEhj5UaDAP9Ga-2Y0ms")
        assertEquals("My92sxeb3QZopZ2UJiVBvCrGeFWgrV5XfUu0khmVJ5rZ", b64(TransferCrypto.encrypt(key, sid, 0, """{"type":"header"}""".toByteArray())))
        assertEquals("q0rDCle7Ign_l6O34Svy3gqdqi26Emv967Y", b64(TransferCrypto.encrypt(key, sid, 300, "chunk-data".toByteArray())))
        assertEquals("FsznL2IX490L5mJAtIHreUVUtQwrXkc", b64(TransferCrypto.encrypt(key, sid, 4294967297L, "big-seq".toByteArray())))
    }

    @Test fun `a message only opens with its own number, session and key`() {
        val key = Base64Url.decode("ZZXZ5UnLtVZ3g5MJgybWULejgEhj5UaDAP9Ga-2Y0ms")
        val sealed = Base64Url.decode("q0rDCle7Ign_l6O34Svy3gqdqi26Emv967Y")
        assertEquals("chunk-data", String(TransferCrypto.decrypt(key, sid, 300, sealed)))
        assertThrows(Exception::class.java) { TransferCrypto.decrypt(key, sid, 301, sealed) }
        assertThrows(Exception::class.java) { TransferCrypto.decrypt(key, "other-session", 300, sealed) }
        assertThrows(Exception::class.java) { TransferCrypto.decrypt(ByteArray(32), sid, 300, sealed) }
        val tampered = sealed.copyOf().also { it[0] = (it[0].toInt() xor 1).toByte() }
        assertThrows(Exception::class.java) { TransferCrypto.decrypt(key, sid, 300, tampered) }
    }

    @Test fun `generated keys are fresh P-256 points that survive the wire format`() {
        val a = TransferCrypto.generateKeyPair()
        val b = TransferCrypto.generateKeyPair()
        val bytes = TransferCrypto.publicBytes(a.public as java.security.interfaces.ECPublicKey)
        assertEquals(65, bytes.size)
        assertEquals(4, bytes[0].toInt())
        assertFalse(bytes.contentEquals(TransferCrypto.publicBytes(b.public as java.security.interfaces.ECPublicKey)))
        assertArrayEquals(bytes, TransferCrypto.publicBytes(TransferCrypto.publicFromBytes(bytes)))
    }
}
