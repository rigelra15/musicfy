// ShareCanvas.kt
//
// The picture a lyrics share makes. It is always laid out at one fixed size (a 9:16 story) with
// the font scale held at 1, so it looks the same on every phone and in every preview; the editors
// just scale it down to fit. The Card style puts the lines on a coloured card like Spotify's; the
// Cinematic style sets them straight on the background, word by word.

package com.example.musicfy.ui.player.share

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.boundsInParent
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.util.lerp
import coil3.compose.AsyncImage
import com.example.musicfy.R
import com.example.musicfy.ui.theme.InterFontFamily
import com.example.musicfy.ui.utils.resize
import kotlin.math.min
import kotlin.math.sqrt

internal val ShareWidth = 360.dp
internal val ShareHeight = 640.dp

/**
 * The Cinematic editor outlines the song and the words; these are where they sit on the picture,
 * in its own coordinates, updated as they move. Null until laid out.
 */
@Stable
internal class ShareRegions {
    var header by mutableStateOf<Rect?>(null)
    var words by mutableStateOf<Rect?>(null)
}

// The Cinematic layout, on the 360 x 640 picture
private val CinematicSide = 34.dp
private val CinematicTop = 70.dp
private val CinematicMarkBottom = 44.dp
private val CinematicMarkGap = 28.dp
private val CinematicHeaderGap = 22.dp
private val CinematicLineGap = 2.dp
private const val CinematicTextSize = 23f
private const val CinematicSmallestText = 12f

/** Room the words get when the song sits with them: the picture less the margins, the mark and the song. */
private val CinematicWordsRoom = ShareHeight - CinematicTop - CinematicMarkBottom - 16.dp - CinematicMarkGap - 38.dp - CinematicHeaderGap

/**
 * The picture, scaled to fit this box with rounded corners. With [capture] on, what it draws is
 * also recorded into the session, unscaled, so Share saves it at full size. [overlay] is drawn on
 * top in the picture's own coordinates but never recorded - the editors' outlines live there.
 */
@Composable
internal fun SharePreview(
    session: LyricsShareSession,
    modifier: Modifier = Modifier,
    /** the style tiles show both styles at once, whatever the session has picked */
    style: ShareStyle = session.style,
    capture: Boolean = false,
    animate: Boolean = true,
    regions: ShareRegions? = null,
    onCardTap: (() -> Unit)? = null,
    overlay: @Composable () -> Unit = {},
) {
    BoxWithConstraints(modifier, contentAlignment = Alignment.Center) {
        val scale = min(maxWidth / ShareWidth, maxHeight / ShareHeight)
        Box(
            Modifier
                .size(ShareWidth * scale, ShareHeight * scale)
                .clip(RoundedCornerShape(26.dp))
                // lays the picture out at its real size, then scales it down from the corner
                .layout { measurable, _ ->
                    val full = Constraints.fixed(ShareWidth.roundToPx(), ShareHeight.roundToPx())
                    val placeable = measurable.measure(full)
                    layout((placeable.width * scale).toInt(), (placeable.height * scale).toInt()) {
                        placeable.placeWithLayer(0, 0) {
                            scaleX = scale
                            scaleY = scale
                            transformOrigin = TransformOrigin(0f, 0f)
                        }
                    }
                },
        ) {
            val layer = rememberGraphicsLayer()
            if (capture) {
                DisposableEffect(layer) {
                    session.capture = layer
                    onDispose { if (session.capture === layer) session.capture = null }
                }
            }
            Box(
                Modifier
                    .fillMaxSize()
                    .then(
                        if (capture) {
                            Modifier.drawWithContent {
                                layer.record { this@drawWithContent.drawContent() }
                                drawLayer(layer)
                            }
                        } else {
                            Modifier
                        },
                    ),
            ) {
                ShareCanvas(session, style, animate = animate, regions = regions, onCardTap = onCardTap)
            }
            overlay()
        }
    }
}

