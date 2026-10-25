package com.example.musicfy.tvtransfer

import java.math.BigInteger
import java.nio.ByteBuffer
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPrivateKeySpec
import java.security.spec.ECPublicKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * The same construction as the TV's service/transfer.cjs, step for step: ECDH P-256, HKDF-SHA256
 * split into one key per direction, AES-256-GCM with the message number in the nonce and in the
 * authenticated data. Known-answer tests pin it to the TV's output.
 */
object TransferCrypto {
    private val curve: ECParameterSpec = AlgorithmParameters.getInstance("EC").run {
        init(ECGenParameterSpec("secp256r1"))
        getParameterSpec(ECParameterSpec::class.java)
    }

    class Keys(val phoneToTv: ByteArray, val tvToPhone: ByteArray)

    fun generateKeyPair(): KeyPair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()

    /** 65 bytes: 0x04 then X and Y, each 32 bytes. */
    fun publicBytes(key: ECPublicKey): ByteArray {
        fun fixed(value: BigInteger): ByteArray {
            val raw = value.toByteArray().let { if (it.size > 32) it.copyOfRange(it.size - 32, it.size) else it }
            return ByteArray(32 - raw.size) + raw
        }
        return byteArrayOf(4) + fixed(key.w.affineX) + fixed(key.w.affineY)
    }

    fun publicFromBytes(bytes: ByteArray): ECPublicKey {
        require(bytes.size == 65 && bytes[0] == 4.toByte()) { "not an uncompressed P-256 key" }
        val point = ECPoint(BigInteger(1, bytes.copyOfRange(1, 33)), BigInteger(1, bytes.copyOfRange(33, 65)))
        return KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(point, curve)) as ECPublicKey
    }

    /** Only for tests with fixed keys. */
    fun privateFromBytes(bytes: ByteArray): ECPrivateKey =
        KeyFactory.getInstance("EC").generatePrivate(ECPrivateKeySpec(BigInteger(1, bytes), curve)) as ECPrivateKey

    fun sharedSecret(own: ECPrivateKey, other: ECPublicKey): ByteArray =
        KeyAgreement.getInstance("ECDH").apply { init(own); doPhase(other, true) }.generateSecret()

    private fun hmac(key: ByteArray, vararg parts: ByteArray): ByteArray = Mac.getInstance("HmacSHA256").run {
        init(SecretKeySpec(key, "HmacSHA256"))
        parts.forEach { update(it) }
        doFinal()
    }

    /** RFC 5869 with SHA-256: `salt` is the pairing secret, `info` binds the session and both public keys. */
    fun deriveKeys(shared: ByteArray, secret: ByteArray, sessionId: String, tvPublic: ByteArray, phonePublic: ByteArray): Keys {
        val info = "musicfy-transfer-v1|$sessionId|".toByteArray() + tvPublic + phonePublic
        val prk = hmac(secret, shared)
        val t1 = hmac(prk, info, byteArrayOf(1))
        val t2 = hmac(prk, t1, info, byteArrayOf(2))
        return Keys(t1, t2)
    }

    /** Proves this phone read the QR code: it needs the secret that only the code carries. */
    fun helloProof(secret: ByteArray, sessionId: String, phonePublic: ByteArray): ByteArray =
        hmac(secret, "musicfy-hello|$sessionId|".toByteArray(), phonePublic)

    fun tvReadyProof(keys: Keys, sessionId: String): ByteArray = hmac(keys.tvToPhone, "musicfy-tv-ready|$sessionId".toByteArray())
    fun cancelProof(keys: Keys, sessionId: String): ByteArray = hmac(keys.phoneToTv, "musicfy-cancel|$sessionId".toByteArray())

    private fun nonce(seq: Long): ByteArray = ByteBuffer.allocate(12).putLong(seq).array()
    private fun aad(sessionId: String, seq: Long): ByteArray = "musicfy-msg|$sessionId|$seq".toByteArray()

    fun encrypt(key: ByteArray, sessionId: String, seq: Long, plain: ByteArray): ByteArray =
        Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce(seq)))
            updateAAD(aad(sessionId, seq))
            doFinal(plain)
        }

    fun decrypt(key: ByteArray, sessionId: String, seq: Long, data: ByteArray): ByteArray =
        Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce(seq)))
            updateAAD(aad(sessionId, seq))
            doFinal(data)
        }

    fun sha256Hex(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    fun constantTimeEquals(a: ByteArray, b: ByteArray): Boolean = MessageDigest.isEqual(a, b)
}
