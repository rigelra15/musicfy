// MorphingCover.kt

package com.example.musicfy.ui.player

import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitHorizontalTouchSlopOrCancellation
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.horizontalDrag
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.statusBars
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.ui.graphics.asComposeRenderEffect
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.nativeCanvas

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.key
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.input.pointer.util.addPointerInputChange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.layout
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.lerp
import androidx.media3.common.Player
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.allowHardware
import coil3.request.crossfade
import coil3.request.transformations
import coil3.size.Precision
import coil3.size.Size as CoilSize
import com.example.musicfy.R
import com.example.musicfy.LocalPlayerConnection
import com.example.musicfy.constants.ThumbnailCornerRadius
import com.example.musicfy.extensions.togglePlayPause
import com.example.musicfy.ui.player.models.TrackInfo
import com.example.musicfy.ui.utils.resize
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.example.musicfy.ui.component.BlurEffectCache
import com.example.musicfy.ui.component.rememberCoverBlurAvailable
import kotlinx.coroutines.flow.collectLatest
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import com.example.musicfy.canvas.CanvasArtwork
import com.example.musicfy.canvas.MonochromeApiCanvas
import com.example.musicfy.applecanvas.AppleMusicCanvasProvider
import com.example.musicfy.LocalGlassState
import com.example.musicfy.constants.CanvasThumbnailAnimationKey
import com.example.musicfy.constants.CanvasWifiOnlyKey
import com.example.musicfy.constants.DisableBlurKey
import com.example.musicfy.constants.ForceYtBackdropBlur1500Key
import com.example.musicfy.constants.PlayVideoBackgroundKey
import com.example.musicfy.constants.DisableVideoAutoplayKey
import com.example.musicfy.utils.YTPlayerUtils
import com.example.musicfy.constants.PlayerBackgroundStyle
import com.example.musicfy.constants.PlayerCoverStyle
import com.example.musicfy.constants.YtVideoBackgroundLyricsSyncKey
import com.example.musicfy.ui.player.customize.DiscCoverStack
import com.example.musicfy.ui.player.customize.PlayerBackgroundContent
import com.example.musicfy.ui.player.customize.CoverGradientBackdrop
import com.example.musicfy.ui.player.customize.coverArtBox
import com.example.musicfy.ui.player.customize.coverArtBoxF
import com.example.musicfy.ui.player.customize.usesBoxedStage
import com.example.musicfy.ui.player.customize.isDisc
import com.example.musicfy.ui.component.ChromeHighlightColor
import com.example.musicfy.ui.component.FrostedChromeGlass
import com.example.musicfy.ui.component.agslRenderEffect
import com.example.musicfy.ui.component.createAgslShader
import com.example.musicfy.ui.component.setAgslUniform
import com.example.musicfy.ui.component.drawGlassNode
import com.example.musicfy.ui.component.glassNodeHasContent
import com.example.musicfy.ui.component.glassNodeHeight
import com.example.musicfy.ui.component.glassNodeWidth
import com.example.musicfy.ui.component.RoundedHighlight
import com.example.musicfy.ui.component.pressBounce
import com.example.musicfy.ui.component.GlassState
import com.example.musicfy.ui.component.glassRoot
import com.example.musicfy.utils.rememberPreference
import androidx.core.content.getSystemService

@Stable
private class MorphEndpoints(
    val miniArtWidth: Dp,
    val miniArtHeight: Dp,
    val miniArtX: Dp,
    val miniArtY: Dp,
    val miniPlayX: Dp,
    val miniPlayY: Dp,
    val miniSkipX: Dp,
    val miniSkipY: Dp,
    val miniTextX: Dp,
    val miniTextWidth: Dp,
    val lyricsArtSize: Dp,
    val lyricsArtX: Dp,
    val lyricsArtY: Dp,
    val fullTextX: Dp,
    val fullTextY: Dp,
    val fullTextWidth: Dp,
    val fullWidth: Dp,

    val fullArtWidth: Dp,
    val fullArtHeight: Dp,
    val fullArtX: Dp,
    val fullArtY: Dp,
    val fullPlayX: Dp,
    val fullPlayY: Dp,
    val miniHeight: Dp,
    val fullHeight: Dp,
)

@Stable
private class MorphEndpointsPx(
    val miniArtWidthPx: Float,
    val miniArtHeightPx: Float,
    val miniArtXPx: Float,
    val miniArtYPx: Float,
    val miniPlayXPx: Float,
    val miniPlayYPx: Float,
    val miniSkipXPx: Float,
    val miniSkipYPx: Float,
    val miniTextXPx: Float,
    val miniTextWidthPx: Float,
    val lyricsArtSizePx: Float,
    val lyricsArtXPx: Float,
    val lyricsArtYPx: Float,
    val fullTextXPx: Float,
    val fullTextYPx: Float,
    val fullTextWidthPx: Float,
    val fullWidthPx: Float,
    val fullArtWidthPx: Float,
    val fullArtHeightPx: Float,
    val fullArtXPx: Float,
    val fullArtYPx: Float,
    val fullPlayXPx: Float,
    val fullPlayYPx: Float,
    val miniHeightPx: Float,
    val fullHeightPx: Float,
    /** the cover's box is a square stage, not the edge-to-edge region */
    val boxedStage: Boolean,
    val statusTopPx: Float,
    /** 1dp in px */
    val dpPx: Float,
    /** how far the controls under the cover were moved, px down; read while laying out */
    val coverOffset: () -> Float,
) {
    /** the full-size cover's box (x, y, width, height), its region moved with the controls under it */
    fun fullArt(): FloatArray {
        val offset = coverOffset()
        if (offset == 0f) return floatArrayOf(fullArtXPx, fullArtYPx, fullArtWidthPx, fullArtHeightPx)
        val box = coverArtBoxF(boxedStage, fullWidthPx, fullHeightPx, statusTopPx, dpPx, offset)
        return floatArrayOf(box.x, box.y, box.width, box.height)
    }
}

private enum class MorphElement { ART, PLAY, SKIP, TEXT, BACKDROP }

private const val PILL_FADE_END = 0.15f

private val LyricsHeaderCornerRadius = 12.dp

/*
 * Where the cover actually lands in lyrics mode. LyricsScreen's header has to place its hitbox and
 * its menu button against these exact values - the artwork is drawn by the morph layer, not by the
 * header, so the two are only aligned if they agree on the numbers. They previously did not: the
 * header put its 60dp hitbox at statusBar + 14dp while the art rendered at statusBar + 28dp, so
 * taps landed above the artwork and the menu sat 14dp high of the cover's centre.
 */
internal val LyricsHeaderArtSize = 60.dp
internal val LyricsHeaderArtX = 36.dp
internal val LyricsHeaderArtTopFromStatusBar = 28.dp

private val SquaredCoverCornerRadius = 22.dp

private val TurntableDim = Color.Black.copy(alpha = 0.58f)

private fun lerpF(start: Float, stop: Float, fraction: Float): Float =
    start + (stop - start) * fraction

private fun discWeight(
    progressProvider: () -> Float,
    lyricsProgressProvider: () -> Float,
): Float {
    val expanded = ((progressProvider() - 0.55f) / 0.30f).coerceIn(0f, 1f)
    val lyrics = ((lyricsProgressProvider() - 0.10f) / 0.40f).coerceIn(0f, 1f)
    return expanded * (1f - lyrics)
}

