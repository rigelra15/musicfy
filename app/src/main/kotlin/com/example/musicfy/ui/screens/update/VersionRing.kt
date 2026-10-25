// VersionRing.kt

package com.example.musicfy.ui.screens.update

import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.Typeface
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.PI
import kotlin.math.floor

/**
 * The thick ring from the mock with [text] running round it again and again, turning slowly for
 * as long as it's on screen. The ring and letters are recorded once; the turning only rotates
 * the layer, so it costs nothing to redraw.
 */
@Composable
fun VersionRing(
    text: String,
    modifier: Modifier = Modifier,
    radius: Dp = 140.dp,
    band: Dp = 46.dp,
    ringColor: Color = Color.White.copy(alpha = 0.08f),
    textColor: Color = Color.White.copy(alpha = 0.3f),
    turnMillis: Int = 26_000,
) {
    val turn by rememberInfiniteTransition(label = "versionRing").animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(turnMillis, easing = LinearEasing), RepeatMode.Restart),
        label = "versionRingTurn",
    )
    Box(
        modifier
            .size(radius * 2)
            .graphicsLayer { rotationZ = turn }
            .drawWithCache {
                val bandPx = band.toPx()
                val mid = radius.toPx() - bandPx / 2f
                val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    color = textColor.toArgb()
                    typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
                    textSize = bandPx * 0.5f
                }
                // runs the way the mock reads: down the left side, M at the top
                val path = Path().apply { addCircle(size.width / 2f, size.height / 2f, mid, Path.Direction.CCW) }
                val circumference = (2 * PI * mid).toFloat()
                val unit = "$text  ·  "
                val repeats = floor(circumference / paint.measureText(unit)).toInt().coerceAtLeast(1)
                val step = circumference / repeats
                // the baseline sits half a capital below the middle of the band, so letters centre in it
                val caps = Rect().also { paint.getTextBounds("M", 0, 1, it) }
                val lift = caps.height() / 2f
                onDrawBehind {
                    drawCircle(ringColor, radius = mid, style = Stroke(bandPx))
                    drawIntoCanvas { canvas ->
                        repeat(repeats) { i ->
                            canvas.nativeCanvas.drawTextOnPath(unit, path, i * step, lift, paint)
                        }
                    }
                }
            },
    )
}
