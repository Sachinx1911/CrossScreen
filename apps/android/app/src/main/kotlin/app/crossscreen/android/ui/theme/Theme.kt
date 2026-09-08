package app.crossscreen.android.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

private val LightColors = lightColorScheme(
    primary = BrandPrimary,
    onPrimary = LightSurface,
    background = LightBackground,
    surface = LightSurface,
    onBackground = LightText,
    onSurface = LightText,
    onSurfaceVariant = LightTextMuted,
    outline = LightBorder,
    error = StatusBad,
)

private val DarkColors = darkColorScheme(
    primary = BrandPrimary,
    onPrimary = DarkText,
    background = DarkBackground,
    surface = DarkSurface,
    onBackground = DarkText,
    onSurface = DarkText,
    onSurfaceVariant = DarkTextMuted,
    outline = DarkBorder,
    error = StatusBad,
)

/**
 * The brand blue is deliberately fixed (M7 in docs/ui-scope-mobile.md), so
 * Android 12+'s dynamic/Material You colour extraction — which would derive
 * the theme from the user's wallpaper instead — is off by default. "Same
 * Experience. Every Device." is the design package's own tagline; a
 * per-device wallpaper-tinted blue is the opposite of that.
 */
@Composable
fun CrossScreenTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        darkTheme -> DarkColors
        else -> LightColors
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = CrossScreenTypography,
        content = content,
    )
}