private fun Modifier.morphLayout(
    progressProvider: () -> Float,
    horizontalOffsetProvider: () -> Float,
    endpointsPx: MorphEndpointsPx,
    element: MorphElement,
    lyricsProgressProvider: () -> Float = { 0f },
) = this.layout { measurable, constraints ->
    val p = progressProvider()
    val hOffset = horizontalOffsetProvider()

    val (x, y, w, h) = when (element) {
        MorphElement.ART -> {
            val (fullX, fullY, fullW, fullH) = endpointsPx.fullArt()
            val artW = lerpF(endpointsPx.miniArtWidthPx, fullW, p)
            val artH = lerpF(endpointsPx.miniArtHeightPx, fullH, p)
            val artX = lerpF(endpointsPx.miniArtXPx, fullX, p) + hOffset
            val artY = lerpF(endpointsPx.miniArtYPx, fullY, p)

            val lp = lyricsProgressProvider()
            if (lp <= 0f) {
                floatArrayOf(artX, artY, artW, artH)
            } else {

                val lyricsX = lerpF(endpointsPx.miniArtXPx, endpointsPx.lyricsArtXPx, p) + hOffset
                val lyricsY = lerpF(endpointsPx.miniArtYPx, endpointsPx.lyricsArtYPx, p)
                val lyricsW = lerpF(endpointsPx.miniArtWidthPx, endpointsPx.lyricsArtSizePx, p)
                val lyricsH = lerpF(endpointsPx.miniArtHeightPx, endpointsPx.lyricsArtSizePx, p)
                floatArrayOf(
                    lerpF(artX, lyricsX, lp),
                    lerpF(artY, lyricsY, lp),
                    lerpF(artW, lyricsW, lp),
                    lerpF(artH, lyricsH, lp),
                )
            }
        }
        MorphElement.PLAY -> {
            val playX = lerpF(endpointsPx.miniPlayXPx, endpointsPx.fullPlayXPx, p)
            val playY = lerpF(endpointsPx.miniPlayYPx, endpointsPx.fullPlayYPx, p)
            floatArrayOf(playX, playY, -1f, -1f)
        }
        MorphElement.SKIP -> {
            val skipX = lerpF(endpointsPx.miniSkipXPx, endpointsPx.fullPlayXPx + 80f, p)
            val skipY = lerpF(endpointsPx.miniSkipYPx, endpointsPx.fullPlayYPx, p)
            floatArrayOf(skipX, skipY, -1f, -1f)
        }
        MorphElement.TEXT -> {

            val textX = lerpF(endpointsPx.miniTextXPx, endpointsPx.fullTextXPx, p) + hOffset
            val textY = lerpF(0f, endpointsPx.fullTextYPx + endpointsPx.coverOffset(), p)
            val textW = lerpF(endpointsPx.miniTextWidthPx, endpointsPx.fullTextWidthPx, p)
            floatArrayOf(textX, textY, textW, endpointsPx.miniHeightPx)
        }
        MorphElement.BACKDROP -> {

            val backdropH = lerpF(endpointsPx.miniHeightPx, endpointsPx.fullHeightPx, p)
            floatArrayOf(0f, 0f, endpointsPx.fullWidthPx, backdropH)
        }
    }

    val childConstraints = if (w > 0f && h > 0f) {
        Constraints.fixed(w.toInt().coerceAtLeast(1), h.toInt().coerceAtLeast(1))
    } else {
        constraints
    }

    val placeable = measurable.measure(childConstraints)
    layout(constraints.maxWidth, constraints.maxHeight) {
        placeable.place(x.toInt(), y.toInt())
    }
}

