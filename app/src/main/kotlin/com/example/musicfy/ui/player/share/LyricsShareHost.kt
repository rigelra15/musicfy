// LyricsShareHost.kt
//
// Where a lyrics share happens: a see-through full-screen dialog over the player, holding its own
// stack of popup sheets. A dialog rather than the app's sheet host because the held line has to
// fly out of the lyrics and land in the picker while the sheet rises - the sheets clip whatever
// is inside them, and the flight (ShareFlight.kt) sits above them in the same window.

package com.example.musicfy.ui.player.share

import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.view.WindowManager
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import com.example.musicfy.ui.component.PopupSheetHost
import com.example.musicfy.ui.component.PopupSheetState
import kotlinx.coroutines.flow.first

@Composable
internal fun LyricsShareHost(session: LyricsShareSession, onDismiss: () -> Unit) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
            // the sheets handle back themselves, one sheet at a time
            dismissOnBackPress = false,
            dismissOnClickOutside = false,
        ),
    ) {
        EdgeToEdgeDialogWindow()
        val context = LocalContext.current
        val sheets = remember { PopupSheetState() }
        LaunchedEffect(Unit) {
            // Closing the first sheet means the whole share is done: the opening plays backwards
            // while it slides away, and the dialog goes once both have finished
            val picker = sheets.showLinePicker(session)
            snapshotFlow { picker.isClosing }.first { it }
            session.choreography.playBackward()
            snapshotFlow { sheets.isVisible }.first { !it }
            onDismiss()
        }
        LaunchedEffect(session.song.thumbnailUrl) {
            session.palette = coverPalette(context, session.song.thumbnailUrl)
        }
        Box(Modifier.fillMaxSize()) {
            PopupSheetHost(states = listOf(sheets)) {}
            ShareFlight(session)
        }
    }
}

/**
 * The dialog's window drawn edge to edge, see-through and without its own dim or animation, so its
 * coordinates are the app's and the flight starts exactly over the held line. Same set-up as the
 * recap story's dialog.
 */
@Composable
private fun EdgeToEdgeDialogWindow() {
    val window = (LocalView.current.parent as? DialogWindowProvider)?.window ?: return
    SideEffect {
        window.run {
            setWindowAnimations(0)
            setDimAmount(0f)
            clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            setBackgroundDrawable(ColorDrawable(android.graphics.Color.TRANSPARENT))
            setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT)
            @Suppress("DEPRECATION")
            clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS or WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION)
            addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
            addFlags(WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN)
            @Suppress("DEPRECATION")
            statusBarColor = android.graphics.Color.TRANSPARENT
            @Suppress("DEPRECATION")
            navigationBarColor = android.graphics.Color.TRANSPARENT
            if (Build.VERSION.SDK_INT >= 28) {
                attributes = attributes.also {
                    it.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                }
            }
            if (Build.VERSION.SDK_INT >= 29) isNavigationBarContrastEnforced = false
            if (Build.VERSION.SDK_INT >= 30) {
                attributes = attributes.also { it.fitInsetsTypes = 0 }
            }
        }
    }
}
