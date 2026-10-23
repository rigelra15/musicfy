// CastConnectionHandler.kt

package com.example.musicfy.playback

import android.content.Context
import android.net.Uri
import androidx.compose.runtime.Stable
import androidx.media3.common.Player
import androidx.mediarouter.media.MediaRouteSelector
import androidx.mediarouter.media.MediaRouter
import com.google.android.gms.cast.CastMediaControlIntent
import com.google.android.gms.cast.Cast
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaLoadRequestData
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.MediaQueueItem
import com.google.android.gms.cast.MediaSeekOptions
import com.google.android.gms.cast.MediaStatus
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.SessionManager
import com.google.android.gms.cast.framework.SessionManagerListener
import com.google.android.gms.cast.framework.media.RemoteMediaClient
import com.google.android.gms.common.images.WebImage
import com.example.musicfy.extensions.metadata
import com.example.musicfy.cast.CastOptionsProvider
import com.example.musicfy.models.MediaMetadata as AppMediaMetadata
import com.example.musicfy.ui.utils.resize
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONArray
import org.json.JSONObject
import com.example.musicfy.lyrics.LyricsUtils
import timber.log.Timber

@Stable
class CastConnectionHandler(
    private val context: Context,
    private val scope: CoroutineScope,
    private val musicService: MusicService
) {
    private var castContext: CastContext? = null
    private var sessionManager: SessionManager? = null
    private var mediaRouter: MediaRouter? = null
    private var routeSelector: MediaRouteSelector? = null
    private var remoteMediaClient: RemoteMediaClient? = null
    private var castSession: CastSession? = null

    private val _isCasting = MutableStateFlow(false)
    val isCasting: StateFlow<Boolean> = _isCasting.asStateFlow()

    private val _isConnecting = MutableStateFlow(false)
    val isConnecting: StateFlow<Boolean> = _isConnecting.asStateFlow()

    private val _castDeviceName = MutableStateFlow<String?>(null)
    val castDeviceName: StateFlow<String?> = _castDeviceName.asStateFlow()

    private val _castPosition = MutableStateFlow(0L)
    val castPosition: StateFlow<Long> = _castPosition.asStateFlow()

    private val _castDuration = MutableStateFlow(0L)
    val castDuration: StateFlow<Long> = _castDuration.asStateFlow()

    private val _castIsPlaying = MutableStateFlow(false)
    val castIsPlaying: StateFlow<Boolean> = _castIsPlaying.asStateFlow()

    private val _castIsBuffering = MutableStateFlow(false)
    val castIsBuffering: StateFlow<Boolean> = _castIsBuffering.asStateFlow()

    private val _castVolume = MutableStateFlow(1.0f)
    val castVolume: StateFlow<Float> = _castVolume.asStateFlow()

    private val _receiverReady = MutableStateFlow(false)
    val receiverReady: StateFlow<Boolean> = _receiverReady.asStateFlow()

    private val _receiverViewMode = MutableStateFlow("player")
    val receiverViewMode: StateFlow<String> = _receiverViewMode.asStateFlow()

    private var positionUpdateJob: Job? = null
    private var currentMediaId: String? = null
    private var currentQueueEntryId: String? = null
    private var activeRemoteMediaId: String? = null
    private var activeRemoteQueueEntryId: String? = null
    private var pendingCastLoad: PendingCastQueueLoad? = null
    private var lastCastItemId: Int = -1
    private var isAppendingCastQueue: Boolean = false
    private var isRebuildingCastQueue: Boolean = false
    private var isLoadingCastQueue: Boolean = false
    private val isReloadingQueue: Boolean
        get() = isAppendingCastQueue || isRebuildingCastQueue || isLoadingCastQueue
    private var pauseLocalAfterCastLoad = false
    private var isReceiverReady = false
    private val senderSessionId = UUID.randomUUID().toString()
    private val lyricRevision = AtomicInteger(0)
    private var castLoadGeneration = 0L
    private var castLoadJob: Job? = null
    private var snapshotGeneration = 0L
    private var scheduledSnapshotGeneration = -1L
    private var snapshotSendJob: Job? = null
    private val lyricSendMutex = Mutex()
    private val pendingAcks = ConcurrentHashMap<String, CompletableDeferred<Unit>>()
    private val customNamespace = "urn:x-cast:com.musicfy.tv.v1"
    private val castMessageCallback = object : Cast.MessageReceivedCallback {
        override fun onMessageReceived(device: com.google.android.gms.cast.CastDevice, namespace: String, message: String) {
            val parsed = runCatching { JSONObject(message) }.getOrNull() ?: return
            when (parsed.optString("type")) {
                "READY" -> {
                    if (parsed.optString("senderSessionId") != senderSessionId) return
                    isReceiverReady = true
                    _receiverReady.value = true
                    requestCurrentSnapshot()
                }
                "ACK" -> {
                    if (parsed.optString("senderSessionId") != senderSessionId) return
                    val data = parsed.optJSONObject("data") ?: return
                    val key = "${data.optString("transferId")}:${data.optInt("index", -1)}"
                    pendingAcks.remove(key)?.complete(Unit)
                }
            }
        }
    }

    var isSyncingFromCast: Boolean = false
        private set

    private val remoteMediaClientCallback = object : RemoteMediaClient.Callback() {
        override fun onStatusUpdated() {
            remoteMediaClient?.let { client ->
                val mediaStatus = client.mediaStatus
                val playerState = mediaStatus?.playerState

                _castIsPlaying.value = playerState == MediaStatus.PLAYER_STATE_PLAYING ||
                                       playerState == MediaStatus.PLAYER_STATE_BUFFERING ||
                                       playerState == MediaStatus.PLAYER_STATE_LOADING
                _castIsBuffering.value = playerState == MediaStatus.PLAYER_STATE_BUFFERING ||
                                         playerState == MediaStatus.PLAYER_STATE_LOADING
                _castDuration.value = client.streamDuration

                val activeItem = mediaStatus?.queueItems?.firstOrNull { it.itemId == mediaStatus.currentItemId }
                val activeCustomData = activeItem?.media?.customData
                val activeMediaId = activeCustomData?.optString("mediaId")?.takeIf { it.isNotBlank() && it != "null" }
                val activeQueueEntryId = activeCustomData?.optString("queueEntryId")
                    ?.takeIf { it.isNotBlank() && it != "null" }
                    ?: activeMediaId
                activeRemoteMediaId = activeMediaId
                activeRemoteQueueEntryId = activeQueueEntryId
                if (pauseLocalAfterCastLoad && activeMediaId == currentMediaId &&
                    activeQueueEntryId == currentQueueEntryId &&
                    playerState in setOf(
                        MediaStatus.PLAYER_STATE_BUFFERING,
                        MediaStatus.PLAYER_STATE_PLAYING,
                        MediaStatus.PLAYER_STATE_PAUSED
                    )) {
                    musicService.player.pause()
                    pauseLocalAfterCastLoad = false
                }

                mediaStatus?.let(::reconcileCastItemStatus)
                requestCurrentSnapshot()

                val currentItemId = mediaStatus?.currentItemId ?: -1
                Timber.d("Cast status updated: playing=${_castIsPlaying.value}, buffering=${_castIsBuffering.value}, itemId=$currentItemId")
            }
        }

        override fun onMediaError(error: com.google.android.gms.cast.MediaError) {
            pauseLocalAfterCastLoad = false
            Timber.e("Cast media error: ${error.reason}")
        }

        override fun onQueueStatusUpdated() {
            Timber.d("Cast queue status updated")
        }
    }

    private var syncResetJob: Job? = null

    private fun reconcileCastItemStatus(mediaStatus: MediaStatus) {
        val currentItemId = mediaStatus.currentItemId
        if (currentItemId == -1) return

        val activeItem = mediaStatus.queueItems.firstOrNull { it.itemId == currentItemId } ?: return
        val customData = activeItem.media?.customData ?: return
        val mediaId = customData.optString("mediaId")
            .takeIf { it.isNotBlank() && it != "null" }
            ?: return
        val queueEntryId = customData.optString("queueEntryId")
            .takeIf { it.isNotBlank() && it != "null" }
            ?: mediaId
        activeRemoteMediaId = mediaId
        activeRemoteQueueEntryId = queueEntryId

        if (!shouldReconcileCastQueueStatus(isReloadingQueue, pendingCastLoad, currentItemId, queueEntryId)) {
            Timber.d("Deferring Cast item reconciliation while queue work is pending: $queueEntryId")
            return
        }

        if (pendingCastLoad != null && pendingCastLoad?.requestAccepted == true) pendingCastLoad = null

        val identityMatchesCurrent = mediaId == currentMediaId && queueEntryId == currentQueueEntryId
        if (currentItemId != lastCastItemId || !identityMatchesCurrent) {
            Timber.d("Cast item changed or identity needs bootstrap: $lastCastItemId -> $currentItemId")
            handleCastItemChanged(mediaStatus)
        }
        lastCastItemId = currentItemId
    }

    private fun handleCastItemChanged(mediaStatus: MediaStatus) {
        val queueItems = mediaStatus.queueItems
        if (queueItems.isEmpty()) return
        val currentItemId = mediaStatus.currentItemId
        val currentIndex = queueItems.indexOfFirst { it.itemId == currentItemId }

        if (currentIndex < 0) return

        val currentQueueItem = queueItems[currentIndex]
        val customData = currentQueueItem.media?.customData
        val castMediaId = customData?.optString("mediaId")?.takeIf { it.isNotBlank() && it != "null" }
        val queueEntryId = customData?.optString("queueEntryId")
            ?.takeIf(String::isNotBlank)
            ?: castMediaId

        Timber.d("Cast switched to item: index=$currentIndex, mediaId=$castMediaId, queueSize=${queueItems.size}")

        if (castMediaId != null && queueEntryId != null) {
            val mediaChanged = castMediaId != currentMediaId
            val queueEntryChanged = queueEntryId != currentQueueEntryId
            val identityChanged = mediaChanged || queueEntryChanged
            if (identityChanged) {
                currentMediaId = castMediaId
                currentQueueEntryId = queueEntryId
                invalidateSnapshot()
                syncResetJob?.cancel()
                isSyncingFromCast = true
            }

            val player = musicService.player
            val playerItemCount = player.mediaItemCount

            val localMediaIds = (0 until playerItemCount).map { player.getMediaItemAt(it).mediaId }
            val localIndex = resolveCastQueueEntryIndex(queueEntryId, castMediaId, localMediaIds)
            if (localIndex != null) {
                val mediaItem = player.getMediaItemAt(localIndex)
                if (identityChanged) {
                    Timber.d("Syncing local player to index $localIndex (mediaId=$castMediaId, queueEntryId=$queueEntryId)")
                    player.pause()
                    player.seekTo(localIndex, 0)
                    player.pause()
                }

                if (shouldExtendCastQueue(queueItems.size, currentIndex)) {
                    scope.launch {
                        if (mediaItem.metadata != null) extendQueueIfNeeded(playerItemCount, queueItems)
                    }
                }
            } else {
                Timber.w("Cast queue entry $queueEntryId has no unambiguous local media item")
            }

            if (identityChanged) {
                syncResetJob = scope.launch {
                    delay(300)
                    isSyncingFromCast = false
                    requestCurrentSnapshot()
                }
            }
        }
    }

    private suspend fun extendQueueIfNeeded(playerItemCount: Int, currentCastQueue: List<MediaQueueItem>) {
        if (isReloadingQueue) return

        val client = remoteMediaClient ?: return
        val expectedMediaId = currentMediaId ?: return
        val expectedQueueEntryId = currentQueueEntryId ?: expectedMediaId
        val localItems = (0 until minOf(playerItemCount, musicService.player.mediaItemCount))
            .map(musicService.player::getMediaItemAt)
        val localMediaIds = localItems.map { it.mediaId }
        val exactCurrentCastIndex = currentCastQueue.indexOfFirst {
            it.media?.customData?.optString("queueEntryId") == expectedQueueEntryId
        }
        val currentCastHasEntryIds = currentCastQueue.any {
            !it.media?.customData?.optString("queueEntryId").isNullOrBlank()
        }
        val currentCastIndex = exactCurrentCastIndex.takeIf { it >= 0 } ?: if (currentCastHasEntryIds) -1 else {
            currentCastQueue.indexOfFirst { it.media?.customData?.optString("mediaId") == expectedMediaId }
        }
        if (currentCastIndex < 0) return

        isAppendingCastQueue = true

        try {

            val itemsAhead = currentCastQueue.size - 1 - currentCastIndex
            if (itemsAhead < 2) {

                val lastCastItem = currentCastQueue.lastOrNull()
                val lastMediaId = lastCastItem?.media?.customData?.optString("mediaId")
                val lastQueueEntryId = lastCastItem?.media?.customData?.optString("queueEntryId")
                val lastLocalIndex = if (lastMediaId.isNullOrBlank() || lastMediaId == "null") null else {
                    resolveCastQueueEntryIndex(lastQueueEntryId, lastMediaId, localMediaIds)
                }

                if (lastLocalIndex != null) {
                    val itemsToAdd = mutableListOf<MediaQueueItem>()
                    val player = musicService.player
                    val timeline = player.currentTimeline
                    val shuffleEnabled = player.shuffleModeEnabled
                    val nextIndices = collectCastQueueIndices(
                        startIndex = lastLocalIndex,
                        itemCount = localItems.size,
                        maxCount = 2,
                    ) { currentIndex ->
                        if (timeline.isEmpty) {
                            (currentIndex + 1).takeIf { it < localItems.size }
                        } else {
                            timeline.getNextWindowIndex(currentIndex, Player.REPEAT_MODE_OFF, shuffleEnabled)
                                .takeIf { it != androidx.media3.common.C.INDEX_UNSET }
                        }
                    }

                    for (nextIndex in nextIndices) {
                        val nextItem = localItems[nextIndex]
                        nextItem.metadata?.let { metadata ->
                            buildMediaInfo(metadata, castQueueEntryId(nextIndex, metadata.id))?.let { mediaInfo ->
                                itemsToAdd.add(MediaQueueItem.Builder(mediaInfo).build())
                            }
                        }
                    }

                    if (itemsToAdd.isNotEmpty()) {
                        Timber.d("Appending ${itemsToAdd.size} items to Cast queue")
                        withContext(Dispatchers.Main) {
                            val status = client.mediaStatus
                            val activeItem = status?.queueItems?.firstOrNull { it.itemId == status.currentItemId }
                            val activeData = activeItem?.media?.customData
                            if (client === remoteMediaClient && currentMediaId == expectedMediaId &&
                                currentQueueEntryId == expectedQueueEntryId &&
                                activeData?.optString("mediaId") == expectedMediaId &&
                                activeData.optString("queueEntryId") == expectedQueueEntryId) {
                                itemsToAdd.forEach { client.queueAppendItem(it, null) }
                            }
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Timber.e(e, "Failed to extend Cast queue")
        } finally {
            try {
                delay(500)
            } finally {
                isAppendingCastQueue = false
                remoteMediaClient?.mediaStatus?.let(::reconcileCastItemStatus)
            }
        }
    }

    private fun reloadQueueForCurrentItem(metadata: AppMediaMetadata) {
        if (!_isCasting.value || isReloadingQueue) return

        isRebuildingCastQueue = true
        scope.launch {
            try {
                val player = musicService.player
                val currentIndex = player.currentMediaItemIndex
                val shuffleEnabled = player.shuffleModeEnabled
                val timeline = player.currentTimeline

                val queueItems = mutableListOf<MediaQueueItem>()

                val prevItems = mutableListOf<Pair<Int, androidx.media3.common.MediaItem>>()
                if (!timeline.isEmpty) {
                    var prevIdx = currentIndex
                    for (i in 0 until 2) {
                        prevIdx = timeline.getPreviousWindowIndex(prevIdx, Player.REPEAT_MODE_OFF, shuffleEnabled)
                        if (prevIdx == androidx.media3.common.C.INDEX_UNSET) break
                        prevItems.add(0, prevIdx to player.getMediaItemAt(prevIdx))
                    }
                }

                for ((sourceIndex, prevItem) in prevItems) {
                    prevItem.metadata?.let { prevMetadata ->
                        buildMediaInfo(prevMetadata, castQueueEntryId(sourceIndex, prevMetadata.id))?.let { mediaInfo ->
                            queueItems.add(MediaQueueItem.Builder(mediaInfo).build())
                        }
                    }
                }
                val startIndex = queueItems.size

                val queueEntryId = castQueueEntryId(currentIndex, metadata.id)
                currentQueueEntryId = queueEntryId
                val currentMediaInfo = buildMediaInfo(metadata, queueEntryId)
                if (currentMediaInfo != null) {
                    queueItems.add(MediaQueueItem.Builder(currentMediaInfo).build())
                }

                if (!timeline.isEmpty) {
                    var nextIdx = currentIndex
                    for (i in 0 until 2) {
                        nextIdx = timeline.getNextWindowIndex(nextIdx, Player.REPEAT_MODE_OFF, shuffleEnabled)
                        if (nextIdx == androidx.media3.common.C.INDEX_UNSET) break
                        val nextItem = player.getMediaItemAt(nextIdx)
                        nextItem.metadata?.let { nextMetadata ->
                            buildMediaInfo(nextMetadata, castQueueEntryId(nextIdx, nextMetadata.id))?.let { mediaInfo ->
                                queueItems.add(MediaQueueItem.Builder(mediaInfo).build())
                            }
                        }
                    }
                }

                if (queueItems.isNotEmpty()) {
                    Timber.d("Reloading Cast queue: ${queueItems.size} items, startIndex=$startIndex, shuffle=$shuffleEnabled")

                    withContext(Dispatchers.Main) {
                        remoteMediaClient?.queueLoad(
                            queueItems.toTypedArray(),
                            startIndex,
                            MediaStatus.REPEAT_MODE_REPEAT_OFF,
                            0L,
                            org.json.JSONObject()
                        )
                    }
                }
            } catch (e: Exception) {
                Timber.e(e, "Failed to reload Cast queue")
            } finally {

                delay(1000)
                isRebuildingCastQueue = false
            }
        }
    }

    private val sessionManagerListener = object : SessionManagerListener<CastSession> {
        override fun onSessionStarting(session: CastSession) {
            Timber.d("Cast session starting")
            _isConnecting.value = true
        }

        override fun onSessionStarted(session: CastSession, sessionId: String) {
            Timber.d("Cast session started: $sessionId")
            _isCasting.value = true
            _isConnecting.value = false
            _castDeviceName.value = session.castDevice?.friendlyName
            castSession = session
            remoteMediaClient = session.remoteMediaClient
            remoteMediaClient?.registerCallback(remoteMediaClientCallback)

            _castVolume.value = session.volume.toFloat()
            registerCustomChannel(session)

            startPositionUpdates()

            loadCurrentMedia()
        }

        override fun onSessionStartFailed(session: CastSession, error: Int) {
            Timber.e("Cast session start failed: $error")
            _isCasting.value = false
            _isConnecting.value = false
            isReceiverReady = false
            _receiverReady.value = false
            pauseLocalAfterCastLoad = false
        }

        override fun onSessionEnding(session: CastSession) {
            Timber.d("Cast session ending")

            val castPosition = remoteMediaClient?.approximateStreamPosition ?: _castPosition.value
            if (castPosition > 0) {

                musicService.player.seekTo(castPosition)
                Timber.d("Saved Cast position: $castPosition")
            }
        }

        override fun onSessionEnded(session: CastSession, error: Int) {
            Timber.d("Cast session ended: error=$error")
            _isCasting.value = false
            _isConnecting.value = false
            _castDeviceName.value = null
            castSession = null
            isReceiverReady = false
            pauseLocalAfterCastLoad = false
            castLoadGeneration++
            castLoadJob?.cancel()
            isLoadingCastQueue = false
            activeRemoteMediaId = null
            activeRemoteQueueEntryId = null
            pendingCastLoad = null
            invalidateSnapshot()
            _receiverReady.value = false
            _receiverViewMode.value = "player"
            currentMediaId = null
            currentQueueEntryId = null
            pendingAcks.values.forEach { it.cancel() }
            pendingAcks.clear()
            runCatching { session.removeMessageReceivedCallbacks(customNamespace) }

            remoteMediaClient?.unregisterCallback(remoteMediaClientCallback)
            remoteMediaClient = null

            stopPositionUpdates()

            musicService.player.pause()
        }

        override fun onSessionResuming(session: CastSession, sessionId: String) {
            _isConnecting.value = true
        }

        override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) {
            _isCasting.value = true
            _isConnecting.value = false
            _castDeviceName.value = session.castDevice?.friendlyName

            remoteMediaClient = session.remoteMediaClient
            remoteMediaClient?.registerCallback(remoteMediaClientCallback)
            castSession = session
            reconcileRemoteIdentityFromStatus()
            registerCustomChannel(session)

            startPositionUpdates()
        }

        override fun onSessionResumeFailed(session: CastSession, error: Int) {
            _isConnecting.value = false
        }

        override fun onSessionSuspended(session: CastSession, reason: Int) {}
    }

    fun initialize(): Boolean {
        return try {
            castContext = CastContext.getSharedInstance(context)
            sessionManager = castContext?.sessionManager
            mediaRouter = MediaRouter.getInstance(context)
            routeSelector = MediaRouteSelector.Builder()
                .addControlCategory(CastMediaControlIntent.categoryForCast(CastOptionsProvider.receiverApplicationId()))
                .build()

            sessionManager?.addSessionManagerListener(sessionManagerListener, CastSession::class.java)

            sessionManager?.currentCastSession?.let { session ->
                _isCasting.value = true
                _castDeviceName.value = session.castDevice?.friendlyName
                remoteMediaClient = session.remoteMediaClient
                remoteMediaClient?.registerCallback(remoteMediaClientCallback)
                castSession = session
                reconcileRemoteIdentityFromStatus()
                registerCustomChannel(session)
                startPositionUpdates()
            }

            true
        } catch (e: Exception) {
            Timber.e(e, "Failed to initialize Cast")
            false
        }
    }

    fun getAvailableRoutes(): List<MediaRouter.RouteInfo> {
        val router = mediaRouter ?: return emptyList()
        val selector = routeSelector ?: return emptyList()

        return router.routes.filter { route ->
            route.matchesSelector(selector) && !route.isDefault
        }
    }

    fun connectToRoute(route: MediaRouter.RouteInfo) {

        if (mediaRouter == null) {
            initialize()
        }
        _isConnecting.value = true
        mediaRouter?.selectRoute(route)
    }

    fun disconnect() {
        sessionManager?.endCurrentSession(true)
    }

    private fun registerCustomChannel(session: CastSession) {
        try {
            isReceiverReady = false
            _receiverReady.value = false
            invalidateSnapshot()
            session.setMessageReceivedCallbacks(customNamespace, castMessageCallback)
            session.sendMessage(customNamespace, JSONObject()
                .put("version", 1)
                .put("type", "HELLO")
                .put("requestId", UUID.randomUUID().toString())
            .put("senderSessionId", senderSessionId)
                .put("mediaId", "")
                .put("queueEntryId", "")
                .put("revision", 0)
                .put("data", JSONObject())
                .toString())
        } catch (e: Exception) {
            Timber.e(e, "Failed to register Musicfy Cast channel")
        }
    }

    private fun reconcileRemoteIdentityFromStatus() {
        remoteMediaClient?.mediaStatus?.let(::reconcileCastItemStatus)
    }

    fun setReceiverViewMode(mode: String) {
        if (!isReceiverReady || mode !in setOf("player", "lyrics", "artwork")) return
        _receiverViewMode.value = mode
        val mediaId = currentMediaId ?: musicService.currentMediaMetadata.value?.id ?: return
        sendEnvelope("SET_VIEW_MODE", mediaId, currentQueueEntryId ?: mediaId, lyricRevision.get(), JSONObject().put("mode", mode))
    }

    private fun sendEnvelope(type: String, mediaId: String, queueEntryId: String, revision: Int, data: JSONObject) {
        if (!isReceiverReady) return
        val session = castSession ?: return
        scope.launch {
            val envelope = JSONObject()
                .put("version", 1)
                .put("type", type)
                .put("requestId", UUID.randomUUID().toString())
                .put("senderSessionId", senderSessionId)
                .put("mediaId", mediaId)
                .put("queueEntryId", queueEntryId)
                .put("revision", revision)
                .put("data", data)
            withContext(Dispatchers.Main) {
                runCatching { session.sendMessage(customNamespace, envelope.toString()) }
                    .onFailure { Timber.e(it, "Failed to send Musicfy Cast message") }
            }
        }
    }

    private fun invalidateSnapshot() {
        snapshotGeneration++
        scheduledSnapshotGeneration = -1L
        snapshotSendJob?.cancel()
        snapshotSendJob = null
        pendingAcks.values.forEach { it.cancel() }
        pendingAcks.clear()
    }

    private fun requestCurrentSnapshot() {
        if (!isReceiverReady) return
        val mediaId = currentMediaId ?: return
        val queueEntryId = currentQueueEntryId ?: mediaId
        if (activeRemoteMediaId != mediaId || activeRemoteQueueEntryId != queueEntryId) return
        val generation = snapshotGeneration
        if (scheduledSnapshotGeneration == generation) return
        scheduledSnapshotGeneration = generation
        snapshotSendJob?.cancel()
        snapshotSendJob = scope.launch { sendCurrentSnapshot(mediaId, queueEntryId, generation) }
    }

    private suspend fun sendCurrentSnapshot(
        mediaId: String,
        queueEntryId: String,
        expectedGeneration: Long,
    ) = lyricSendMutex.withLock {
        if (!isReceiverReady || currentMediaId != mediaId || currentQueueEntryId != queueEntryId ||
            snapshotGeneration != expectedGeneration) return@withLock
        val session = castSession ?: return@withLock
        val metadata = musicService.currentMediaMetadata.value?.takeIf { it.id == mediaId }
            ?: (0 until musicService.player.mediaItemCount)
                .firstNotNullOfOrNull { musicService.player.getMediaItemAt(it).metadata?.takeIf { item -> item.id == mediaId } }
            ?: return@withLock
        val revision = lyricRevision.incrementAndGet()
        val lyricsText = withContext(Dispatchers.IO) {
            runCatching { musicService.lyricsHelper.getLyrics(metadata).lyrics }.getOrDefault("")
        }
        val lyricsExceedLimit = lyricsText.toByteArray(Charsets.UTF_8).size > 1024 * 1024
        val lines = JSONArray()
        if (!lyricsExceedLimit && lyricsText != "LYRICS_NOT_FOUND") {
            LyricsUtils.parseLyrics(lyricsText).forEach { entry ->
                val line = JSONObject().put("timeMs", entry.time).put("text", entry.text)
                entry.words?.let { words ->
                    val wordArray = JSONArray()
                    words.forEach { word ->
                        wordArray.put(JSONObject()
                            .put("text", word.text)
                            .put("startMs", (word.startTime * 1000).toLong())
                            .put("endMs", (word.endTime * 1000).toLong()))
                    }
                    line.put("words", wordArray)
                }
                lines.put(line)
            }
        }

        val track = JSONObject()
            .put("title", metadata.title)
            .put("artist", metadata.artists.joinToString(", ") { it.name })
            .put("album", metadata.album?.title ?: JSONObject.NULL)
            .put("artwork", metadata.thumbnailUrl ?: JSONObject.NULL)
        if (!isReceiverReady || castSession !== session || currentMediaId != mediaId ||
            currentQueueEntryId != queueEntryId || snapshotGeneration != expectedGeneration) return@withLock
        val snapshot = JSONObject()
            .put("version", 1)
            .put("type", "SNAPSHOT")
            .put("requestId", UUID.randomUUID().toString())
            .put("senderSessionId", senderSessionId)
            .put("mediaId", mediaId)
            .put("queueEntryId", queueEntryId)
            .put("revision", revision)
            .put("data", JSONObject()
                .put("track", track)
                .put("lines", JSONArray())
                .put("mode", _receiverViewMode.value))
        withContext(Dispatchers.Main) {
            if (castSession !== session || currentMediaId != mediaId || currentQueueEntryId != queueEntryId ||
                snapshotGeneration != expectedGeneration) return@withContext
            runCatching {
                session.sendMessage(customNamespace, snapshot.toString())
                    .setResultCallback { status ->
                        if (!status.isSuccess) Timber.w("Musicfy Cast snapshot send failed: ${status.statusCode}")
                    }
            }.onFailure { Timber.e(it, "Failed to send Musicfy Cast snapshot") }
        }

        if (lyricsExceedLimit) {
            Timber.w("Cast lyrics exceed the 1 MiB receiver limit")
            return@withLock
        }

        val lyricsJson = JSONObject().put("lines", lines).toString()
        if (lyricsJson.toByteArray(Charsets.UTF_8).size > 1024 * 1024) {
            Timber.w("Cast lyrics exceed the 1 MiB receiver limit")
            return@withLock
        }
        val chunks = splitUtf8(lyricsJson, 12 * 1024)
        val transferId = UUID.randomUUID().toString()
        chunks.forEachIndexed { index, chunk ->
            if (!isReceiverReady || castSession !== session || currentMediaId != mediaId ||
                currentQueueEntryId != queueEntryId || snapshotGeneration != expectedGeneration) return@withLock
            val ackKey = "$transferId:$index"
            var delivered = false
            repeat(2) {
                if (delivered) return@repeat
                val ack = CompletableDeferred<Unit>()
                pendingAcks[ackKey] = ack
                val envelope = JSONObject()
                    .put("version", 1).put("type", "LYRICS_CHUNK")
                    .put("requestId", UUID.randomUUID().toString())
                    .put("senderSessionId", senderSessionId)
                    .put("mediaId", mediaId).put("queueEntryId", queueEntryId)
                    .put("revision", revision)
                    .put("data", JSONObject().put("transferId", transferId).put("index", index)
                        .put("count", chunks.size).put("chunk", chunk))
                try {
                    withContext(Dispatchers.Main) {
                        castSession?.sendMessage(customNamespace, envelope.toString())
                            ?.setResultCallback { status ->
                                if (!status.isSuccess) ack.completeExceptionally(
                                    IllegalStateException("Cast message failed with status ${status.statusCode}")
                                )
                            }
                    }
                    withTimeout(5_000) { ack.await() }
                    delivered = true
                } catch (e: TimeoutCancellationException) {
                    Timber.w(e, "Cast lyric chunk $index acknowledgement timed out")
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Timber.w(e, "Cast lyric chunk $index acknowledgement failed")
                } finally {
                    pendingAcks.remove(ackKey)
                }
            }
            if (!delivered) {
                Timber.w("Cast lyrics transfer stopped at chunk $index")
                return@withLock
            }
        }
    }

    private fun splitUtf8(value: String, limit: Int): List<String> {
        val chunks = mutableListOf<String>()
        val current = StringBuilder()
        var bytes = 0
        value.codePoints().forEach { point ->
            val part = String(Character.toChars(point))
            val size = part.toByteArray(Charsets.UTF_8).size
            if (bytes + size > limit && current.isNotEmpty()) {
                chunks += current.toString()
                current.setLength(0)
                bytes = 0
            }
            current.append(part)
            bytes += size
        }
        if (current.isNotEmpty() || chunks.isEmpty()) chunks += current.toString()
        return chunks
    }

    fun loadCurrentMedia() {
        val metadata = musicService.currentMediaMetadata.value ?: return
        loadMediaWithQueue(metadata)
    }

    fun loadMedia(metadata: AppMediaMetadata) {
        loadMediaWithQueue(metadata)
    }

    private suspend fun buildMediaInfo(
        metadata: AppMediaMetadata,
        queueEntryId: String = metadata.id
    ): MediaInfo? {
        val playback = musicService.getCastPlaybackData(metadata.id) ?: return null
        val streamUrl = playback.streamUrl

        val castMetadata = MediaMetadata(MediaMetadata.MEDIA_TYPE_MUSIC_TRACK).apply {
            putString(MediaMetadata.KEY_TITLE, metadata.title)
            putString(MediaMetadata.KEY_ARTIST, metadata.artists.joinToString(", ") { it.name })
            metadata.album?.title?.let { putString(MediaMetadata.KEY_ALBUM_TITLE, it) }
            metadata.thumbnailUrl?.let { thumbUrl ->

                val highQualityUrl = thumbUrl.resize(1080, 1080)
                addImage(WebImage(Uri.parse(highQualityUrl)))
            }
        }

        return MediaInfo.Builder(streamUrl)
            .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
            .setContentType(playback.format.mimeType.substringBefore(';'))
            .setMetadata(castMetadata)
            .setCustomData(org.json.JSONObject()
                .put("mediaId", metadata.id)
                .put("queueEntryId", queueEntryId))
            .build()
    }

    private fun castQueueEntryId(index: Int, mediaId: String): String = "${index.coerceAtLeast(0)}:$mediaId"

    private fun loadMediaWithQueue(metadata: AppMediaMetadata) {
        if (!_isCasting.value) return
        val session = castSession ?: return
        val client = remoteMediaClient ?: return
        castLoadJob?.cancel()
        val generation = ++castLoadGeneration
        val player = musicService.player
        val currentIndex = player.currentMediaItemIndex
        val queueEntryId = castQueueEntryId(currentIndex, metadata.id)
        currentMediaId = metadata.id
        currentQueueEntryId = queueEntryId
        val previousItemIds = client.mediaStatus?.queueItems.orEmpty().mapNotNull { item ->
            item.itemId.takeIf { it != -1 }
        }.toSet()
        pendingCastLoad = PendingCastQueueLoad(
            expectedQueueEntryId = queueEntryId,
            queueEntryIds = setOf(queueEntryId),
            previousItemIds = previousItemIds,
            requestAccepted = false,
        )
        invalidateSnapshot()
        isLoadingCastQueue = true
        pauseLocalAfterCastLoad = true
        _castIsBuffering.value = true
        lastCastItemId = -1

        val job = scope.launch {
            try {
                val mediaItemCount = player.mediaItemCount
                val shuffleEnabled = player.shuffleModeEnabled
                val timeline = player.currentTimeline
                val mediaItems = (0 until mediaItemCount).map(player::getMediaItemAt)

                val queueItems = mutableListOf<MediaQueueItem>()

                val prevItems = mutableListOf<Pair<Int, androidx.media3.common.MediaItem>>()
                if (!timeline.isEmpty) {
                    var prevIdx = currentIndex
                    for (i in 0 until 2) {
                        prevIdx = timeline.getPreviousWindowIndex(prevIdx, Player.REPEAT_MODE_OFF, shuffleEnabled)
                        if (prevIdx == androidx.media3.common.C.INDEX_UNSET) break
                        prevItems.add(0, prevIdx to mediaItems[prevIdx])
                    }
                }

                for ((sourceIndex, prevItem) in prevItems) {
                    prevItem.metadata?.let { prevMetadata ->
                        buildMediaInfo(prevMetadata, castQueueEntryId(sourceIndex, prevMetadata.id))?.let { mediaInfo ->
                            if (!isCurrentCastLoad(generation, session, client, metadata.id, queueEntryId)) return@launch
                            queueItems.add(MediaQueueItem.Builder(mediaInfo).build())
                        }
                    }
                }
                val startIndex = queueItems.size

                val currentMediaInfo = buildMediaInfo(metadata, queueEntryId)
                if (!isCurrentCastLoad(generation, session, client, metadata.id, queueEntryId)) return@launch
                if (currentMediaInfo == null) {
                    Timber.e("Failed to get stream URL for Cast")
                    pauseLocalAfterCastLoad = false
                    _castIsBuffering.value = false
                    if (generation == castLoadGeneration) pendingCastLoad = null
                    return@launch
                }
                queueItems.add(MediaQueueItem.Builder(currentMediaInfo).build())

                if (!timeline.isEmpty) {
                    var nextIdx = currentIndex
                    for (i in 0 until 2) {
                        nextIdx = timeline.getNextWindowIndex(nextIdx, Player.REPEAT_MODE_OFF, shuffleEnabled)
                        if (nextIdx == androidx.media3.common.C.INDEX_UNSET) break
                        val nextItem = mediaItems[nextIdx]
                        nextItem.metadata?.let { nextMetadata ->
                            buildMediaInfo(nextMetadata, castQueueEntryId(nextIdx, nextMetadata.id))?.let { mediaInfo ->
                                if (!isCurrentCastLoad(generation, session, client, metadata.id, queueEntryId)) return@launch
                                queueItems.add(MediaQueueItem.Builder(mediaInfo).build())
                            }
                        }
                    }
                }

                val startPosition = if (player.currentMediaItem?.mediaId == metadata.id) {
                    player.currentPosition
                } else {
                    0L
                }

                Timber.d("Loading Cast queue: ${queueItems.size} items, startIndex=$startIndex, shuffle=$shuffleEnabled")
                if (!isCurrentCastLoad(generation, session, client, metadata.id, queueEntryId)) return@launch
                val queueEntryIds = queueItems.mapNotNull { item ->
                    item.media?.customData?.optString("queueEntryId")
                        ?.takeIf { it.isNotBlank() && it != "null" }
                }.toSet().ifEmpty { setOf(queueEntryId) }
                pendingCastLoad = pendingCastLoad?.copy(queueEntryIds = queueEntryIds)

                withContext(Dispatchers.Main) {
                    if (!isCurrentCastLoad(generation, session, client, metadata.id, queueEntryId)) return@withContext

                    client.queueLoad(
                        queueItems.toTypedArray(),
                        startIndex,
                        MediaStatus.REPEAT_MODE_REPEAT_OFF,
                        startPosition,
                        org.json.JSONObject()
                    ).setResultCallback { result ->
                        scope.launch(Dispatchers.Main) {
                            if (generation != castLoadGeneration || session !== castSession || client !== remoteMediaClient) {
                                return@launch
                            }
                            if (result.status.isSuccess) {
                                pendingCastLoad = pendingCastLoad?.copy(requestAccepted = true)
                            } else {
                                Timber.w("Cast queue load was rejected: ${result.status.statusCode}")
                                pendingCastLoad = null
                            }
                            client.mediaStatus?.let(::reconcileCastItemStatus)
                        }
                    }

                }

                Timber.d("Loaded media on Cast: ${metadata.title}")
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                if (generation == castLoadGeneration) {
                    pauseLocalAfterCastLoad = false
                    pendingCastLoad = null
                }
                Timber.e(e, "Failed to load media on Cast")
                if (generation == castLoadGeneration) _castIsBuffering.value = false
            } finally {
                if (generation == castLoadGeneration) {
                    try {
                        delay(1500)
                    } finally {
                        if (generation == castLoadGeneration) {
                            isLoadingCastQueue = false
                            remoteMediaClient?.mediaStatus?.let(::reconcileCastItemStatus)
                            requestCurrentSnapshot()
                        }
                    }
                }
            }
        }
        castLoadJob = job
    }

    private fun isCurrentCastLoad(
        generation: Long,
        session: CastSession,
        client: RemoteMediaClient,
        mediaId: String,
        queueEntryId: String,
    ): Boolean = generation == castLoadGeneration && session === castSession && client === remoteMediaClient &&
        currentMediaId == mediaId && currentQueueEntryId == queueEntryId

    private fun cancelPendingCastLoadForQueueNavigation() {
        if (pendingCastLoad == null && !isLoadingCastQueue) return
        castLoadGeneration++
        castLoadJob?.cancel()
        castLoadJob = null
        pendingCastLoad = null
        isLoadingCastQueue = false
        pauseLocalAfterCastLoad = false
    }

    fun play() {
        remoteMediaClient?.play()
    }

    fun pause() {
        remoteMediaClient?.pause()
    }

    fun seekTo(position: Long) {
        val seekOptions = MediaSeekOptions.Builder()
            .setPosition(position)
            .build()
        remoteMediaClient?.seek(seekOptions)
    }

    fun setVolume(volume: Float) {
        try {
            val clampedVolume = volume.coerceIn(0f, 1f)
            castSession?.volume = clampedVolume.toDouble()
            _castVolume.value = clampedVolume
            Timber.d("Set Cast volume to $clampedVolume")
        } catch (e: Exception) {
            Timber.e(e, "Failed to set Cast volume")
        }
    }

    fun navigateToMediaIfInQueue(mediaId: String): Boolean {
        val client = remoteMediaClient ?: return false
        val mediaStatus = client.mediaStatus ?: return false
        val queueItems = mediaStatus.queueItems
        if (queueItems.isEmpty()) return false

        val player = musicService.player
        val localMediaIds = (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId }
        val localIndex = player.currentMediaItemIndex.takeIf {
            it in localMediaIds.indices && localMediaIds[it] == mediaId
        } ?: return false
        val desiredEntryId = castQueueEntryId(localIndex, mediaId)
        val exactTargetIndex = queueItems.indexOfFirst {
            it.media?.customData?.optString("queueEntryId") == desiredEntryId
        }
        val queueUsesEntryIds = queueItems.any {
            !it.media?.customData?.optString("queueEntryId").isNullOrBlank()
        }
        val uniqueLegacyTarget = queueItems.withIndex().filter {
            it.value.media?.customData?.optString("mediaId") == mediaId &&
                it.value.media?.customData?.optString("queueEntryId").isNullOrBlank()
        }.singleOrNull()?.index
        val targetIndex = exactTargetIndex.takeIf { it >= 0 }
            ?: if (!queueUsesEntryIds) uniqueLegacyTarget else null

        if (targetIndex == null) {
            Timber.d("Media $mediaId not found in Cast queue")
            return false
        }

        cancelPendingCastLoadForQueueNavigation()

        val currentItemId = mediaStatus.currentItemId
        val currentIndex = queueItems.indexOfFirst { it.itemId == currentItemId }

        val targetEntryId = queueItems[targetIndex].media?.customData?.optString("queueEntryId")
                ?.takeIf(String::isNotBlank)
                ?.takeIf { it != "null" }
                ?: mediaId
        if (targetIndex == currentIndex) {
            if (currentMediaId != mediaId || currentQueueEntryId != targetEntryId) {
                currentMediaId = mediaId
                currentQueueEntryId = targetEntryId
                activeRemoteMediaId = mediaId
                activeRemoteQueueEntryId = targetEntryId
                invalidateSnapshot()
                requestCurrentSnapshot()
            }
            handleCastItemChanged(mediaStatus)
            musicService.player.pause()
            return true
        }

        val targetItem = queueItems[targetIndex]
        Timber.d("Navigating Cast to item at index $targetIndex (mediaId=$mediaId)")

        isSyncingFromCast = true
        val targetLocalIndex = resolveCastQueueEntryIndex(targetEntryId, mediaId, localMediaIds)
        if (targetLocalIndex == null) {
            isSyncingFromCast = false
            Timber.w("Cast item $targetEntryId has no unambiguous local media item")
            return false
        }
        player.pause()
        player.seekTo(targetLocalIndex, 0)
        player.pause()

        client.queueJumpToItem(targetItem.itemId, org.json.JSONObject())
        currentMediaId = mediaId
        currentQueueEntryId = targetEntryId
        invalidateSnapshot()

        scope.launch {
            delay(300)
            isSyncingFromCast = false
            requestCurrentSnapshot()
        }

        return true
    }

    fun skipToNext() {

        val client = remoteMediaClient
        val mediaStatus = client?.mediaStatus
        if (mediaStatus != null && mediaStatus.queueItemCount > 0) {

            val currentItemId = mediaStatus.currentItemId
            val queueItems = mediaStatus.queueItems
            val currentIndex = queueItems.indexOfFirst { it.itemId == currentItemId }
            if (currentIndex >= 0 && currentIndex < queueItems.size - 1) {

                client.queueNext(org.json.JSONObject())

                musicService.player.pause()
                return
            }
        }

        val player = musicService.player
        if (player.hasNextMediaItem()) {

            player.pause()
            player.seekToNextMediaItem()

        }
    }

    fun skipToPrevious() {

        val client = remoteMediaClient
        val mediaStatus = client?.mediaStatus
        if (mediaStatus != null && mediaStatus.queueItemCount > 0) {

            val currentItemId = mediaStatus.currentItemId
            val queueItems = mediaStatus.queueItems
            val currentIndex = queueItems.indexOfFirst { it.itemId == currentItemId }
            if (currentIndex > 0) {

                client.queuePrev(org.json.JSONObject())

                musicService.player.pause()
                return
            }
        }

        val player = musicService.player
        if (player.hasPreviousMediaItem()) {

            player.pause()
            player.seekToPreviousMediaItem()
        }
    }

    private fun startPositionUpdates() {
        positionUpdateJob?.cancel()
        positionUpdateJob = scope.launch {
            while (isActive && _isCasting.value) {
                remoteMediaClient?.let { client ->
                    _castPosition.value = client.approximateStreamPosition
                }
                delay(500)
            }
        }
    }

    private fun stopPositionUpdates() {
        positionUpdateJob?.cancel()
        positionUpdateJob = null
    }

    fun release() {
        stopPositionUpdates()
        remoteMediaClient?.unregisterCallback(remoteMediaClientCallback)
        sessionManager?.removeSessionManagerListener(sessionManagerListener, CastSession::class.java)
    }
}