@Composable
fun MorphingCover(
    progressProvider: () -> Float,
    horizontalOffsetProvider: () -> Float,
    trackInfo: TrackInfo,
    isPlaying: Boolean,
    playbackState: Int,
    maxWidth: Dp,
    maxHeight: Dp,
    collapsedBound: Dp,
    pureBlack: Boolean,
    glassState: GlassState,
    modifier: Modifier = Modifier,

    lyricsProgressProvider: () -> Float = { 0f },

    forceVideoBackground: Boolean = false,

    coverStyle: PlayerCoverStyle = PlayerCoverStyle.EDGE_TO_EDGE,

    backgroundStyle: PlayerBackgroundStyle = PlayerBackgroundStyle.COVER_GRADIENT,

    editMode: Boolean = false,

    onLongPressCover: (() -> Unit)? = null,

    /** Double tap on the full-size cover, with where it landed in root coordinates (the like heart starts there). */
    onDoubleTapCover: ((androidx.compose.ui.geometry.Offset) -> Unit)? = null,

    onArtBoundsChanged: ((androidx.compose.ui.geometry.Rect) -> Unit)? = null,

    /** The player studio's hold on the art: where it's measured, and the layer that moves it into the editor. */
    studioArtModifier: Modifier = Modifier,
    /** The editor's top bar frosts the cover, so the glass keeps capturing while it's up. */
    glassActiveInEdit: () -> Boolean = { false },
    /**
     * Another player style is the live one and draws the whole open player itself. Only the mini
     * player's part of this stays: the thumbnail, which fades out as the sheet opens. The flagship's
     * backdrop, canvas, video and their clocks don't run at all.
     */
    alternateStyle: Boolean = false,
    /**
     * How far the controls under the cover were moved, px down (up when negative): its region
     * ends where they start, so the cover zooms with them. Read while laying out only.
     */
    coverOffsetProvider: () -> Float = { 0f },
) {
    val playerConnection = LocalPlayerConnection.current
    val density = LocalDensity.current
    val statusBarTop = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()

    val isDiscStyle = coverStyle.isDisc && !alternateStyle

    // Without blur the seam can't soften the edge-to-edge cover's bottom into the backdrop, so the
    // cover fades its own bottom edge out instead - picture, canvas and video alike.
    val fadeCoverEdge = !rememberCoverBlurAvailable() && coverStyle == PlayerCoverStyle.EDGE_TO_EDGE

    val playVideoPref by rememberPreference(PlayVideoBackgroundKey, defaultValue = false)
    val disableVideoAutoplay by rememberPreference(DisableVideoAutoplayKey, defaultValue = false)
    val currentMetadata by (playerConnection?.mediaMetadata ?: remember { kotlinx.coroutines.flow.MutableStateFlow(null) })
        .collectAsState()
    // a track that is a video itself (a music video or live row, the Videos search tab) plays that
    // video here on its own; songs only get one when the video background setting asks for it
    val trackIsVideo = !disableVideoAutoplay &&
        currentMetadata?.id == trackInfo.mediaId &&
        currentMetadata?.isVideoSong == true
    val playVideoBackground = !alternateStyle && (forceVideoBackground || playVideoPref || trackIsVideo)
    var videoInfo by remember(trackInfo.mediaId) { mutableStateOf<OfficialMusicVideo?>(null) }
    LaunchedEffect(trackInfo.mediaId, trackInfo.title, trackInfo.artist, playVideoBackground, trackIsVideo) {
        val mediaId = trackInfo.mediaId
        val titleStr = trackInfo.title
        val artistStr = trackInfo.artist
        if (!playVideoBackground || mediaId.isBlank()) {
            videoInfo = null
            return@LaunchedEffect
        }
        if (trackIsVideo) {
            // the audio is this very video, so its own stream lines up exactly and needs no search
            val key = "self:$mediaId"
            if (YouTubeVideoUrlCache.contains(key)) {
                videoInfo = YouTubeVideoUrlCache.get(key)
                return@LaunchedEffect
            }
            val own = withContext(Dispatchers.IO) {
                YTPlayerUtils.resolveVideoStreamUrl(mediaId).getOrNull()?.let { OfficialMusicVideo(mediaId, it) }
            }
            YouTubeVideoUrlCache.put(key, own)
            videoInfo = own
            return@LaunchedEffect
        }
        if (titleStr.isBlank() || artistStr.isBlank()) {
            videoInfo = null
            return@LaunchedEffect
        }
        if (YouTubeVideoUrlCache.contains(mediaId)) {
            videoInfo = YouTubeVideoUrlCache.get(mediaId)
            return@LaunchedEffect
        }
        val resolved = withContext(Dispatchers.IO) { findOfficialMusicVideo(titleStr, artistStr) }
        YouTubeVideoUrlCache.put(mediaId, resolved)
        videoInfo = resolved
    }

    val isVideoActive = !isDiscStyle && playVideoBackground && videoInfo != null
    val targetMiniArtWidth = if (isVideoActive) (48.dp * 16f / 9f) else 48.dp
    val animatedMiniArtWidth by animateDpAsState(
        targetValue = targetMiniArtWidth,
        animationSpec = tween(durationMillis = 350, easing = FastOutSlowInEasing),
        label = "miniArtWidth"
    )

    val endpoints = remember(maxWidth, maxHeight, statusBarTop, coverStyle, animatedMiniArtWidth) {
        val miniHeight = 64.dp
        val miniArtWidth = animatedMiniArtWidth
        val miniArtHeight = 48.dp
        // 8dp in from the pill's edge, as from its top and bottom, so the cover lines up with the
        // nav bar's first tab highlight right under it
        val miniArtX = 32.dp
        val miniArtY = (miniHeight - miniArtHeight) / 2

        val miniPlaySize = 36.dp
        val miniSkipSize = 36.dp
        val miniSkipX = maxWidth - 36.dp - miniSkipSize
        val miniSkipY = (miniHeight - miniSkipSize) / 2
        val miniPlayX = miniSkipX - 8.dp - miniPlaySize
        val miniPlayY = (miniHeight - miniPlaySize) / 2

        val miniTextX = miniArtX + miniArtWidth + 12.dp
        val miniTextWidth = (miniPlayX - 10.dp - miniTextX).coerceAtLeast(0.dp)

        val artBox = coverArtBox(coverStyle, maxWidth, maxHeight, statusBarTop)

        MorphEndpoints(
            miniArtWidth = miniArtWidth,
            miniArtHeight = miniArtHeight,
            miniArtX = miniArtX,
            miniArtY = miniArtY,
            miniPlayX = miniPlayX,
            miniPlayY = miniPlayY,
            miniSkipX = miniSkipX,
            miniSkipY = miniSkipY,
            miniTextX = miniTextX,
            miniTextWidth = miniTextWidth,

            lyricsArtSize = LyricsHeaderArtSize,
            lyricsArtX = LyricsHeaderArtX,
            lyricsArtY = statusBarTop + LyricsHeaderArtTopFromStatusBar,
            fullTextX = 24.dp,
            fullTextY = maxHeight * 0.63f + 24.dp,
            fullTextWidth = (maxWidth - 48.dp).coerceAtLeast(0.dp),
            fullWidth = maxWidth,
            fullArtWidth = artBox.width,
            fullArtHeight = artBox.height,
            fullArtX = artBox.x,
            fullArtY = artBox.y,
            fullPlayX = (maxWidth / 2) - 18.dp,
            fullPlayY = maxHeight - 200.dp,
            miniHeight = miniHeight,
            fullHeight = maxHeight,
        )
    }

    val currentCoverOffset by androidx.compose.runtime.rememberUpdatedState(coverOffsetProvider)
    val endpointsPx = remember(endpoints, density) {
        with(density) {
            MorphEndpointsPx(
                miniArtWidthPx = endpoints.miniArtWidth.toPx(),
                miniArtHeightPx = endpoints.miniArtHeight.toPx(),
                miniArtXPx = endpoints.miniArtX.toPx(),
                miniArtYPx = endpoints.miniArtY.toPx(),
                miniPlayXPx = endpoints.miniPlayX.toPx(),
                miniPlayYPx = endpoints.miniPlayY.toPx(),
                miniSkipXPx = endpoints.miniSkipX.toPx(),
                miniSkipYPx = endpoints.miniSkipY.toPx(),
                miniTextXPx = endpoints.miniTextX.toPx(),
                miniTextWidthPx = endpoints.miniTextWidth.toPx(),
                lyricsArtSizePx = endpoints.lyricsArtSize.toPx(),
                lyricsArtXPx = endpoints.lyricsArtX.toPx(),
                lyricsArtYPx = endpoints.lyricsArtY.toPx(),
                fullTextXPx = endpoints.fullTextX.toPx(),
                fullTextYPx = endpoints.fullTextY.toPx(),
                fullTextWidthPx = endpoints.fullTextWidth.toPx(),
                fullWidthPx = endpoints.fullWidth.toPx(),
                fullArtWidthPx = endpoints.fullArtWidth.toPx(),
                fullArtHeightPx = endpoints.fullArtHeight.toPx(),
                fullArtXPx = endpoints.fullArtX.toPx(),
                fullArtYPx = endpoints.fullArtY.toPx(),
                fullPlayXPx = endpoints.fullPlayX.toPx(),
                fullPlayYPx = endpoints.fullPlayY.toPx(),
                miniHeightPx = endpoints.miniHeight.toPx(),
                fullHeightPx = endpoints.fullHeight.toPx(),
                boxedStage = coverStyle.usesBoxedStage,
                statusTopPx = statusBarTop.toPx(),
                dpPx = density.density,
                coverOffset = { currentCoverOffset() },
            )
        }
    }

    val miniPlaySize = 36.dp

    val longPressEnabled by remember {
        derivedStateOf { progressProvider() > 0.9f && lyricsProgressProvider() < 0.1f }
    }
    // Read through these inside the gesture detector, which is keyed on nothing: the callers pass
    // fresh lambdas on every recomposition, and restarting the detector for each one would drop
    // the second tap of a double tap.
    val currentOnLongPress by androidx.compose.runtime.rememberUpdatedState(onLongPressCover)
    val currentOnDoubleTap by androidx.compose.runtime.rememberUpdatedState(onDoubleTapCover)
    val artCoordinates = remember { arrayOfNulls<androidx.compose.ui.layout.LayoutCoordinates>(1) }

    val discSpinActive by remember(editMode) {
        derivedStateOf { !editMode && progressProvider() > 0.9f && lyricsProgressProvider() < 0.6f }
    }

    // Swiping the full-size cover sideways slides the player's row of songs under the finger (see
    // SongCarousel): the next song's cover comes in as this one goes, and letting go carries on into
    // it. Only while the cover is the full-size one - the mini player's swipe is the sheet's, and in
    // the lyrics header it's a thumbnail. On a record, the swipe runs the row of records instead,
    // the arm and the room staying put.
    val carousel = LocalSongCarousel.current
    val currentCarousel by androidx.compose.runtime.rememberUpdatedState(carousel)
    val coverSwipeEnabled by remember(editMode) {
        derivedStateOf { !editMode && progressProvider() > 0.98f && lyricsProgressProvider() < 0.02f }
    }
    val currentPlayerConnection by androidx.compose.runtime.rememberUpdatedState(playerConnection)
    val swipesDisc by androidx.compose.runtime.rememberUpdatedState(isDiscStyle)
    val currentCoverStyle by androidx.compose.runtime.rememberUpdatedState(coverStyle)

    val warpShader = remember {
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            createAgslShader(
                """
                uniform float2 resolution;
                uniform float time;
                uniform shader image;

                half4 main(float2 fragCoord) {
                    float2 uv = fragCoord / resolution;
                    float t = time * 0.5;

                    float2 warpOffset = float2(
                        sin(uv.y * 3.0 + t) * 0.05 + cos(uv.x * 2.0 - t * 0.6) * 0.04,
                        cos(uv.x * 3.0 + t * 0.7) * 0.05 + sin(uv.y * 2.5 + t * 0.9) * 0.04
                    );

                    float2 distortedCoord = fragCoord + warpOffset * resolution;
                    return image.eval(distortedCoord);
                }
                """.trimIndent()
            )
        } else {
            null
        }
    }

    val warpTimeState = remember { androidx.compose.runtime.mutableFloatStateOf(0f) }
    // Started and stopped from a flow, not keyed on a derived state: read in composition, its flip
    // recomposed all of this in the first frames of every open.
    LaunchedEffect(editMode, alternateStyle) {
        snapshotFlow { !alternateStyle && !editMode && progressProvider() > 0.02f && lyricsProgressProvider() < 0.6f }
            .collectLatest { active ->
                if (!active) return@collectLatest
                // ends when the flow moves on: collectLatest cancels this at the frame wait
                while (true) {
                    androidx.compose.animation.core.withInfiniteAnimationFrameNanos { frameTimeNanos ->

                        warpTimeState.floatValue = ((frameTimeNanos / 1_000_000f) * (100f / 100_000f)).mod(100f)
                    }
                }
            }
    }


    val lyricsSyncEnabled by rememberPreference(YtVideoBackgroundLyricsSyncKey, defaultValue = false)
    val currentLyrics by playerConnection?.currentLyrics?.collectAsState(initial = null)
        ?: androidx.compose.runtime.mutableStateOf(null)
    var lyricVideoAnchors by remember(trackInfo.mediaId) { mutableStateOf<List<LyricVideoAnchor>?>(null) }
    LaunchedEffect(videoInfo?.videoId, currentLyrics?.lyrics, lyricsSyncEnabled) {
        val mediaId = trackInfo.mediaId
        val videoId = videoInfo?.videoId
        val lyricsRaw = currentLyrics?.lyrics
            ?.takeIf { it.isNotBlank() && it != com.example.musicfy.db.entities.LyricsEntity.LYRICS_NOT_FOUND }
        // the track's own video is already in step with it; anchors are for lining up a separate one
        if (!lyricsSyncEnabled || videoId == null || videoId == mediaId || lyricsRaw == null) {
            lyricVideoAnchors = null
            return@LaunchedEffect
        }
        if (LyricVideoAnchorCache.contains(mediaId)) {
            lyricVideoAnchors = LyricVideoAnchorCache.get(mediaId)
            return@LaunchedEffect
        }
        val anchors = withContext(Dispatchers.IO) {
            runCatching { buildLyricVideoAnchors(videoId, lyricsRaw) }.getOrNull()
        }
        LyricVideoAnchorCache.put(mediaId, anchors)
        lyricVideoAnchors = anchors
    }

    val videoGlassState = remember(trackInfo.mediaId) { GlassState() }

    // (The mini player's press tilt is the sheet's own now - see BottomSheet - so it tilts the
    // pill's outline with what's in it, and eases out into the open instead of snapping off.)
    Box(
        modifier = modifier
            .glassRoot(glassState, isActive = { !editMode || glassActiveInEdit() })
    ) {

        SheetPillGlass(
            progressProvider = progressProvider,
            endpointsPx = endpointsPx,
            pureBlack = pureBlack,
        )

        SheetBackdrop(
            progressProvider = progressProvider,
            endpointsPx = endpointsPx,
            trackInfo = trackInfo,
            alternateStyle = alternateStyle,
            backgroundStyle = backgroundStyle,
            coverStyle = coverStyle,
            pureBlack = pureBlack,
            // The video's backdrop is its reflection under a full-width video, so only the
            // edge-to-edge cover has one. The squared cover's reflection covered a strip below it,
            // and the discs play no video at all - both faded the cover's colours out for a bare
            // grey surface on every song with a video.
            playVideoBackground = playVideoBackground && coverStyle == PlayerCoverStyle.EDGE_TO_EDGE,
            videoInfo = videoInfo,
            videoGlassState = videoGlassState,
            maxWidth = maxWidth,
            maxHeight = maxHeight,
            warpShader = warpShader,
            warpTimeState = warpTimeState,
            lyricsProgressProvider = lyricsProgressProvider,
        )

        val isEdgeToEdge = coverStyle == PlayerCoverStyle.EDGE_TO_EDGE
        // a record player stays put when paused: the record stops, the arm says where it is
        val targetPauseScale = when {
            coverStyle == PlayerCoverStyle.TURNTABLE -> 1.0f
            isPlaying -> if (isEdgeToEdge) 1.05f else 1.0f
            else -> if (isEdgeToEdge) 1.0f else 0.94f
        }
        val animatedPauseScale by animateFloatAsState(
            targetValue = targetPauseScale,
            animationSpec = tween(400, easing = FastOutSlowInEasing),
            label = "pauseScale"
        )
        val targetPauseSaturation = if (isPlaying) 1.0f else 0.80f
        val animatedPauseSaturation by animateFloatAsState(
            targetValue = targetPauseSaturation,
            animationSpec = tween(400, easing = FastOutSlowInEasing),
            label = "pauseSaturation"
        )

        // Behind another style the cover is only the mini player's thumbnail, faded out by 40% open,
        // where the style itself shows. It stays composed above that, at alpha 0: built at 42% it was
        // a heavy frame in the middle of every close, and dropped there in the middle of every open.
        if (trackInfo.thumbnailUrl != null || isDiscStyle) {
            Box(
                modifier = Modifier
                    .morphLayout(
                        progressProvider = progressProvider,
                        horizontalOffsetProvider = horizontalOffsetProvider,
                        endpointsPx = endpointsPx,
                        element = MorphElement.ART,
                        lyricsProgressProvider = lyricsProgressProvider,
                    )
                    .then(studioArtModifier)
                    .graphicsLayer {
                        val p = progressProvider()
                        if (alternateStyle) alpha = (1f - p / 0.4f).coerceIn(0f, 1f)

                        scaleX = animatedPauseScale
                        scaleY = animatedPauseScale
                        // A colour filter on a layer forces it offscreen - the whole cover rendered
                        // into a buffer of its own every frame of the morph. While playing the
                        // matrix is the identity anyway, so it's only set while the cover is
                        // (or is turning) grey. A record greys its own pictures instead: offscreen,
                        // this layer kept nothing outside its box, and a big record (or any
                        // record's shadow) was cut flat along the bottom the moment it paused.
                        val clipped = !isDiscStyle ||
                            discWeight(progressProvider, lyricsProgressProvider) < 0.5f
                        colorFilter = if (clipped && animatedPauseSaturation < 0.999f) {
                            ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(animatedPauseSaturation) })
                        } else {
                            null
                        }

                        clip = clipped

                        val expandedRadius = if (coverStyle == PlayerCoverStyle.SQUARED) {
                            SquaredCoverCornerRadius
                        } else {
                            0.dp
                        }
                        val base = lerp(ThumbnailCornerRadius, expandedRadius, p)
                        shape = RoundedCornerShape(lerp(base, LyricsHeaderCornerRadius, lyricsProgressProvider()))
                    }
                    .then(

                        if (longPressEnabled && (onLongPressCover != null || onDoubleTapCover != null)) {
                            Modifier
                                .pointerInput(isDiscStyle) {
                                    val likeAt: (Offset) -> Unit = { position ->
                                        val coordinates = artCoordinates[0]
                                        val onDoubleTap = currentOnDoubleTap
                                        if (coordinates != null && coordinates.isAttached && onDoubleTap != null) {
                                            onDoubleTap(coordinates.localToRoot(position))
                                        }
                                    }
                                    if (isDiscStyle) {
                                        // a record isn't the background: holding it opens nothing,
                                        // and a touch beside it (the room round a big record) is
                                        // left for the player's own hold
                                        detectDiscDoubleTap(
                                            onDisc = { p -> com.example.musicfy.ui.player.customize.isOnDisc(currentCoverStyle, androidx.compose.ui.geometry.Size(size.width.toFloat(), size.height.toFloat()), p) },
                                            onDoubleTap = likeAt,
                                        )
                                    } else {
                                        detectTapGestures(
                                            onLongPress = { currentOnLongPress?.invoke() },
                                            onDoubleTap = likeAt,
                                        )
                                    }
                                }
                                // Same layer as the detector, so its tap positions convert exactly.
                                .onGloballyPositioned { artCoordinates[0] = it }
                        } else Modifier
                    )
                    .pointerInput(Unit) {
                        val velocityTracker = VelocityTracker()
                        // A flick faster than this skips however short it was.
                        val flingPx = 500.dp.toPx()

                        awaitEachGesture {
                            val down = awaitFirstDown(requireUnconsumed = false)
                            // Not consumed unless this is a swipe on the full-size cover - the
                            // mini player's swipe and the vertical drags belong to the sheet.
                            if (!coverSwipeEnabled) return@awaitEachGesture

                            var travelled = 0f
                            val slopped = awaitHorizontalTouchSlopOrCancellation(down.id) { change, over ->
                                change.consume()
                                travelled += over
                            } ?: return@awaitEachGesture

                            val player = currentPlayerConnection?.player
                            val row = currentCarousel ?: return@awaitEachGesture
                            // how far the finger goes for one song: a record's spacing in the row,
                            // or the cover's own width
                            val spacing = if (swipesDisc) {
                                com.example.musicfy.ui.player.customize.discSpacingPx(
                                    currentCoverStyle,
                                    androidx.compose.ui.geometry.Size(size.width.toFloat(), size.height.toFloat()),
                                )
                            } else {
                                size.width.toFloat()
                            }
                            val hasPrevious = player?.hasPreviousMediaItem() == true
                            val hasNext = player?.hasNextMediaItem() == true
                            velocityTracker.resetTracking()
                            velocityTracker.addPointerInputChange(slopped)
                            row.startDrag()
                            row.dragTo(travelled, spacing, hasPrevious, hasNext)

                            val completed = horizontalDrag(slopped.id) { change ->
                                change.consume()
                                velocityTracker.addPointerInputChange(change)
                                travelled += change.positionChange().x
                                row.dragTo(travelled, spacing, hasPrevious, hasNext)
                            }

                            if (!completed) {
                                row.cancelDrag()
                                return@awaitEachGesture
                            }
                            row.release(travelled, velocityTracker.calculateVelocity().x, spacing, flingPx, player)
                        }
                    }
                    .then(
                        if (onArtBoundsChanged != null) {
                            Modifier.onGloballyPositioned { onArtBoundsChanged(it.boundsInRoot()) }
                        } else Modifier
                    )
            ) {

                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .then(
                            if (isDiscStyle) {
                                Modifier.graphicsLayer {
                                    alpha = 1f - discWeight(progressProvider, lyricsProgressProvider)
                                }
                            } else Modifier
                        )
                        .coverMorphFade(
                            // The sides dissolve into the backdrop while the cover flies between
                            // the mini player and the full player - none at either end, so it
                            // leaves the pill and lands as sharp as it sits there. Not on the way
                            // into the lyrics header, which is a thumbnail.
                            sides = {
                                coverMorphSideFade(progressProvider()) *
                                    (1f - lyricsProgressProvider()).coerceIn(0f, 1f)
                            },
                            bottom = if (fadeCoverEdge) {
                                {
                                    // Only on the full-size cover, never the mini player's or the
                                    // lyrics header's thumbnail.
                                    val open = ((progressProvider() - 0.5f) / 0.45f).coerceIn(0f, 1f)
                                    open * (1f - lyricsProgressProvider()).coerceIn(0f, 1f)
                                }
                            } else null,
                        )
                ) {

                CarouselPictures(
                    carousel = carousel,
                    fallbackUrl = trackInfo.thumbnailUrl,
                    modifier = Modifier.fillMaxSize(),
                ) { url, pictureModifier ->
                    CoverPicture(thumbnailUrl = url, modifier = pictureModifier)
                }

                // The playing song's canvas and video ride on its cover's page, so a swipe takes
                // them along with the picture under them.
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .graphicsLayer {
                            val o = carousel?.playingOffset ?: 0f
                            translationX = o * size.width
                            alpha = if (kotlin.math.abs(o) >= 1f) 0f else 1f
                        }
                ) {
                    CoverCanvasLayer(
                        trackInfo = trackInfo,
                        alternateStyle = alternateStyle,
                        isDiscStyle = isDiscStyle,
                        editMode = editMode,
                        progressProvider = progressProvider,
                    )

                    if (!isDiscStyle && playVideoBackground && videoInfo != null) {
                        YouTubeVideoBackground(
                            streamUrl = videoInfo?.streamUrl,
                            isPlaying = isPlaying,
                            positionMsProvider = { playerConnection?.player?.currentPosition ?: 0L },
                            lyricVideoAnchors = lyricVideoAnchors,
                            glassState = videoGlassState,
                            modifier = Modifier
                                .fillMaxSize()
                                .graphicsLayer {
                                    alpha = (1f - lyricsProgressProvider()).coerceIn(0f, 1f)
                                }
                        )
                    }
                }
                }

                if (isDiscStyle) {
                    DiscCoverStack(
                        style = coverStyle,
                        artworkUrl = trackInfo.thumbnailUrl,
                        mediaId = trackInfo.mediaId,
                        isPlaying = isPlaying,
                        spinActive = discSpinActive,
                        editMode = editMode,
                        carousel = carousel,
                        // greyed here only where the cover's layer above doesn't grey it already
                        saturationProvider = {
                            if (discWeight(progressProvider, lyricsProgressProvider) < 0.5f) 1f else animatedPauseSaturation
                        },
                        modifier = Modifier
                            .fillMaxSize()
                            .graphicsLayer { alpha = discWeight(progressProvider, lyricsProgressProvider) },
                    )
                }
            }
        }

        MiniSongInfo(
            carousel = carousel,
            trackInfo = trackInfo,
            progressProvider = progressProvider,
            horizontalOffsetProvider = horizontalOffsetProvider,
            endpointsPx = endpointsPx,
        )

        Box(
            modifier = Modifier
                .morphLayout(
                    progressProvider = progressProvider,
                    horizontalOffsetProvider = { 0f },
                    endpointsPx = endpointsPx,
                    element = MorphElement.PLAY,
                )
                .requiredSize(miniPlaySize)
                .graphicsLayer {
                    val p = progressProvider()
                    val playScale = 1f + (p * 1.0f)
                    scaleX = playScale
                    scaleY = playScale
                    transformOrigin = TransformOrigin(0.5f, 0.5f)
                    alpha = (1f - (p / 0.5f)).coerceIn(0f, 1f)
                }
        ) {
            MiniPlayerButton(
                iconRes = if (playbackState == Player.STATE_ENDED) R.drawable.replay
                else if (isPlaying) R.drawable.ic_untitled_pause
                else R.drawable.ic_untitled_play,
                onClick = { playerConnection?.togglePlayPause() },
            )
        }

        Box(
            modifier = Modifier
                .morphLayout(
                    progressProvider = progressProvider,
                    horizontalOffsetProvider = { 0f },
                    endpointsPx = endpointsPx,
                    element = MorphElement.SKIP,
                )
                .requiredSize(miniPlaySize)
                .graphicsLayer {
                    val p = progressProvider()
                    val playScale = 1f + (p * 1.0f)
                    scaleX = playScale
                    scaleY = playScale
                    transformOrigin = TransformOrigin(0.5f, 0.5f)
                    alpha = (1f - (p / 0.5f)).coerceIn(0f, 1f)
                }
        ) {
            MiniPlayerButton(
                iconRes = R.drawable.ic_untitled_skip_next,
                onClick = { playerConnection?.player?.seekToNext() },
            )
        }
    }
}