/** The picture at its full [ShareWidth] x [ShareHeight]. */
@Composable
internal fun ShareCanvas(
    session: LyricsShareSession,
    style: ShareStyle,
    animate: Boolean,
    regions: ShareRegions? = null,
    onCardTap: (() -> Unit)? = null,
) {
    val density = LocalDensity.current
    CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale = 1f)) {
        Box(
            Modifier
                .size(ShareWidth, ShareHeight)
                .clipToBounds(),
        ) {
            ShareBackdrop(session, animate)
            when (style) {
                ShareStyle.Card -> CardLayout(session, onCardTap)
                ShareStyle.Cinematic -> CinematicLayout(session, regions)
            }
        }
    }
}

private fun shareText(size: Float, weight: FontWeight = FontWeight.Bold, color: Color, tracking: Float = -0.5f) =
    TextStyle(fontFamily = InterFontFamily, fontWeight = weight, fontSize = size.sp, letterSpacing = tracking.sp, color = color)

@Composable
private fun MusicfyMark(color: Color, size: Float = 14f) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            painter = painterResource(R.drawable.ic_musicfy_mark),
            contentDescription = null,
            tint = color,
            modifier = Modifier.size((size + 2f).dp),
        )
        Spacer(Modifier.width(6.dp))
        Text("Musicfy", style = shareText(size, color = color, tracking = -0.4f))
    }
}

