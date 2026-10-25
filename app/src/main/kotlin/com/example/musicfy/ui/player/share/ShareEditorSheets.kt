// ShareEditorSheets.kt
//
// The editors, step 3 of a lyrics share. The Card editor shows the picture with its card; a tap on
// the card tries the next cover colour. The Cinematic editor ("CoolEditor") outlines the song and
// the words: the words open the word editor ("CoolfontEditor"), where each word can glow, go to
// capitals or go big, and the arrow over the song moves it under the words.

package com.example.musicfy.ui.player.share

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.musicfy.ui.component.PopupSheetState
import com.example.musicfy.ui.component.SheetPillButton
import com.example.musicfy.ui.component.pressBounce
import com.example.musicfy.ui.player.menu.MenuRowSurface
import com.example.musicfy.ui.screens.audiolab.LabCard
import com.example.musicfy.ui.screens.audiolab.LabToggleRow
import com.example.musicfy.ui.theme.InterFontFamily

/** How tall the picture is in an editor: most of the sheet, leaving the title and the buttons room. */
@Composable
private fun previewHeight() = (LocalConfiguration.current.screenHeightDp * 0.58f).dp

// ---------------------------------------------------------------------------------------------
// Card

internal fun PopupSheetState.showCardEditor(session: LyricsShareSession) {
    val popup = this
    show(buttonBar = { ShareActions(session) }) {
        ShareTitle("Share", "Card styles")
        Box(Modifier.fillMaxWidth().height(previewHeight())) {
            SharePreview(
                session = session,
                capture = true,
                modifier = Modifier.fillMaxSize(),
                onCardTap = {
                    if (session.palette.isNotEmpty()) session.cardColor = (session.cardColor + 1) % (session.palette.size + 2)
                },
            )
            EditBackgroundPill(Modifier.align(Alignment.TopEnd)) { popup.showBackgroundPicker(session) }
        }
        Text(
            "Tap the card to try another colour",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 12.sp,
            color = ShareMuted,
            modifier = Modifier
                .align(Alignment.CenterHorizontally)
                .padding(top = 10.dp, bottom = 6.dp),
        )
    }
}

@Composable
private fun EditBackgroundPill(modifier: Modifier = Modifier, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    Text(
        "Edit background",
        fontFamily = InterFontFamily,
        fontWeight = FontWeight.Bold,
        fontSize = 12.sp,
        letterSpacing = (-0.2).sp,
        color = Color.White,
        modifier = modifier
            .padding(12.dp)
            .pressBounce(interaction)
            .clip(CircleShape)
            .background(Color.Black.copy(alpha = 0.38f))
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    )
}

// ---------------------------------------------------------------------------------------------
// Cinematic

internal fun PopupSheetState.showCinematicEditor(session: LyricsShareSession) {
    val popup = this
    show(buttonBar = { ShareActions(session) }) {
        ShareTitle("CoolEditor", beta = true)
        val regions = remember { ShareRegions() }
        Box(Modifier.fillMaxWidth().height(previewHeight())) {
            SharePreview(
                session = session,
                capture = true,
                regions = regions,
                modifier = Modifier.fillMaxSize(),
                overlay = {
                    EditOutlines(
                        regions = regions,
                        headerBelow = session.headerBelow,
                        onWords = { popup.showWordEditor(session) },
                        onMoveHeader = { session.headerBelow = !session.headerBelow },
                    )
                },
            )
            EditBackgroundPill(Modifier.align(Alignment.TopEnd)) { popup.showBackgroundPicker(session) }
        }
        Text(
            "Tap the words to style them, the arrow to move the song",
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 12.sp,
            color = ShareMuted,
            modifier = Modifier
                .align(Alignment.CenterHorizontally)
                .padding(top = 10.dp, bottom = 6.dp),
        )
    }
}

// ---------------------------------------------------------------------------------------------
// Words

private fun PopupSheetState.showWordEditor(session: LyricsShareSession) {
    val popup = this
    show(buttonBar = { SheetPillButton(text = "Done", onClick = popup::dismiss) }) {
        WordEditorContent(session) { key, word -> popup.showWordLook(session, key, word) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WordEditorContent(session: LyricsShareSession, onWord: (WordKey, String) -> Unit) {
    ShareTitle("CoolfontEditor", beta = true)
    Column(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = (LocalConfiguration.current.screenHeightDp * 0.42f).dp)
            .verticalScroll(rememberScrollState()),
    ) {
        session.chosen.forEach { (line, text) ->
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                wordsOf(text).forEachIndexed { i, word ->
                    val key = WordKey(line, i)
                    WordChip(word, session.look(key)) { onWord(key, word) }
                }
            }
        }
    }
    Spacer(Modifier.height(18.dp))
    LabCard(padding = 8.dp) {
        LabToggleRow(
            title = "all Glow",
            subtitle = null,
            checked = session.allHave { it.glow },
            onCheckedChange = { on -> session.setForAll { it.copy(glow = on) } },
            leadingDot = true,
        )
        LabToggleRow(
            title = "all Capslock",
            subtitle = null,
            checked = session.allHave { it.caps },
            onCheckedChange = { on -> session.setForAll { it.copy(caps = on) } },
            leadingDot = true,
        )
        LabToggleRow(
            title = "all Big",
            subtitle = null,
            checked = session.allHave { it.big },
            onCheckedChange = { on -> session.setForAll { it.copy(big = on) } },
            leadingDot = true,
        )
    }
    Spacer(Modifier.height(8.dp))
}

/** A word in its outlined slot, drawn the way it will look. Styled words get a brighter outline. */
@Composable
private fun WordChip(word: String, look: WordLook, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    Box(
        Modifier
            .pressBounce(interaction)
            .border(3.dp, if (look.plain) Color(0xFF5A5A5E) else Color.White.copy(alpha = 0.8f), RoundedCornerShape(16.dp))
            .padding(4.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(MenuRowSurface)
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            .padding(horizontal = 11.dp, vertical = 6.dp),
    ) {
        Text(
            androidx.compose.ui.text.buildAnnotatedString {
                pushStyle(wordSpan(look, Color.White, base = 14f))
                append(if (look.caps) word.uppercase() else word)
            },
            fontFamily = InterFontFamily,
            color = Color.White,
        )
    }
}

/** The small sheet for one word: glow, capitals, big. */
private fun PopupSheetState.showWordLook(session: LyricsShareSession, key: WordKey, word: String) {
    show {
        Text(
            word,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 20.sp,
            letterSpacing = (-0.6).sp,
            color = Color.White,
            modifier = Modifier.padding(start = 6.dp, bottom = 10.dp),
        )
        LabCard(padding = 8.dp, modifier = Modifier.padding(bottom = 16.dp)) {
            val look = session.look(key)
            LabToggleRow("Glow", null, look.glow, { session.setLook(key, look.copy(glow = it)) }, leadingDot = true)
            LabToggleRow("Capslock", null, look.caps, { session.setLook(key, look.copy(caps = it)) }, leadingDot = true)
            LabToggleRow("Big", null, look.big, { session.setLook(key, look.copy(big = it)) }, leadingDot = true)
        }
    }
}