/**
 * The round highlight behind a pressed mini player button: the nav bar's highlight colour, 4dp
 * past the 36dp button, so the skip button's sits 8dp in from the pill's end like the cover does.
 */
private val MiniButtonHighlight = RoundedHighlight(
    cornerRadius = 22.dp,
    spillX = 4.dp,
    spillY = 4.dp,
    color = ChromeHighlightColor,
)

/** Play turning into pause (and back) pops the new icon in from small as the old one shrinks away. */
private val MiniIconSwap = (fadeIn(tween(160)) + scaleIn(tween(220, easing = FastOutSlowInEasing), initialScale = 0.6f)) togetherWith
    (fadeOut(tween(120)) + scaleOut(tween(160), targetScale = 0.6f))

/**
 * One of the mini player's buttons. A round highlight comes up under the finger and the button
 * squishes with it, and a new icon pops in instead of swapping in a single frame.
 */
@Composable
private fun MiniPlayerButton(
    iconRes: Int,
    onClick: () -> Unit,
) {
    val interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
    Box(
        modifier = Modifier
            .fillMaxSize()
            .pressBounce(interactionSource)
            .clickable(
                interactionSource = interactionSource,
                indication = MiniButtonHighlight,
                onClick = onClick,
            ),
        contentAlignment = Alignment.Center,
    ) {
        AnimatedContent(
            targetState = iconRes,
            transitionSpec = { MiniIconSwap },
            contentAlignment = Alignment.Center,
            label = "miniPlayerIcon",
        ) { res ->
            Icon(
                painter = painterResource(res),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

/**
 * The mini player's title and artist, flying with the morph and fading out by halfway. Its own
 * function, so the moment it's dropped recomposes only this and not the whole cover.
 */
@Composable
private fun MiniSongInfo(
    carousel: SongCarousel?,
    trackInfo: TrackInfo,
    progressProvider: () -> Float,
    horizontalOffsetProvider: () -> Float,
    endpointsPx: MorphEndpointsPx,
) {
    // The mini player's title is fully faded once the sheet is halfway open, yet it was still
    // measured at a new width (re-laying its text out) and drawn through its offscreen fade
    // layer on every frame of the rest of the open and close.
    val miniTextShown by remember { derivedStateOf { progressProvider() < 0.5f } }
    if (miniTextShown) Box(
        modifier = Modifier
            .morphLayout(
                progressProvider = progressProvider,
                horizontalOffsetProvider = horizontalOffsetProvider,
                endpointsPx = endpointsPx,
                element = MorphElement.TEXT,
            )
            .graphicsLayer {
                alpha = (1f - (progressProvider() / 0.5f)).coerceIn(0f, 1f)

                compositingStrategy = CompositingStrategy.Offscreen
            }
            .drawWithCache {

                val fade = Brush.horizontalGradient(
                    0f to Color.Black,
                    0.82f to Color.Black,
                    1f to Color.Transparent,
                )
                onDrawWithContent {
                    drawContent()
                    drawRect(brush = fade, blendMode = BlendMode.DstIn)
                }
            },
        contentAlignment = Alignment.CenterStart,
    ) {
        // the leaving and arriving songs' lines ride the row with the cover
        if (carousel == null) {
            MiniSongLines(trackInfo.title, trackInfo.artist, trackInfo.album, Modifier)
        } else {
            for (slot in rememberTextSlots(carousel)) {
                key(slot.uid) {
                    MiniSongLines(slot.title, slot.artist, slot.album, Modifier.carouselText(carousel, slot))
                }
            }
        }
    }
}

@Composable
private fun MiniSongLines(title: String, artist: String, album: String, modifier: Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .wrapContentHeight(Alignment.CenterVertically),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            softWrap = false,
        )
        val subtitle = listOf(artist, album)
            .filter { it.isNotBlank() }
            .joinToString(" — ")
        if (subtitle.isNotBlank()) {
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                softWrap = false,
            )
        }
    }
}

@Composable
private fun CoverPicture(thumbnailUrl: String?, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val imageRequest = remember(thumbnailUrl) {
        ImageRequest.Builder(context)
            .data(thumbnailUrl?.resize(1200, 1200))
            .allowHardware(true)
            .size(CoilSize(1200, 1200))
            .precision(Precision.INEXACT)
            .crossfade(false)
            .build()
    }
    AsyncImage(
        model = imageRequest,
        contentDescription = null,
        contentScale = ContentScale.Crop,
        modifier = modifier,
    )
}

@Composable
private fun PlayerBackdropCrossfade(
    trackInfo: TrackInfo,
    backgroundStyle: PlayerBackgroundStyle,
    pureBlack: Boolean,
    playVideoBackground: Boolean,
    videoInfo: OfficialMusicVideo?,
    videoGlassState: GlassState,
    maxWidth: Dp,
    maxHeight: Dp,
    warpShader: Any?,
    warpTimeState: androidx.compose.runtime.MutableFloatState,
    lyricsProgressProvider: () -> Float = { 0f },
    modifier: Modifier = Modifier,
) {
    // The video's backdrop is a blurred reflection of it. Without blur there's nothing to draw it
    // with, so the cover's gradient stays up under the video rather than fading to a bare surface.
    val blurAvailable = rememberCoverBlurAvailable()
    val isVideoActive = playVideoBackground && videoInfo != null && blurAvailable
    val videoAlpha = animateFloatAsState(
        targetValue = if (isVideoActive) 1f else 0f,
        animationSpec = tween(durationMillis = 650, easing = androidx.compose.animation.core.FastOutSlowInEasing),
        label = "videoBackdropAlphaFade"
    )

    // Read in the layers, not here: the lyrics progress moves on every frame of a page opening or
    // closing, and read in composition it recomposed the whole backdrop on each of them
    val currentLyricsProgress = androidx.compose.runtime.rememberUpdatedState(lyricsProgressProvider)
    val effectiveVideoAlpha = { (videoAlpha.value * (1f - currentLyricsProgress.value())).coerceIn(0f, 1f) }
    val videoShown by remember { derivedStateOf { effectiveVideoAlpha() > 0.005f } }

    Box(modifier = modifier) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer { alpha = 1f - effectiveVideoAlpha() }
        ) {
            if (backgroundStyle != PlayerBackgroundStyle.COVER_GRADIENT) {
                // One instance for every song: these styles ease between songs themselves (the
                // Apple Music blobs glide to the new colours), and a second copy built from scratch
                // for the outgoing song has no colours yet - it showed as a dark flash.
                PlayerBackgroundContent(
                    style = backgroundStyle,
                    thumbnailUrl = trackInfo.thumbnailUrl,
                    pureBlack = pureBlack,
                    modifier = Modifier.requiredSize(maxWidth, maxHeight)
                )
            } else {
                CoverBackdropFade(
                    thumbnailUrl = trackInfo.thumbnailUrl,
                    width = maxWidth,
                    height = maxHeight,
                    warpShader = warpShader,
                    warpTimeState = warpTimeState,
                )
            }
        }

        // The video backdrop fades in on top when there is a video, and dissolves when lyrics open.
        if (videoShown) {
            VideoBackdropBlur(
                glassState = videoGlassState,
                modifier = Modifier
                    .requiredSize(maxWidth, maxHeight)
                    .graphicsLayer { alpha = effectiveVideoAlpha() }
            )
        }
    }
}

