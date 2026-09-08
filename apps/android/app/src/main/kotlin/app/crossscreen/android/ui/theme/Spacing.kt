package app.crossscreen.android.ui.theme

import androidx.compose.ui.unit.dp

/** docs/ui-scope-mobile.md §4 — the design package's spacing and radius scale, kept as given. */
object Spacing {
    val xs = 4.dp
    val sm = 8.dp
    val md = 12.dp
    val lg = 16.dp
    val xl = 24.dp
    val xxl = 32.dp
    val xxxl = 48.dp
}

object Radius {
    val sm = 8.dp
    val md = 12.dp
    val lg = 16.dp
    val xl = 20.dp
}

/** Material 3's own guidance, and the design package agrees (docs/ui-scope-mobile.md §4). */
val MinTouchTarget = 48.dp
