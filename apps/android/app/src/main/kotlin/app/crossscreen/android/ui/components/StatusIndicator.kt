package app.crossscreen.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import app.crossscreen.android.protocol.ConnectionState
import app.crossscreen.android.ui.theme.Spacing
import app.crossscreen.android.ui.theme.StatusBad
import app.crossscreen.android.ui.theme.StatusGood
import app.crossscreen.android.ui.theme.StatusWarn

/**
 * A coloured dot plus words — never colour alone (docs/ui-scope-mobile.md
 * §10: "no color-only status"; the web viewer's `StatusDot` follows the
 * same rule for the same accessibility reason). Switches on the protocol's
 * own `ConnectionState`, generated in Protocol.kt, rather than a
 * hand-written enum that could drift from the seven states architecture §67
 * actually defines.
 *
 * "ICE failed" / "SDP error" / "TURN allocation failed" never appear here —
 * design/mobile's own spec (§K) and architecture §66 agree on that, and this
 * component has no branch that could produce one; there is no case for it.
 */
@Composable
fun StatusIndicator(state: ConnectionState, modifier: Modifier = Modifier) {
    val (color, label) = when (state) {
        ConnectionState.CONNECTING -> StatusWarn to "Connecting…"
        ConnectionState.CHECKING -> StatusWarn to "Checking connection…"
        ConnectionState.SECURING -> StatusWarn to "Establishing secure connection…"
        ConnectionState.CONNECTED -> StatusGood to "Connected"
        ConnectionState.UNSTABLE -> StatusWarn to "Connection unstable"
        ConnectionState.RECONNECTING -> StatusWarn to "Reconnecting…"
        ConnectionState.FAILED -> StatusBad to "Connection failed"
    }

    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        Dot(color)
        Spacer(Modifier.size(Spacing.sm))
        Text(label, style = MaterialTheme.typography.bodyLarge)
    }
}

@Composable
private fun Dot(color: Color) {
    Box(
        modifier = Modifier
            .size(10.dp)
            .background(color = color, shape = CircleShape),
    )
}
