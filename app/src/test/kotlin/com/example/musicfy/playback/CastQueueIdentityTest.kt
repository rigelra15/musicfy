package com.example.musicfy.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CastQueueIdentityTest {
    @Test
    fun `resolves the exact duplicate by queue entry identity`() {
        assertEquals(2, resolveCastQueueEntryIndex("2:song", "song", listOf("song", "song", "song")))
    }

    @Test
    fun `does not guess when duplicate identity no longer maps to local queue`() {
        assertNull(resolveCastQueueEntryIndex("8:song", "song", listOf("song", "song")))
    }

    @Test
    fun `permits a unique legacy match when queue entry identity is absent or stale`() {
        assertEquals(1, resolveCastQueueEntryIndex(null, "song", listOf("other", "song")))
        assertEquals(1, resolveCastQueueEntryIndex("8:song", "song", listOf("other", "song")))
    }

    @Test
    fun `extends cast queue by following the timeline shuffle order`() {
        val shuffledTimeline = listOf(0, 3, 1, 4, 2)
        val appended = collectCastQueueIndices(
            startIndex = 3,
            itemCount = 5,
            maxCount = 2,
            nextWindowIndex = { current ->
                shuffledTimeline.getOrNull(shuffledTimeline.indexOf(current) + 1)
            },
        )

        assertEquals(listOf(1, 4), appended)

        val traversalAfterLastRawIndex = listOf(0, 4, 2, 1, 3)
        assertEquals(
            listOf(2, 1),
            collectCastQueueIndices(4, 5, 2) { current ->
                traversalAfterLastRawIndex.getOrNull(traversalAfterLastRawIndex.indexOf(current) + 1)
            },
        )
    }

    @Test
    fun `stops queue extension when timeline ends or cycles`() {
        assertEquals(
            listOf(1),
            collectCastQueueIndices(0, 3, 2) { current -> if (current == 0) 1 else null },
        )
        assertEquals(
            listOf(1),
            collectCastQueueIndices(0, 3, 4) { current -> if (current == 0) 1 else 0 },
        )
    }

    @Test
    fun `requests queue refill when the confirmed current item is near either edge`() {
        assertEquals(true, shouldExtendCastQueue(3, 2))
        assertEquals(true, shouldExtendCastQueue(5, 4))
        assertEquals(false, shouldExtendCastQueue(5, 2))
        assertEquals(false, shouldExtendCastQueue(5, -1))
    }

    @Test
    fun `defers stale queue statuses while an explicit replacement load is pending`() {
        val pendingLoad = PendingCastQueueLoad(
            expectedQueueEntryId = "entry-b",
            queueEntryIds = setOf("entry-a", "entry-b", "entry-c"),
            previousItemIds = setOf(4, 5),
            requestAccepted = false,
        )

        assertEquals(false, shouldReconcileCastQueueStatus(true, null, 9, "entry-c"))
        assertEquals(false, shouldReconcileCastQueueStatus(false, pendingLoad, 4, "entry-a"))
        assertEquals(true, shouldReconcileCastQueueStatus(false, pendingLoad, 5, "entry-b"))
        assertEquals(false, shouldReconcileCastQueueStatus(false, pendingLoad, 6, "entry-c"))
        assertEquals(false, shouldReconcileCastQueueStatus(false, pendingLoad.copy(requestAccepted = true), 5, "entry-a"))
        assertEquals(true, shouldReconcileCastQueueStatus(false, pendingLoad.copy(requestAccepted = true), 9, "entry-c"))

        // With no explicit load pending, the first asynchronous status after reconnect bootstraps identity.
        assertEquals(true, shouldReconcileCastQueueStatus(false, null, 9, "entry-a"))
    }
}
