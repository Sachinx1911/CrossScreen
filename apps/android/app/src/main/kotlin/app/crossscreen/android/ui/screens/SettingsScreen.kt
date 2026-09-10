package app.crossscreen.android.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import app.crossscreen.android.ui.theme.CrossScreenTheme
import app.crossscreen.android.ui.theme.Spacing

/** System / Light / Dark — persisted by MainActivity, drives `CrossScreenTheme(darkTheme = …)`. */
enum class ThemeMode(val label: String) {
    SYSTEM("System"),
    LIGHT("Light"),
    DARK("Dark"),
}

/**
 * Screen A20, cut to what ADR-0007 leaves once there is no account: no
 * profile, no Sign Out, no notification prefs tied to a server. Theme is a
 * real local choice; Help and Privacy are short and honest rather than
 * stub rows that open nothing.
 */
@Composable
fun SettingsScreen(
    themeMode: ThemeMode,
    onThemeModeChange: (ThemeMode) -> Unit,
    appVersion: String,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.xl),
    ) {
        Text("Settings", style = MaterialTheme.typography.headlineMedium)

        Section("Appearance") {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                ThemeMode.entries.forEach { mode ->
                    FilterChip(
                        selected = mode == themeMode,
                        onClick = { onThemeModeChange(mode) },
                        label = { Text(mode.label) },
                    )
                }
            }
        }

        Section("Privacy & Security") {
            Text(
                "Sessions are anonymous — CrossScreen never asks for an account. " +
                    "Media is sent directly between devices over encrypted WebRTC (DTLS-SRTP); " +
                    "when a direct path is not possible it is relayed, still encrypted end to end.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Section("Help & Support") {
            Text(
                "A session code is six digits and only works while the host is sharing. " +
                    "If a share stops on its own, your device — not the app — usually ended it: " +
                    "locking the screen stops screen capture on recent Android versions.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Section("About") {
            Text("CrossScreen for Android", style = MaterialTheme.typography.bodyLarge)
            Text(
                "Version $appVersion",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                "Any Screen. Any Device. Together.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Text(
            title,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.primary,
        )
        content()
    }
}

@Preview(showBackground = true)
@Composable
private fun PreviewSettingsScreen() {
    CrossScreenTheme {
        SettingsScreen(themeMode = ThemeMode.SYSTEM, onThemeModeChange = {}, appVersion = "0.1.0")
    }
}
