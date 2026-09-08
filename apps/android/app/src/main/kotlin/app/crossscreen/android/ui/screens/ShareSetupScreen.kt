package app.crossscreen.android.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Monitor
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import app.crossscreen.android.ui.theme.CrossScreenTheme
import app.crossscreen.android.ui.theme.MinTouchTarget
import app.crossscreen.android.ui.theme.Spacing

/**
 * design/mobile spec §E, cut to what docs/ui-scope-mobile.md actually keeps
 * for v1: **Entire Screen only** (M6 — `MediaProjection` captures the whole
 * display, there is no standard per-app capture to offer alongside it), no
 * audio toggle (M5 — Phase 6, and nothing yet to gate it on), no annotation
 * toggle (M4 — Phase 7). One option means nothing to pick between, so it is
 * shown as a plain description rather than a list with a single, unreachable
 * row in it.
 */
@Composable
fun ShareSetupScreen(onStartSharing: () -> Unit, onBack: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        Text("Share Your Screen", style = MaterialTheme.typography.headlineMedium)

        Card(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier.padding(Spacing.lg),
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                Icon(Icons.Filled.Monitor, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Column {
                    Text("Entire Screen", style = MaterialTheme.typography.titleLarge)
                    Text(
                        "Everything on your display will be visible to anyone you approve.",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        Text(
            "Android will ask you to confirm screen sharing next. " +
                "CrossScreen needs that permission to share your screen with the selected session.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Button(
            onClick = onStartSharing,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = MinTouchTarget),
        ) {
            Text("Start Sharing")
        }

        TextButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) {
            Text("Cancel")
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun PreviewShareSetupScreen() {
    CrossScreenTheme {
        ShareSetupScreen(onStartSharing = {}, onBack = {})
    }
}