@Composable
private fun SongHeader(song: ShareSong, color: Color, cover: Float, title: Float, modifier: Modifier = Modifier) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = modifier) {
        AsyncImage(
            model = song.thumbnailUrl?.resize(240, 240),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier
                .size(cover.dp)
                .clip(RoundedCornerShape((cover * 0.22f).dp))
                .background(color.copy(alpha = 0.2f)),
        )
        Spacer(Modifier.width(11.dp))
        Column {
            Text(song.title, style = shareText(title, color = color), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                song.artist,
                style = shareText(title * 0.78f, FontWeight.SemiBold, color.copy(alpha = 0.75f), -0.2f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** The card style: the lines on a card in one of the cover's colours, the song on top. */
@Composable
private fun CardLayout(session: LyricsShareSession, onCardTap: (() -> Unit)?) {
    val cardColor = session.cardColorOr(Color(0xFF3A3A3C))
    val ink = if (cardColor.luminance() > 0.55f) Color(0xFF111111) else Color.White
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            Modifier
                .width(ShareWidth * 0.8f)
                .clip(RoundedCornerShape(22.dp))
                .background(cardColor)
                .then(
                    if (onCardTap != null) {
                        Modifier.clickable(remember { MutableInteractionSource() }, indication = null, onClick = onCardTap)
                    } else {
                        Modifier
                    },
                )
                .padding(20.dp),
        ) {
            SongHeader(session.song, ink, cover = 46f, title = 15f)
            Spacer(Modifier.height(18.dp))
            Text(
                session.chosen.joinToString("\n") { it.second },
                style = shareText(21f, color = ink, tracking = -0.7f).copy(lineHeight = 27.sp),
                // a card holds 14 words, so this only cuts in on the greyed-out style tile when
                // more is picked - and keeps the mark below on the card even there
                maxLines = 9,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(22.dp))
            MusicfyMark(ink, size = 13f)
        }
    }
}

/**
 * The cinematic style: the words straight on the background, each one as its look says - bigger,
 * in capitals, glowing. Lines sit on their own, so a big word only pushes its own line apart. The
 * words shrink to fit when there are many, the Musicfy mark always keeps its place at the bottom,
 * and the song slides past the words when it moves above or below them.
 */
@Composable
private fun CinematicLayout(session: LyricsShareSession, regions: ShareRegions?) {
    val ink = contentColorOn(session.background)
    val textSize = rememberCinematicTextSize(session)
    val below = animateFloatAsState(
        if (session.headerBelow) 1f else 0f,
        spring(dampingRatio = 0.8f, stiffness = 240f),
        label = "cinematicHeader",
    )
    Layout(
        contents = listOf(
            {
                SongHeader(
                    session.song,
                    ink,
                    cover = 38f,
                    title = 14f,
                    modifier = if (regions != null) Modifier.onGloballyPositioned { regions.header = it.boundsInParent() } else Modifier,
                )
            },
            {
                Column(
                    verticalArrangement = Arrangement.spacedBy(CinematicLineGap),
                    modifier = if (regions != null) Modifier.onGloballyPositioned { regions.words = it.boundsInParent() } else Modifier,
                ) {
                    session.chosen.forEach { (line, text) ->
                        Text(cinematicLine(session, line, text, ink, textSize), style = shareText(textSize, color = ink, tracking = -1f))
                    }
                }
            },
            { MusicfyMark(ink) },
        ),
        modifier = Modifier.fillMaxSize(),
    ) { (headerPart, wordsPart, markPart), constraints ->
        val side = CinematicSide.roundToPx()
        val loose = Constraints(maxWidth = constraints.maxWidth - 2 * side)
        val header = headerPart.first().measure(loose)
        val words = wordsPart.first().measure(loose)
        val mark = markPart.first().measure(loose)
        layout(constraints.maxWidth, constraints.maxHeight) {
            val markTop = constraints.maxHeight - CinematicMarkBottom.roundToPx() - mark.height
            val gap = CinematicHeaderGap.roundToPx()
            val areaTop = CinematicTop.roundToPx()
            val areaBottom = markTop - CinematicMarkGap.roundToPx()
            val block = header.height + gap + words.height
            val top = areaTop + ((areaBottom - areaTop - block) / 2).coerceAtLeast(0)
            // read here, so the slide only places things again and never recomposes
            val p = below.value
            words.place(side, lerp(top + header.height + gap, top, p))
            header.placeWithLayer(side, lerp(top, top + words.height + gap, p)) {
                // dips back a little as it passes the words, so it reads as going round them
                val dip = 4f * p * (1f - p)
                alpha = 1f - 0.45f * dip
                scaleX = 1f - 0.08f * dip
                scaleY = 1f - 0.08f * dip
                transformOrigin = TransformOrigin(0f, 0.5f)
            }
            mark.place(side, markTop)
        }
    }
}

/**
 * The biggest text size, up to the usual one, at which every picked line fits above the mark. Up
 * to 40 words with big ones mixed in can't all sit at full size.
 */
@Composable
private fun rememberCinematicTextSize(session: LyricsShareSession): Float {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val chosen = session.chosen
    val looks = session.looks.toMap()
    return remember(chosen, looks, density) {
        val width = with(density) { (ShareWidth - CinematicSide * 2).roundToPx() }
        val room = with(density) { CinematicWordsRoom.toPx() }
        val lineGap = with(density) { CinematicLineGap.toPx() }
        fun heightAt(size: Float): Float = chosen.sumOf { (line, text) ->
            measurer.measure(
                cinematicLine(session, line, text, Color.White, size),
                style = shareText(size, color = Color.White, tracking = -1f),
                constraints = Constraints(maxWidth = width),
            ).size.height
        } + lineGap * (chosen.size - 1).coerceAtLeast(0)

        val full = heightAt(CinematicTextSize)
        if (full <= room) return@remember CinematicTextSize
        // text area grows with the square of its size, so this lands close; then step down to be sure
        var size = (CinematicTextSize * sqrt(room / full)).coerceAtLeast(CinematicSmallestText)
        while (size > CinematicSmallestText && heightAt(size) > room) size -= 1f
        size
    }
}

internal fun cinematicLine(
    session: LyricsShareSession,
    line: Int,
    text: String,
    ink: Color,
    base: Float = CinematicTextSize,
): AnnotatedString =
    buildAnnotatedString {
        wordsOf(text).forEachIndexed { i, word ->
            if (i > 0) append(' ')
            val look = session.look(WordKey(line, i))
            withStyle(wordSpan(look, ink, base)) { append(if (look.caps) word.uppercase() else word) }
        }
    }

internal fun wordSpan(look: WordLook, ink: Color, base: Float = CinematicTextSize): SpanStyle = SpanStyle(
    fontSize = if (look.big) (base * 2.1f).sp else base.sp,
    fontWeight = if (look.big) FontWeight.ExtraBold else FontWeight.Bold,
    letterSpacing = if (look.big) (-2.6).sp else (-1).sp,
    shadow = if (look.glow) Shadow(ink.copy(alpha = 0.9f), Offset.Zero, blurRadius = 30f) else null,
)