/**
 * The cover-gradient backdrop, one per song in the player's row, crossfading along it: a swipe
 * toward the next song fades its backdrop in by exactly how far the finger has gone, and a skip
 * from anywhere fades it over as the row slides. The song before and after are kept built, their
 * pictures loaded, so a fade never waits on one or starts from nothing.
 */
@Composable
private fun CoverBackdropFade(
    thumbnailUrl: String?,
    width: Dp,
    height: Dp,
    warpShader: Any?,
    warpTimeState: androidx.compose.runtime.MutableFloatState,
) {
    CarouselCrossfade(
        carousel = LocalSongCarousel.current,
        fallbackUrl = thumbnailUrl,
        modifier = Modifier.fillMaxSize(),
    ) { url ->
        CoverGradientBackdrop(
            thumbnailUrl = url,
            width = width,
            height = height,
            // the clock is the player's (timeProvider), so this one never runs
            animate = false,
            shader = warpShader,
            timeProvider = { warpTimeState.floatValue },
        )
    }
}

@Composable
private fun VideoBackdropBlur(
    glassState: GlassState,
    modifier: Modifier = Modifier,
) {
    val (disableBlur) = rememberPreference(DisableBlurKey, defaultValue = false)
    val (force1500pxBlur) = rememberPreference(ForceYtBackdropBlur1500Key, defaultValue = false)
    if (disableBlur) return

    var backdropPosInWindow by remember { mutableStateOf(Offset.Zero) }

    Box(
        modifier = modifier
            .fillMaxSize()
            .onGloballyPositioned {
                backdropPosInWindow = it.positionInWindow()
            }
    ) {
        androidx.compose.foundation.Canvas(
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer {
                    renderEffect = BlurEffectCache.get(
                        if (force1500pxBlur) 1500f else 120f,
                        android.graphics.Shader.TileMode.CLAMP,
                        allowLargeRadius = true,
                    )
                }
        ) {
            val node = glassState.renderNode
            if (node == null || android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.S) return@Canvas
            if (!glassNodeHasContent(node)) return@Canvas
            val nodeWidth = glassNodeWidth(node).toFloat()
            val nodeHeight = glassNodeHeight(node).toFloat()
            if (nodeWidth <= 0f || nodeHeight <= 0f) return@Canvas

            val videoWindowX = glassState.rootPosition.x
            val videoWindowY = glassState.rootPosition.y
            val hasValidRootPos = videoWindowX > 0f || videoWindowY > 0f

            val videoLeft = if (hasValidRootPos) {
                videoWindowX - backdropPosInWindow.x
            } else {
                (size.width - nodeWidth) / 2f
            }
            val videoTop = if (hasValidRootPos) {
                videoWindowY - backdropPosInWindow.y
            } else {
                (size.height * 0.35f) - (nodeHeight / 2f)
            }

            // Positioned flush at the bottom of the main video frame with slight overlap to prevent any sub-pixel gap
            val reflectionTop = videoTop + nodeHeight - 2f

            // Flipped vertically and scaled slightly up to fill the background seamlessly with zero spacing or gap
            withTransform({
                translate(left = videoLeft, top = reflectionTop)
                scale(scaleX = 1.04f, scaleY = -1.04f, pivot = Offset(nodeWidth / 2f, nodeHeight / 2f))
            }) {
                drawIntoCanvas { it.nativeCanvas.drawGlassNode(node) }
            }
        }
    }
}

