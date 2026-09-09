package app.crossscreen.android.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Login
import androidx.compose.material.icons.automirrored.filled.ScreenShare
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import app.crossscreen.android.ui.theme.CrossScreenTheme
import app.crossscreen.android.ui.theme.Spacing

/**
 * Two dominant actions, nothing else (design/mobile spec §D, §"Home
 * requirements": "Recent sessions should be secondary"). No greeting, no
 * avatar, no recent-sessions list — docs/ui-scope-mobile.md M1 cuts the
 * account surface those implied, and a sessions history is deferred rather
 * than built half-connected to nothing.
 *
 * [stoppedMessage] surfaces exactly one honest fact when non-null: sharing
 * ended for a reason the user did not just choose on this screen — the
 * system's kill-switch chip, Android 15 QPR1+'s screen-lock behaviour, or a
 * denied capture permission (`ScreenShareService.CaptureState.Stopped`).
 * Exit criterion 2's "explained in plain language, not a crash" starts here,
 * not only once a real signaling connection exists to end.
 */
@Composable
fun HomeScreen(onShare: () -> Unit, onJoin: () -> Unit, stoppedMessage: String? = null) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        Text("CrossScreen", style = MaterialTheme.typography.displayLarge)
        Text(
            "Any Screen. Any Device. Together.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        if (stoppedMessage != null) {
            Card(modifier = Modifier.fillMaxWidth()) {
                Text(
                    stoppedMessage,
                    modifier = Modifier.padding(Spacing.md),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Spacer()

        ActionCard(
            icon = Icons.AutoMirrored.Filled.ScreenShare,
            title = "Share Screen",
            body = "Share your device screen",
            onClick = onShare,
        )
        ActionCard(
            icon = Icons.AutoMirrored.Filled.Login,
            title = "Join Session",
            body = "Enter a code or open a link",
            onClick = onJoin,
        )
    }
}

@Composable
private fun ActionCard(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    body: String,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(
            modifier = Modifier.padding(PaddingValues(Spacing.lg)),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Text(title, style = MaterialTheme.typography.titleLarge)
            Text(
                body,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun Spacer() =
    androidx.compose.foundation.layout.Spacer(modifier = Modifier.padding(Spacing.xs))

@Preview(showBackground = true)
@Composable
private fun PreviewHomeScreen() {
    CrossScreenTheme {
        HomeScreen(onShare = {}, onJoin = {})
    }
}
