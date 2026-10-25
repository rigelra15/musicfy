// ShareKit.kt
//
// The small pieces every lyrics share sheet uses: the big title with its BETA tag, the picker
// row's look (shared with the flying line so it lands on exactly that), the shake for a tap that
// can't do anything, and the Share!/Save pair.

package com.example.musicfy.ui.player.share

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationVector1D
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.musicfy.R
import com.example.musicfy.ui.component.SheetPillButton
import com.example.musicfy.ui.component.pressBounce
import com.example.musicfy.ui.player.menu.MenuRowSurface
import com.example.musicfy.ui.theme.InterFontFamily
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

private val BetaYellow = Color(0xFFF5E27A)
internal val ShareMuted = Color(0xFF9A9AA0)

// A picker row, shared with the flying line so it lands on exactly this.
internal val ShareRowCorner = 16.dp
internal val ShareRowPadH = 16.dp
internal val ShareRowFontSize = 15.sp
internal val ShareRowTextStyle = TextStyle(
    fontFamily = InterFontFamily,
    fontWeight = FontWeight.SemiBold,
    fontSize = ShareRowFontSize,
    letterSpacing = (-0.3).sp,
    color = Color.White,
)

/** A picked line's fill: the cover's two strongest colours, side to side across [width]. */
internal fun pickedBrush(palette: List<Color>, width: Float = Float.POSITIVE_INFINITY): Brush {
    val a = palette.getOrNull(0) ?: Color(0xFF5A5A5E)
    val b = palette.getOrNull(1) ?: a.copy(alpha = 0.7f)
    return Brush.horizontalGradient(listOf(a, b), startX = 0f, endX = width)
}

/**
 * A picker row's surface: grey when free, filled with the cover's colours when picked, and only
 * outlined in them when picked past what a card holds, since only Cinematic can show those.
 */
internal fun DrawScope.drawShareRowLook(
    fill: Float,
    outline: Float,
    palette: List<Color>,
    corner: Float,
    size: Size = this.size,
    alpha: Float = 1f,
) {
    val radius = CornerRadius(corner)
    drawRoundRect(MenuRowSurface, size = size, cornerRadius = radius, alpha = alpha)
    val brush = pickedBrush(palette, size.width)
    if (fill > 0f) drawRoundRect(brush, size = size, cornerRadius = radius, alpha = fill * alpha)
    if (outline > 0f) {
        val line = 2.dp.toPx()
        drawRoundRect(brush, size = size, cornerRadius = radius, alpha = 0.2f * outline * alpha)
        drawRoundRect(
            brush,
            topLeft = Offset(line / 2f, line / 2f),
            size = Size(size.width - line, size.height - line),
            cornerRadius = CornerRadius(corner - line / 2f),
            style = Stroke(line),
            alpha = outline * alpha,
        )
    }
    val free = (1f - fill - outline).coerceIn(0f, 1f)
    if (free > 0f) {
        drawRoundRect(Color.White.copy(alpha = 0.07f * free), size = size, cornerRadius = radius, style = Stroke(1.dp.toPx()), alpha = alpha)
    }
}

@Composable
internal fun ShareTitle(title: String, subtitle: String? = null, beta: Boolean = false) {
    Column(Modifier.padding(top = 6.dp, bottom = 14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                title,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Bold,
                fontSize = 34.sp,
                letterSpacing = (-1.6).sp,
                color = Color.White,
            )
            if (beta) {
                Spacer(Modifier.width(12.dp))
                Text(
                    "BETA",
                    color = BetaYellow,
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace,
                    letterSpacing = 1.sp,
                    modifier = Modifier
                        .border(1.dp, BetaYellow.copy(alpha = 0.8f), CircleShape)
                        .padding(horizontal = 12.dp, vertical = 3.dp),
                )
            }
        }
        if (subtitle != null) {
            Text(subtitle, fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = ShareMuted)
        }
    }
}

/** A quick side-to-side shake, for a tap that can't do anything. */
internal fun CoroutineScope.shake(offset: Animatable<Float, AnimationVector1D>) = launch {
    for (x in listOf(14f, -11f, 8f, -5f, 0f)) offset.animateTo(x, tween(45))
}

// ---------------------------------------------------------------------------------------------
// Share and save

/**
 * "Share!" makes the picture and opens the share sheet. The round button beside it keeps a copy
 * in Pictures/Musicfy and turns into a tick when it's saved (Android 10+ only).
 */
@Composable
internal fun ShareActions(session: LyricsShareSession) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var working by remember { mutableStateOf(false) }
    var saved by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        SheetPillButton(
            text = if (working) "Making it…" else "Share!",
            enabled = !working,
            modifier = Modifier.weight(1f),
            onClick = {
                val layer = session.capture ?: return@SheetPillButton
                working = true
                scope.launch {
                    runCatching {
                        val uri = cacheShareImage(context, layer.toShareBitmap())
                        openShareSheet(context, uri, session.song)
                    }
                    working = false
                }
            },
        )
        if (CanSaveToGallery) {
            Spacer(Modifier.width(10.dp))
            val interaction = remember { MutableInteractionSource() }
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .pressBounce(interaction)
                    .size(46.dp)
                    .clip(CircleShape)
                    .background(MenuRowSurface)
                    .clickable(interactionSource = interaction, indication = null, enabled = !working && !saved) {
                        val layer = session.capture ?: return@clickable
                        scope.launch { saved = saveShareImage(context, layer.toShareBitmap()) }
                    },
            ) {
                AnimatedContent(
                    targetState = saved,
                    transitionSpec = { (scaleIn(spring(dampingRatio = 0.5f, stiffness = 500f)) + fadeIn()).togetherWith(scaleOut() + fadeOut()) },
                    label = "saveIcon",
                ) { done ->
                    Icon(
                        painterResource(if (done) R.drawable.check else R.drawable.download),
                        contentDescription = if (done) "Saved to Pictures" else "Save to Pictures",
                        tint = Color.White,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
        }
    }
}