/**
 * Fades the cover into the backdrop: its sides by [sides], and its bottom edge by [bottom] (the
 * stand-in for the seam blur when there's no blur); 0 is none. Everything inside fades - picture,
 * canvas and video - since the masks go over the whole layer, and that layer is offscreen only
 * while some fade shows. The masks are one gradient drawn scaled into place, so a frame of the
 * morph allocates nothing for them.
 */
private fun Modifier.coverMorphFade(sides: () -> Float, bottom: (() -> Float)?): Modifier = this
    .graphicsLayer {
        compositingStrategy = if (sides() > 0f || (bottom?.invoke() ?: 0f) > 0f) {
            CompositingStrategy.Offscreen
        } else {
            CompositingStrategy.Auto
        }
    }
    .drawWithContent {
        drawContent()
        val s = sides()
        val b = bottom?.invoke() ?: 0f
        if (s <= 0f && b <= 0f) return@drawWithContent
        drawIntoCanvas { canvas ->
            val native = canvas.nativeCanvas
            val w = size.width
            val h = size.height
            if (s > 0f) {
                val band = w * CoverSideFadeFraction * s
                // left edge, then the right one mirrored onto it
                CoverFadeMask.erase(native, s) { scale(band, h) }
                CoverFadeMask.erase(native, s) { translate(w, 0f); scale(-band, h) }
            }
            if (b > 0f) {
                // turned so the gradient runs up from the bottom edge
                CoverFadeMask.erase(native, b) { translate(0f, h); rotate(-90f); scale(h * CoverEdgeFadeFraction, w) }
            }
        }
    }

