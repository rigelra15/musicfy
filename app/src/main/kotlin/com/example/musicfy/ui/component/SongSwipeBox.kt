// SongSwipeBox.kt

package com.example.musicfy.ui.component

import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.datastore.preferences.core.Preferences
import com.example.musicfy.R
import com.example.musicfy.constants.SwipeLeftActionKey
import com.example.musicfy.constants.SwipeRightActionKey
import com.example.musicfy.utils.rememberEnumPreference

/**
 * What sliding a song can do. Settings > Gesture picks one for each side. [title] names it in
 * that page; the rest is how its pill looks while you slide ([pillLabel] is the "add" wording,
 * since the library one flips to "remove" for a song that's already saved).
 */
enum class SongSwipeAction(
    val title: String,
    @DrawableRes val icon: Int,
    val color: Color,
    @StringRes val pillLabel: Int,
) {
    Library("Add or remove from library", R.drawable.library_add, SwipeSaveColor, R.string.add_to_library),
    Queue("Add to queue", R.drawable.queue_music, SwipeQueueColor, R.string.add_to_queue),
}

/** Out of the box, sliding right saves the song and sliding left queues it. */
val DefaultSwipeRight = SongSwipeAction.Library
val DefaultSwipeLeft = SongSwipeAction.Queue

/**
 * A song row you can slide, with the action on each side taken from Settings > Gesture.
 *
 * Callers say what each action means for their row: [library] may be "add to library", "take out
 * of this playlist" or "remove this import", and [queue] puts the song on the queue. This picks
 * which of the two shows on which side. Nothing is read from settings until a side is actually
 * pulled out, so a long list pays nothing for it.
 */
@Composable
fun SongSwipeBox(
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    slab: Boolean = true,
    library: @Composable () -> SwipeAction,
    queue: @Composable () -> SwipeAction,
    content: @Composable () -> Unit,
) {
    SwipeActionsBox(
        modifier = modifier,
        enabled = enabled,
        slab = slab,
        start = { chosenSwipeAction(SwipeRightActionKey, DefaultSwipeRight, library, queue) },
        end = { chosenSwipeAction(SwipeLeftActionKey, DefaultSwipeLeft, library, queue) },
        content = content,
    )
}

@Composable
private fun chosenSwipeAction(
    key: Preferences.Key<String>,
    default: SongSwipeAction,
    library: @Composable () -> SwipeAction,
    queue: @Composable () -> SwipeAction,
): SwipeAction {
    val (chosen) = rememberEnumPreference(key, defaultValue = default)
    return when (chosen) {
        SongSwipeAction.Library -> library()
        SongSwipeAction.Queue -> queue()
    }
}
