package app.crossscreen.android.ui.screens

import android.text.format.DateUtils
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import app.crossscreen.android.data.SessionRecord
import app.crossscreen.android.ui.theme.CrossScreenTheme
import app.crossscreen.android.ui.theme.Spacing

/**
 * Screen A17 + the "Recent Sessions" the mockup shows here and on Home.
 * Local device history only (data/SessionStore.kt) — no account, so no
 * cross-device list and nothing server-side to page. Empty state is A22.
 */
@Composable
fun SessionsScreen(records: List<SessionRecord>, onClearHistory: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Sessions", style = MaterialTheme.typography.headlineMedium)
            if (records.isNotEmpty()) {
                TextButton(onClick = onClearHistory) { Text("Clear") }
            }
        }

        if (records.isEmpty()) {
            Text(
                "No sessions yet. Sharing your screen or joining one will show up here.",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                items(records) { record ->
                    SessionRow(record)
                }
            }
        }
    }
}

@Composable
private fun SessionRow(record: SessionRecord) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(Spacing.md)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(formatCode(record.code), style = MaterialTheme.typography.titleLarge)
                Text(
                    if (record.role == SessionRecord.Role.HOST) "Host" else "Viewer",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            HorizontalDivider(modifier = Modifier.padding(vertical = Spacing.xs))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    DateUtils.getRelativeTimeSpanString(record.startedAtMillis).toString(),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    record.status,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** "482719" -> "482 719", the grouping architecture §7 uses for display everywhere. */
internal fun formatCode(code: String): String =
    if (code.length == 6) "${code.take(3)} ${code.drop(3)}" else code

@Preview(showBackground = true)
@Composable
private fun PreviewSessionsScreen() {
    CrossScreenTheme {
        SessionsScreen(
            records = listOf(
                SessionRecord("482719", SessionRecord.Role.HOST, System.currentTimeMillis() - 3_600_000, "Ended"),
                SessionRecord("619882", SessionRecord.Role.VIEWER, System.currentTimeMillis() - 86_400_000, "Left"),
            ),
            onClearHistory = {},
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun PreviewSessionsEmpty() {
    CrossScreenTheme {
        SessionsScreen(records = emptyList(), onClearHistory = {})
    }
}
