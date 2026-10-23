package com.example.musicfy.playback

internal fun resolveCastQueueEntryIndex(
    queueEntryId: String?,
    mediaId: String,
    localMediaIds: List<String>,
): Int? {
    if (mediaId.isBlank()) return null
    val encodedIndex = queueEntryId?.substringBefore(':')?.toIntOrNull()
    if (encodedIndex != null && encodedIndex in localMediaIds.indices && localMediaIds[encodedIndex] == mediaId) {
        return encodedIndex
    }
    return localMediaIds.indices.filter { localMediaIds[it] == mediaId }.singleOrNull()
}

internal fun collectCastQueueIndices(
    startIndex: Int,
    itemCount: Int,
    maxCount: Int,
    nextWindowIndex: (Int) -> Int?,
): List<Int> {
    if (startIndex !in 0 until itemCount || maxCount <= 0) return emptyList()

    val result = mutableListOf<Int>()
    val visited = mutableSetOf(startIndex)
    var currentIndex = startIndex
    repeat(maxCount) {
        val nextIndex = nextWindowIndex(currentIndex) ?: return result
        if (nextIndex !in 0 until itemCount || !visited.add(nextIndex)) return result
        result += nextIndex
        currentIndex = nextIndex
    }
    return result
}

internal fun shouldExtendCastQueue(currentQueueSize: Int, currentQueueIndex: Int): Boolean {
    if (currentQueueIndex !in 0 until currentQueueSize) return false
    val itemsAhead = currentQueueSize - 1 - currentQueueIndex
    return itemsAhead < 2 || currentQueueIndex < 2
}

internal data class PendingCastQueueLoad(
    val expectedQueueEntryId: String,
    val queueEntryIds: Set<String>,
    val previousItemIds: Set<Int>,
    val requestAccepted: Boolean,
)

internal fun shouldReconcileCastQueueStatus(
    queueOperationInProgress: Boolean,
    pendingCastLoad: PendingCastQueueLoad?,
    activeItemId: Int,
    activeQueueEntryId: String?,
): Boolean {
    if (queueOperationInProgress) return false
    pendingCastLoad ?: return true
    if (activeQueueEntryId == pendingCastLoad.expectedQueueEntryId) return true
    return pendingCastLoad.requestAccepted && activeItemId !in pendingCastLoad.previousItemIds &&
        activeQueueEntryId?.let(pendingCastLoad.queueEntryIds::contains) == true
}
