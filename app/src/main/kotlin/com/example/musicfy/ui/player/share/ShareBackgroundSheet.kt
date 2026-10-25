// ShareBackgroundSheet.kt
//
// "Edit background": swipe between the three kinds - made from the music, your own picture, a
// colour - and set each one up underneath. Whatever page you land on is applied at once, so the
// picture behind (peeking over the top) changes as you go; Ok just closes.

package com.example.musicfy.ui.player.share

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.musicfy.R
import com.example.musicfy.ui.component.PopupSheetState
import com.example.musicfy.ui.component.SheetPillButton
import com.example.musicfy.ui.screens.audiolab.LabCard
import com.example.musicfy.ui.screens.audiolab.LabSlider
import com.example.musicfy.ui.screens.audiolab.LabToggleRow
import com.example.musicfy.ui.theme.InterFontFamily
import kotlin.math.abs

private enum class BackgroundPage(val label: String) {
    Music("Made from the music"),
    Picture("Add your own image"),
    Colour("Pick a colour"),
}

/** Plain colours offered next to the cover's own. */
private val BasicColours = listOf(Color(0xFF111111), Color(0xFF2C2C2E), Color(0xFFF2F2F2), Color(0xFFE8DCC8))

internal fun PopupSheetState.showBackgroundPicker(session: LyricsShareSession) {
    val popup = this
    show(buttonBar = { SheetPillButton(text = "Ok", onClick = popup::dismiss) }) {
        BackgroundPickerContent(session)
    }
}

