// GestureScreen.kt
//
// Settings > Gesture, from the user's mock: one card for each way of sliding a song (right and
// left), each with a live demo of the swipe and a dropdown that opens a small sheet to pick what
// it does. Picking closes the sheet right away; there's no Done button. The choice is read by
// SongSwipeBox in every song list.

package com.example.musicfy.ui.screens.gesture

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.example.musicfy.R
import com.example.musicfy.constants.SwipeLeftActionKey
import com.example.musicfy.constants.SwipeRightActionKey
import com.example.musicfy.ui.component.DefaultSwipeLeft
import com.example.musicfy.ui.component.DefaultSwipeRight
import com.example.musicfy.ui.component.LocalMenuState
import com.example.musicfy.ui.component.SheetIcon
import com.example.musicfy.ui.component.SheetOptionRow
import com.example.musicfy.ui.component.SongSwipeAction
import com.example.musicfy.ui.component.bleedHorizontally
import com.example.musicfy.ui.screens.audiolab.AudioLabPage
import com.example.musicfy.ui.screens.audiolab.LabCard
import com.example.musicfy.ui.screens.audiolab.LabColors
import com.example.musicfy.ui.screens.audiolab.LabTitle
import com.example.musicfy.ui.theme.InterFontFamily
import com.example.musicfy.utils.rememberEnumPreference

private val CardPadding = 20.dp

@Composable
fun GestureScreen(navController: NavController) {
    val (right, setRight) = rememberEnumPreference(SwipeRightActionKey, defaultValue = DefaultSwipeRight)
    val (left, setLeft) = rememberEnumPreference(SwipeLeftActionKey, defaultValue = DefaultSwipeLeft)

    AudioLabPage(
        title = LabTitle("Gesture", "", firstSize = 52.sp),
        onBack = { navController.navigateUp() },
    ) {
        SwipeCard(
            title = "Swipe right",
            subtitle = "Slide a song in any list to the right",
            toRight = true,
            action = right,
            onPick = setRight,
        )
        Spacer(Modifier.height(14.dp))
        SwipeCard(
            title = "Swipe left",
            subtitle = "Slide a song in any list to the left",
            toRight = false,
            action = left,
            onPick = setLeft,
        )
    }
}

@Composable
private fun SwipeCard(
    title: String,
    subtitle: String,
    toRight: Boolean,
    action: SongSwipeAction,
    onPick: (SongSwipeAction) -> Unit,
) {
    val sheets = LocalMenuState.current
    LabCard(padding = CardPadding) {
        Text(
            title,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 20.sp,
            letterSpacing = (-0.02).em,
            color = LabColors.Primary,
        )
        Text(
            subtitle,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 13.sp,
            color = LabColors.Secondary,
            modifier = Modifier.padding(top = 2.dp),
        )
        Spacer(Modifier.height(20.dp))
        // the demo runs edge to edge, like the mock: the row slides off the card's side
        SwipePreview(action, toRight, Modifier.bleedHorizontally(CardPadding))
        Spacer(Modifier.height(20.dp))
        ActionDropdown(action) {
            sheets.show {
                ActionPicker(selected = action) { picked ->
                    onPick(picked)
                    sheets.dismiss()
                }
            }
        }
    }
}

/** the pill under the demo: what's picked now, tap to change it */
@Composable
private fun ActionDropdown(action: SongSwipeAction, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .height(48.dp)
            .clip(RoundedCornerShape(24.dp))
            .background(LabColors.Row)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp),
    ) {
        // as wide as the arrow, so the name sits in the middle of the pill
        Spacer(Modifier.size(20.dp))
        Crossfade(targetState = action, animationSpec = tween(180), modifier = Modifier.weight(1f), label = "swipeAction") { shown ->
            Text(
                shown.title,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.SemiBold,
                fontSize = 15.sp,
                letterSpacing = (-0.01).em,
                color = LabColors.Primary,
                textAlign = TextAlign.Center,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Icon(
            painter = painterResource(R.drawable.expand_more),
            contentDescription = null,
            tint = LabColors.Secondary,
            modifier = Modifier.size(20.dp),
        )
    }
}

/** the sheet's rows: tapping one picks it, and the sheet closes itself */
@Composable
private fun ActionPicker(selected: SongSwipeAction, onPick: (SongSwipeAction) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 12.dp)) {
        SongSwipeAction.entries.forEach { option ->
            SheetOptionRow(
                title = option.title,
                onClick = { onPick(option) },
                leading = { SheetIcon(option.icon) },
                trailing = {
                    if (option == selected) SheetIcon(R.drawable.check, size = 18.dp)
                },
            )
        }
    }
}
