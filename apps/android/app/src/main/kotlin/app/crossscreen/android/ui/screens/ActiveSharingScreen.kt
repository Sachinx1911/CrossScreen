package app.crossscreen.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import app.crossscreen.android.protocol.ConnectionState
import app.crossscreen.android.ui.components.StatusIndicator
import app.crossscreen.android.ui.theme.CrossScreenTheme
import app.crossscreen.android.ui.theme.MinTouchTarget
import app.crossscreen.android.ui.theme.Radius
import app.crossscreen.android.ui.theme.Spacing
import kotlinx.coroutines.delay

/**
 * design/mobile spec §H. `viewerCount` and `connection` are owned by the
 * caller rather than this screen — once `MediaProjection`/`org.webrtc`
 * wiring exists they come from the real session, the same as the web
 * sharer's `SharerSession` events do; nothing here assumes a live capture.
 *
 * The confirmation on Stop matches the spec's exact copy ("Stop sharing your
 * screen?" / Cancel / Stop Sharing) — a screen being shared with no
 * confirmation before it ends is the wrong direction to be careless in.
 */
@Composable
fun ActiveSharingScreen(
    joinCodeDisplay: String,
    viewerCount: Int,
    connection: ConnectionState,
    onStopSharing: () -> Unit,
) {
    var elapsedSeconds by remember { mutableIntStateOf(0) }
    var confirmingStop by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        while (true) {
            delay(1_000)
            elapsedSeconds += 1
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        Text("You are sharing your screen", style = MaterialTheme.typography.headlineMedium)

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            StatusIndicator(connection)
            Text(formatDuration(elapsedSeconds), style = MaterialTheme.typography.bodyLarge)
        }

        // A placeholder for the live preview the spec calls for (§H "Live
        // preview (small)") — real content once capture exists to preview.
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f)
                .background(
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    shape = RoundedCornerShape(Radius.md),
                ),
        )

        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
            Text(
                "SESSION CODE",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(joinCodeDisplay, style = MaterialTheme.typography.displayLarge, textAlign = TextAlign.Center)
        }

        Text(
            if (viewerCount == 0) {
                "Send the code or link to someone"
            } else {
                "$viewerCount ${if (viewerCount == 1) "person is" else "people are"} watching"
            },
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Button(
            onClick = { confirmingStop = true },
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = MinTouchTarget),
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
        ) {
            Text("Stop Sharing")
        }
    }

    if (confirmingStop) {
        AlertDialog(
            onDismissRequest = { confirmingStop = false },
            title = { Text("Stop sharing your screen?") },
            confirmButton = {
                TextButton(onClick = {
                    confirmingStop = false
                    onStopSharing()
                }) { Text("Stop Sharing") }
            },
            dismissButton = {
                TextButton(onClick = { confirmingStop = false }) { Text("Cancel") }
            },
        )
    }
}

private fun formatDuration(totalSeconds: Int): String {
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    return "%02d:%02d".format(minutes, seconds)
}

@Preview(showBackground = true)
@Composable
private fun PreviewActiveSharingScreen() {
    CrossScreenTheme {
        ActiveSharingScreen(
            joinCodeDisplay = "482 719",
            viewerCount = 1,
            connection = ConnectionState.CONNECTED,
            onStopSharing = {},
        )
    }
}