@Composable
private fun BackgroundPickerContent(session: LyricsShareSession) {
    // the last picture and colour are kept while you swipe, so coming back to a page finds it as you left it
    var picture by remember { mutableStateOf(session.background as? ShareBackground.Picture) }
    var colour by remember { mutableStateOf((session.background as? ShareBackground.Solid)?.color ?: session.palette.firstOrNull() ?: BasicColours[0]) }
    val pager = rememberPagerState(
        initialPage = when (session.background) {
            ShareBackground.FromMusic -> 0
            is ShareBackground.Picture -> 1
            is ShareBackground.Solid -> 2
        },
    ) { BackgroundPage.entries.size }

    fun applyPage(page: Int) {
        session.background = when (BackgroundPage.entries[page]) {
            BackgroundPage.Music -> ShareBackground.FromMusic
            // no picture yet: keep what was there until one is picked
            BackgroundPage.Picture -> picture ?: session.background
            BackgroundPage.Colour -> ShareBackground.Solid(colour)
        }
    }
    LaunchedEffect(pager) { snapshotFlow { pager.settledPage }.collect(::applyPage) }

    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? ->
        if (uri != null) {
            picture = ShareBackground.Picture(uri, blur = picture?.blur ?: true, opacity = picture?.opacity ?: 0.85f)
            session.background = picture!!
        }
    }
    val pickPicture = { launcher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
    val cardHeight = (LocalConfiguration.current.screenHeightDp * 0.4f).dp

    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
        Spacer(Modifier.height(10.dp))
        HorizontalPager(
            state = pager,
            contentPadding = PaddingValues(horizontal = 56.dp),
            pageSpacing = 14.dp,
            modifier = Modifier.fillMaxWidth().height(cardHeight),
        ) { page ->
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        // the cards either side sit back a little, so the one in the middle reads as chosen
                        val offset = abs(pager.currentPage - page + pager.currentPageOffsetFraction).coerceIn(0f, 1f)
                        val s = 1f - 0.1f * offset
                        scaleX = s
                        scaleY = s
                        alpha = 1f - 0.35f * offset
                    }
                    .clip(RoundedCornerShape(28.dp))
                    .background(Color(0xFFD9D9D9)),
            ) {
                when (BackgroundPage.entries[page]) {
                    BackgroundPage.Music -> BackdropOf(ShareBackground.FromMusic, session.song.thumbnailUrl, session.palette, animate = true)
                    BackgroundPage.Colour -> BackdropOf(ShareBackground.Solid(colour), null, session.palette, animate = false)
                    BackgroundPage.Picture -> {
                        val current = picture
                        if (current != null) {
                            BackdropOf(current, null, session.palette, animate = false)
                        } else {
                            Box(
                                contentAlignment = Alignment.Center,
                                modifier = Modifier
                                    .size(100.dp)
                                    .clip(CircleShape)
                                    .background(Color(0xFF4F4F52))
                                    .clickable(onClick = pickPicture),
                            ) {
                                Icon(painterResource(R.drawable.add), contentDescription = "Pick a picture", tint = Color.White, modifier = Modifier.size(34.dp))
                            }
                        }
                    }
                }
            }
        }

        AnimatedContent(
            targetState = pager.currentPage,
            transitionSpec = { (fadeIn() + slideInVertically { it / 3 }).togetherWith(fadeOut()) },
            label = "backgroundPage",
            modifier = Modifier.fillMaxWidth().padding(top = 18.dp, bottom = 16.dp),
        ) { page ->
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                Text(
                    BackgroundPage.entries[page].label,
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                    letterSpacing = (-0.4).sp,
                    color = Color.White,
                )
                Spacer(Modifier.height(12.dp))
                when (BackgroundPage.entries[page]) {
                    BackgroundPage.Music -> Hint("Soft clouds of the cover's colours, drifting over the cover itself")
                    BackgroundPage.Picture -> {
                        val current = picture
                        if (current == null) {
                            Hint("Tap the circle to pick a picture from your phone")
                        } else {
                            LabCard(padding = 10.dp) {
                                LabToggleRow(
                                    title = "Blur",
                                    subtitle = null,
                                    checked = current.blur,
                                    onCheckedChange = { on ->
                                        picture = current.copy(blur = on).also { session.background = it }
                                    },
                                    leadingDot = true,
                                )
                                LabSlider(
                                    label = "Opacity",
                                    valueText = "${(current.opacity * 100).toInt()}%",
                                    value = current.opacity,
                                    onValueChange = { v -> picture = current.copy(opacity = v).also { session.background = it } },
                                    valueRange = 0.2f..1f,
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 4.dp),
                                )
                                Text(
                                    "Change picture",
                                    fontFamily = InterFontFamily,
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 14.sp,
                                    color = Color.White,
                                    modifier = Modifier
                                        .padding(top = 6.dp)
                                        .clip(CircleShape)
                                        .clickable(onClick = pickPicture)
                                        .padding(horizontal = 6.dp, vertical = 8.dp),
                                )
                            }
                        }
                    }
                    BackgroundPage.Colour -> {
                        val choose = { c: Color ->
                            colour = c
                            session.background = ShareBackground.Solid(c)
                        }
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            modifier = Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 4.dp),
                        ) {
                            (session.palette + BasicColours).forEach { c ->
                                Box(
                                    Modifier
                                        .size(36.dp)
                                        .clip(CircleShape)
                                        .background(c)
                                        .border(if (c == colour) 3.dp else 1.dp, Color.White.copy(alpha = if (c == colour) 0.9f else 0.15f), CircleShape)
                                        .clickable { choose(c) },
                                )
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                        LabCard(padding = 10.dp) {
                            Row(Modifier.padding(start = 6.dp, end = 6.dp, top = 2.dp, bottom = 10.dp)) {
                                Text(
                                    "Your own colour",
                                    fontFamily = InterFontFamily,
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 13.sp,
                                    color = Color.White,
                                    modifier = Modifier.weight(1f),
                                )
                                Text(
                                    hexOf(colour),
                                    fontFamily = InterFontFamily,
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 13.sp,
                                    color = ShareMuted,
                                )
                            }
                            ColourSpectrum(colour, onPick = choose)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Hint(text: String) {
    Text(
        text,
        fontFamily = InterFontFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 13.sp,
        color = ShareMuted,
        textAlign = TextAlign.Center,
        modifier = Modifier.padding(horizontal = 24.dp),
    )
}

private fun hexOf(color: Color): String = "#%06X".format(color.toArgb() and 0xFFFFFF)
