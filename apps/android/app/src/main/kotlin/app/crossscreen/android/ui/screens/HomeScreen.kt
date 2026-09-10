package app.crossscreen.android.ui.screens

import android.text.format.DateUtils
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Login
import androidx.compose.material.icons.automirrored.filled.ScreenShare
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import app.crossscreen.android.data.SessionRecord
import app.crossscreen.android.ui.theme.CrossScreenTheme
import app.crossscreen.android.ui.theme.Spacing

/**
 * Two dominant actions, then Recent Sessions as the secondary block the
 * mockup shows below them (design/mobile spec §D). No greeting and no
 * avatar — docs/ui-scope-mobile.md M1 cuts the account surface those imply;
 * the recent list is local-only (data/SessionStore.kt), not an account
 * feature.
 *
 * [stoppedMessage] surfaces one honest fact when non-null: sharing ended
 * for a reason the user did not just choose here — the system kill-switch
 * chip, Android 15 QPR1+'s screen-lock stop, or a denied capture
 * permission. Exit criterion 2's "explained in plain language" starts here.
 */
@Composable
fun HomeScreen(
    onShare: () -> Unit,
    onJoin: () -> Unit,
    recentSessions: List<SessionRecord> = emptyList(),
    onSeeAllSessions: () -> Unit = {},
    stoppedMessage: String? = null,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
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

        if (recentSessions.isNotEmpty()) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Recent Sessions", style = MaterialTheme.typography.titleLarge)
                TextButton(onClick = onSeeAllSessions) { Text("See all") }
            }
            recentSessions.take(3).forEach { record ->
                RecentRow(record)
            }
        }
    }
}

@Composable
private fun RecentRow(record: SessionRecord) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(Spacing.md),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(formatCode(record.code), style = MaterialTheme.typography.bodyLarge)
            Text(
                DateUtils.getRelativeTimeSpanString(record.startedAtMillis).toString(),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
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

@Preview(showBackground = true)
@Composable
private fun PreviewHomeScreen() {
    CrossScreenTheme {
        HomeScreen(
            onShare = {},
            onJoin = {},
            recentSessions = listOf(
                SessionRecord("482719", SessionRecord.Role.HOST, System.currentTimeMillis() - 3_600_000, "Shared"),
            ),
        )
    }
}