/**
 * The cover's fade masks: a unit square whose gradient erases all of what's under it at x = 0 (the
 * edge) and none at x = 1 (inward), eased so the fade has no visible start or end. Placed on an
 * edge by the canvas transform it's drawn with. Only ever drawn on the main thread.
 */
private object CoverFadeMask {
    val paint = android.graphics.Paint().apply {
        val steps = 8
        val colors = IntArray(steps + 1) { i ->
            val t = i / steps.toFloat()
            val eased = t * t * (3f - 2f * t)
            android.graphics.Color.argb(((1f - eased) * 255f).roundToInt(), 0, 0, 0)
        }
        val positions = FloatArray(steps + 1) { it / steps.toFloat() }
        shader = android.graphics.LinearGradient(
            0f, 0f, 1f, 0f, colors, positions, android.graphics.Shader.TileMode.CLAMP,
        )
        xfermode = android.graphics.PorterDuffXfermode(android.graphics.PorterDuff.Mode.DST_OUT)
    }

    /** Erases [strength] (0 to 1) of the gradient's worth under the square [place] puts on an edge. */
    inline fun erase(canvas: android.graphics.Canvas, strength: Float, place: android.graphics.Canvas.() -> Unit) {
        val alpha = (strength * 255f).roundToInt().coerceIn(0, 255)
        if (alpha == 0) return
        paint.alpha = alpha
        val saved = canvas.save()
        canvas.place()
        canvas.drawRect(0f, 0f, 1f, 1f, paint)
        canvas.restoreToCount(saved)
    }
}

/** How much of the cover, from its bottom up, [coverMorphFade] fades without blur. */
private const val CoverEdgeFadeFraction = 0.3f

/** How much of the cover's width, at each side, [coverMorphFade] fades at the height of the morph. */
private const val CoverSideFadeFraction = 0.2f

/** The sheet progress the side fade is full at, starts easing off at, and is gone by. */
private const val SideFadeFullAt = 0.28f
private const val SideFadeEaseAt = 0.55f
private const val SideFadeGoneAt = 0.9f

/**
 * How far the cover's sides are faded at sheet progress [p]: rising as the cover leaves the pill,
 * held through the middle of its flight and gone before it lands. Exactly 0 at both ends, where its
 * layer stops being offscreen.
 */
private fun coverMorphSideFade(p: Float): Float {
    if (p <= 0f || p >= SideFadeGoneAt) return 0f
    val rise = smoothstep(p / SideFadeFullAt)
    val fall = smoothstep((p - SideFadeEaseAt) / (SideFadeGoneAt - SideFadeEaseAt))
    return rise * (1f - fall)
}

private fun smoothstep(x: Float): Float {
    val t = x.coerceIn(0f, 1f)
    return t * t * (3f - 2f * t)
}

/** How far in from each side the sheet's clip sits as the mini player (BottomSheet's pill branch). */
private val SheetPillInset = 24.dp

/** The backdrop over the opening sheet is solid from this progress on, the sheet still little more than the pill. */
private const val BackdropSolidAt = 0.18f

/**
 * The pill's glass is dropped once the sheet is past the first and back as it comes under the
 * second - both where the backdrop over it is already solid ([BackdropSolidAt]).
 */
private const val PillGlassUnmountAbove = 0.21f
private const val PillGlassMountBelow = 0.19f

private fun sheetBackdropAlpha(p: Float): Float =
    FastOutSlowInEasing.transform((p / BackdropSolidAt).coerceIn(0f, 1f))

/**
 * Lays its content out over the shape the sheet is clipped to at [progressProvider] (BottomSheet's
 * pill branch): [insetPx] in from each side and the mini player's height while collapsed, the
 * whole screen once open. Rounded outward, so no hairline of the shape is ever left uncovered.
 */
private fun Modifier.sheetShapeLayout(
    progressProvider: () -> Float,
    endpointsPx: MorphEndpointsPx,
    insetPx: Float,
) = this.layout { measurable, constraints ->
    val p = progressProvider()
    val inset = insetPx * (1f - p)
    val left = kotlin.math.floor(inset).toInt()
    val right = kotlin.math.ceil(endpointsPx.fullWidthPx - inset).toInt()
    val height = kotlin.math.ceil(lerpF(endpointsPx.miniHeightPx, endpointsPx.fullHeightPx, p)).toInt()
    val placeable = measurable.measure(
        Constraints.fixed((right - left).coerceAtLeast(1), height.coerceAtLeast(1))
    )
    layout(constraints.maxWidth, constraints.maxHeight) { placeable.place(left, 0) }
}

/**
 * The mini player's glass, and the opening sheet's material until the backdrop is solid over it.
 *
 * It fills the whole shape the sheet is clipped to as that grows. It used to stay a 64dp pill
 * fixed where the mini player was while the sheet grew round it, the backdrop still faint there
 * until 40% open - the app showed through the opening player - and it was dropped a fifth of the
 * way up, with the backdrop only part-way in.
 */
@Composable
private fun SheetPillGlass(
    progressProvider: () -> Float,
    endpointsPx: MorphEndpointsPx,
    pureBlack: Boolean,
) {
    val glassState = LocalGlassState.current ?: remember { GlassState() }
    // outside the mount check, so the wash keeps its place while the glass comes and goes
    val accentWash = com.example.musicfy.ui.component.rememberChromeAccentWash()
    val mountedHolder = remember { booleanArrayOf(true) }
    val mounted by remember {
        derivedStateOf {
            val progress = progressProvider()
            val next = when {
                progress < PillGlassMountBelow -> true
                progress > PillGlassUnmountAbove -> false
                else -> mountedHolder[0]
            }
            mountedHolder[0] = next
            next
        }
    }
    if (!mounted) return
    val insetPx = with(LocalDensity.current) { SheetPillInset.toPx() }
    // the same frosted glass as the nav bar; the sheet's clip trims the margin it blurs past its edges
    Box(modifier = Modifier.sheetShapeLayout(progressProvider, endpointsPx, insetPx)) {
        FrostedChromeGlass(
            state = glassState,
            pureBlack = pureBlack,
            accentWash = accentWash,
            modifier = Modifier.fillMaxSize(),
        )
    }
}

/**
 * The open player's backdrop, growing with the sheet. Solid by [BackdropSolidAt], over the pill's
 * glass, so the opening player is never see-through. Another style draws the open player itself,
 * over this; for it this is only the plain surface that keeps the opening sheet solid.
 */
