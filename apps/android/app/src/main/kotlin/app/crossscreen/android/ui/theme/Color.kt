package app.crossscreen.android.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * From docs/ui-scope-mobile.md §4 — the design package's tokens, with one
 * correction (M7): primary is web and desktop's `#2f6fed`
 * (apps/web/src/styles/theme.css), not the package's own `#2563EB`. Same
 * brand blue everywhere is worth more than any one platform's file matching
 * its source document exactly.
 */
val BrandPrimary = Color(0xFF2F6FED)
val BrandPrimaryDark = Color(0xFF1F57C9)

val StatusGood = Color(0xFF10B981)
val StatusWarn = Color(0xFFF59E0B)
val StatusBad = Color(0xFFEF4444)

val LightBackground = Color(0xFFF8FAFC)
val LightSurface = Color(0xFFFFFFFF)
val LightBorder = Color(0xFFE2E8F0)
val LightText = Color(0xFF0F172A)
val LightTextMuted = Color(0xFF64748B)

val DarkBackground = Color(0xFF0B1220)
val DarkSurface = Color(0xFF111827)
val DarkBorder = Color(0xFF243244)
val DarkText = Color(0xFFF8FAFC)
val DarkTextMuted = Color(0xFF94A3B8)
