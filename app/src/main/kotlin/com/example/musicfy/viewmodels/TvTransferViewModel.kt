// TvTransferViewModel.kt

package com.example.musicfy.viewmodels

import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.example.musicfy.transfer.TvTransferRepository
import com.example.musicfy.tvtransfer.PairingCode
import com.example.musicfy.tvtransfer.PortableBackup
import com.example.musicfy.tvtransfer.PortableBackupBuilder
import com.example.musicfy.tvtransfer.TransferException
import com.example.musicfy.tvtransfer.TransferKind
import com.example.musicfy.tvtransfer.TvTransferClient
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import timber.log.Timber
import javax.inject.Inject

sealed interface TvTransferState {
    data object Intro : TvTransferState
    data object Scanning : TvTransferState
    data class Connecting(val tvName: String) : TvTransferState
    /** Paired and proven: the person picks what goes. The summary says what a full backup holds. */
    data class Ready(val tvName: String, val summary: PortableBackupBuilder.Summary, val choice: TransferKind, val appleAvailable: Boolean) : TvTransferState
    data class Sending(val tvName: String, val kind: TransferKind, val sent: Long, val total: Long) : TvTransferState
    data class Done(val tvName: String, val kind: TransferKind) : TvTransferState
    data class Failed(val message: String) : TvTransferState
}

/**
 * The phone's half of "Transfer to TV": scan the code, pair, show what will go, send one payload.
 * The pairing code is used once and never stored; nothing is written to the library or the settings.
 */
@HiltViewModel
class TvTransferViewModel @Inject constructor(
    private val repository: TvTransferRepository,
) : ViewModel() {
    private val _state = MutableStateFlow<TvTransferState>(TvTransferState.Intro)
    val state: StateFlow<TvTransferState> = _state.asStateFlow()

    private var client: TvTransferClient? = null
    private var backup: PortableBackup? = null
    private var chunkBytes = TvTransferClient.DEFAULT_CHUNK
    private var job: Job? = null

    fun startScanning() { if (_state.value is TvTransferState.Intro || _state.value is TvTransferState.Failed) _state.value = TvTransferState.Scanning }

    fun cameraDenied() { _state.value = TvTransferState.Failed("Allow the camera to scan the code on the TV, or turn it on in the app's settings.") }

    /** Called by the scanner for every code it reads; only the first one while scanning counts. */
    fun onCode(text: String) {
        if (_state.value !is TvTransferState.Scanning) return
        val code = try { PairingCode.parse(text) } catch (e: TransferException) { _state.value = TvTransferState.Failed(e.message ?: "That is not a Musicfy TV code."); return }
        val name = code.tvName.ifBlank { "your TV" }
        _state.value = TvTransferState.Connecting(name)
        job = viewModelScope.launch(Dispatchers.IO) {
            try {
                val built = repository.backup()
                val transfer = TvTransferClient(code)
                chunkBytes = transfer.connect().chunkBytes
                client = transfer
                backup = built
                _state.value = TvTransferState.Ready(name, PortableBackupBuilder.summarize(built), TransferKind.PORTABLE, repository.appleSession() != null)
            } catch (e: CancellationException) {
                throw e
            } catch (e: TransferException) {
                fail(e.message ?: "Could not reach the TV.")
            } catch (e: Exception) {
                Timber.tag("TvTransfer").e(e, "pairing failed")
                fail("Could not read your library or reach the TV.")
            }
        }
    }

    fun choose(kind: TransferKind) { (_state.value as? TvTransferState.Ready)?.let { if (kind != TransferKind.APPLE_SESSION || it.appleAvailable) _state.value = it.copy(choice = kind) } }

    fun send() {
        val ready = _state.value as? TvTransferState.Ready ?: return
        val transfer = client ?: return
        val kind = ready.choice
        _state.value = TvTransferState.Sending(ready.tvName, kind, 0, 1)
        job = viewModelScope.launch(Dispatchers.IO) {
            try {
                val bytes = when (kind) {
                    TransferKind.PORTABLE -> (backup ?: repository.backup()).encode().toByteArray(Charsets.UTF_8)
                    TransferKind.CSV -> repository.csv()
                    TransferKind.APPLE_SESSION -> repository.appleSession() ?: throw TransferException("Apple Music belum terhubung di HP ini.")
                }
                val name = when (kind) { TransferKind.PORTABLE -> "musicfy-android.musicfy.json"; TransferKind.CSV -> "musicfy-android.csv"; TransferKind.APPLE_SESSION -> "applemusic-session" }
                transfer.send(kind, bytes, name, Build.MODEL ?: "Phone", chunkBytes) { sent, total ->
                    _state.value = TvTransferState.Sending(ready.tvName, kind, sent, total)
                }
                _state.value = TvTransferState.Done(ready.tvName, kind)
                release()
            } catch (e: CancellationException) {
                throw e
            } catch (e: TransferException) {
                fail(e.message ?: "Sending stopped.")
            } catch (e: Exception) {
                Timber.tag("TvTransfer").e(e, "send failed")
                fail("Sending stopped. Start again from the TV.")
            }
        }
    }

    /** Stops whatever is happening, tells the TV to close its side, and goes back to the start. */
    fun cancel() {
        job?.cancel()
        job = null
        val active = client
        release()
        if (active != null) CoroutineScope(Dispatchers.IO).launch { active.cancel() }
        _state.value = TvTransferState.Intro
    }

    fun reset() { release(); _state.value = TvTransferState.Intro }

    /** Ends the session on both sides (the TV is told, best effort) and shows why. */
    private fun fail(message: String) {
        val active = client
        release()
        _state.value = TvTransferState.Failed(message)
        if (active != null) CoroutineScope(Dispatchers.IO).launch { active.cancel() }
    }

    private fun release() { client = null; backup = null }

    override fun onCleared() {
        val active = client
        job?.cancel()
        if (active != null && _state.value !is TvTransferState.Done) CoroutineScope(Dispatchers.IO).launch { active.cancel() }
        super.onCleared()
    }
}