@Composable
private fun SheetBackdrop(
    progressProvider: () -> Float,
    endpointsPx: MorphEndpointsPx,
    trackInfo: TrackInfo,
    alternateStyle: Boolean,
    backgroundStyle: PlayerBackgroundStyle,
    coverStyle: PlayerCoverStyle,
    pureBlack: Boolean,
    playVideoBackground: Boolean,
    videoInfo: OfficialMusicVideo?,
    videoGlassState: GlassState,
    maxWidth: Dp,
    maxHeight: Dp,
    warpShader: Any?,
    warpTimeState: androidx.compose.runtime.MutableFloatState,
    lyricsProgressProvider: () -> Float,
) {
    // The cover gradient is composed even while the player is collapsed - at alpha 0 none of it is
    // drawn - so its picture is loaded and it's built before the open's first frame. Built as the
    // sheet started moving, it was a heavy frame among the spring's first, and had no picture to
    // draw for the first of them. The other styles run clocks of their own, so they're still built
    // as the sheet opens.
    val composed by remember(alternateStyle, backgroundStyle) {
        derivedStateOf {
            (!alternateStyle && backgroundStyle == PlayerBackgroundStyle.COVER_GRADIENT) || progressProvider() > 0f
        }
    }
    if (!composed) return
    val containerColor = if (pureBlack) Color.Black else MaterialTheme.colorScheme.surfaceContainer
    Box(
        modifier = Modifier
            .morphLayout(
                progressProvider = progressProvider,
                horizontalOffsetProvider = { 0f },
                endpointsPx = endpointsPx,
                element = MorphElement.BACKDROP,
            )
            .graphicsLayer {
                alpha = sheetBackdropAlpha(progressProvider())
                clip = true
            }
            .background(containerColor)
    ) {
        // A song without art has no cover gradient: the crossfade would hold the last song's
        // picture, so it gets the plain surface.
        if (!alternateStyle && (trackInfo.thumbnailUrl != null || backgroundStyle != PlayerBackgroundStyle.COVER_GRADIENT)) {
            PlayerBackdropCrossfade(
                trackInfo = trackInfo,
                backgroundStyle = backgroundStyle,
                pureBlack = pureBlack,
                playVideoBackground = playVideoBackground,
                videoInfo = videoInfo,
                videoGlassState = videoGlassState,
                maxWidth = maxWidth,
                maxHeight = maxHeight,
                warpShader = warpShader,
                warpTimeState = warpTimeState,
                lyricsProgressProvider = lyricsProgressProvider,
                modifier = Modifier.fillMaxSize()
            )
            // the Turntable sits in a dim room: the cover's colours only as a glow
            if (coverStyle == PlayerCoverStyle.TURNTABLE) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(TurntableDim)
                )
            }
        }
    }
}

/** The sheet progress the canvas is built at: the open spring all but at rest. */
private const val CanvasMountAt = 0.995f

/** The canvas's share of the cover as the sheet closes: all of it near open, none by 60%. */
private fun canvasSheetFade(p: Float): Float = ((p - 0.6f) / 0.35f).coerceIn(0f, 1f)

/**
 * The cover's canvas - an animated cover, with a video player of its own - over the picture.
 *
 * Built once the open spring has all but come to rest, and kept until the sheet is back down.
 * Built at 92% open it was a heavy frame in the middle of the landing; dropped as a close began, its
 * player's release a moment later held up the shrinking cover. Closing, it fades with the sheet
 * instead of on a clock, and stops playing once it's gone.
 */
@Composable
private fun CoverCanvasLayer(
    trackInfo: TrackInfo,
    alternateStyle: Boolean,
    isDiscStyle: Boolean,
    editMode: Boolean,
    progressProvider: () -> Float,
) {
    val context = LocalContext.current
    val playerConnection = LocalPlayerConnection.current
    var canvasArtwork by remember(trackInfo.mediaId) { mutableStateOf<CanvasArtwork?>(null) }
    val canvasEnabled = rememberPreference(CanvasThumbnailAnimationKey, defaultValue = true).value && !alternateStyle
    val canvasWifiOnly by rememberPreference(CanvasWifiOnlyKey, defaultValue = true)
    LaunchedEffect(trackInfo.mediaId, trackInfo.title, trackInfo.artist, canvasEnabled, canvasWifiOnly) {
        val mediaId = trackInfo.mediaId
        val titleStr = trackInfo.title
        val artistStr = trackInfo.artist
        if (!canvasEnabled || mediaId.isBlank() || titleStr.isBlank() || artistStr.isBlank()) return@LaunchedEffect

        val connectivityManager = context.getSystemService<android.net.ConnectivityManager>()
        if (canvasWifiOnly && connectivityManager?.isActiveNetworkMetered == true) return@LaunchedEffect

        val cached = CanvasArtworkPlaybackCache.get(mediaId)
        if (cached != null) {
            canvasArtwork = cached
            return@LaunchedEffect
        }

        val normTitle = normalizeCanvasSongTitle(titleStr)
        val normArtist = normalizeCanvasArtistName(artistStr)
        if (normTitle.length < 2 || normArtist.length < 2) return@LaunchedEffect
        // the song's length tells a studio recording from a live one with the same title
        val durationSec = playerConnection?.mediaMetadata?.value
            ?.takeIf { it.id == mediaId }?.duration?.takeIf { it > 0 }

        val res = withContext(Dispatchers.IO) {
            MonochromeApiCanvas.getBySongArtist(normTitle, normArtist, null, durationSec)
                ?.takeIf { !it.preferredAnimationUrl.isNullOrBlank() }
            ?: AppleMusicCanvasProvider.getBySongArtist(normTitle, normArtist, null, "us", durationSec)
                ?.takeIf { !it.preferredAnimationUrl.isNullOrBlank() }
        }
        if (res != null) {
            CanvasArtworkPlaybackCache.put(mediaId, res)
            canvasArtwork = res
        }
    }

    val mountedHolder = remember { booleanArrayOf(false) }
    val mounted by remember(canvasArtwork, canvasEnabled, isDiscStyle) {
        derivedStateOf {
            val p = progressProvider()
            val next = when {
                isDiscStyle || !canvasEnabled || canvasArtwork?.preferredAnimationUrl == null -> false
                p >= CanvasMountAt -> true
                p <= 0f -> false
                else -> mountedHolder[0]
            }
            mountedHolder[0] = next
            next
        }
    }
    val playing by remember(editMode) {
        derivedStateOf { !editMode && canvasSheetFade(progressProvider()) > 0f }
    }
    AnimatedVisibility(
        visible = mounted,
        enter = fadeIn(tween(300)),
        exit = fadeOut(tween(300)),
        modifier = Modifier.fillMaxSize()
    ) {
        CanvasArtworkPlayer(
            primaryUrl = canvasArtwork?.preferredAnimationUrl,
            fallbackUrl = null,

            isPlaying = playing,
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer { alpha = canvasSheetFade(progressProvider()) }
        )
    }
}

@androidx.annotation.RequiresApi(33)
private fun Modifier.liquidWarpEffect(
    shader: Any,
    time: () -> Float,
): Modifier = this.graphicsLayer {

    shader.setAgslUniform("resolution", size.width, size.height)
    shader.setAgslUniform("time", time())
    renderEffect = agslRenderEffect(shader, "image").asComposeRenderEffect()
    clip = true
}

/**
 * A double tap on the record (for the like); a touch that lands beside it - the room round a big
 * record - is left untouched, so the player's hold sees background there. No hold on the record
 * itself: it isn't the background.
 */
private suspend fun androidx.compose.ui.input.pointer.PointerInputScope.detectDiscDoubleTap(
    onDisc: (Offset) -> Boolean,
    onDoubleTap: (Offset) -> Unit,
) {
    awaitEachGesture {
        val down = awaitFirstDown()
        if (!onDisc(down.position)) return@awaitEachGesture
        down.consume()
        val up = waitForUpOrCancellation() ?: return@awaitEachGesture
        up.consume()
        val second = withTimeoutOrNull(viewConfiguration.doubleTapTimeoutMillis) { awaitFirstDown() } ?: return@awaitEachGesture
        if ((second.position - down.position).getDistance() > viewConfiguration.touchSlop * 4f) return@awaitEachGesture
        second.consume()
        val secondUp = waitForUpOrCancellation() ?: return@awaitEachGesture
        secondUp.consume()
        onDoubleTap(secondUp.position)
    }
}
