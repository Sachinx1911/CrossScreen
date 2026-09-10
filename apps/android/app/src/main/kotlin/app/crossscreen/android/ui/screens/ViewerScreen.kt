package app.crossscreen.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import app.crossscreen.android.net.ViewerSession
import app.crossscreen.android.ui.components.VideoPreview
import app.crossscreen.android.ui.theme.CrossScreenTheme
import app.crossscreen.android.ui.theme.MinTouchTarget
import app.crossscreen.android.ui.theme.Radius
import app.crossscreen.android.ui.theme.Spacing
import org.webrtc.EglBase
import org.webrtc.VideoTrack

/**
 * Screen A13. Deliberately minimal: the phase text carries the wait
 * (architecture §67's vocabulary, not "ICE failed"), the remote track fills
 * the useful area once it arrives, and Leave is always reachable.
 *
 * The dedicated Android viewer stays an open question (phase-4-android.md:
 * the browser already covers viewing) — this exists so the phone's own
 * Join actually connects to something for a test, not because a viewer app
 * has been decided on.
 */
@Composable
fun ViewerScreen(
    phase: ViewerSession.Phase,
    message: String?,
    remoteTrack: VideoTrack?,
    eglContext: EglBase.Context?,
    onLeave: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        Text(headline(phase), style = MaterialTheme.typography.headlineMedium)

        if (message != null) {
            Text(
                message,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        val frame = Modifier
            .fillMaxWidth()
            .aspectRatio(16f / 9f)
            .clip(RoundedCornerShape(Radius.md))

        if (remoteTrack != null && eglContext != null) {
            VideoPreview(track = remoteTrack, eglContext = eglContext, modifier = frame)
        } else {
            Box(
                modifier = frame.background(MaterialTheme.colorScheme.surfaceVariant),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    waitingHint(phase),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(Spacing.lg),
                )
            }
        }

        Button(
            onClick = onLeave,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = MinTouchTarget),
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
        ) {
            Text("Leave")
        }
    }
}

private fun headline(phase: ViewerSession.Phase): String = when (phase) {
    ViewerSession.Phase.CONNECTING -> "Connecting…"
    ViewerSession.Phase.WAITING_FOR_HOST -> "Waiting for the host"
    ViewerSession.Phase.APPROVED -> "Approved — connecting…"
    ViewerSession.Phase.WATCHING -> "Watching"
    ViewerSession.Phase.REJECTED -> "Not allowed in"
    ViewerSession.Phase.ENDED -> "Session ended"
    ViewerSession.Phase.FAILED -> "Couldn't join"
}

private fun waitingHint(phase: ViewerSession.Phase): String = when (phase) {
    ViewerSession.Phase.WAITING_FOR_HOST -> "The host has been asked to let you in."
    ViewerSession.Phase.APPROVED -> "Setting up the connection…"
    ViewerSession.Phase.WATCHING -> "Waiting for the picture…"
    else -> ""
}

@Preview(showBackground = true)
@Composable
private fun PreviewViewerWaiting() {
    CrossScreenTheme {
        ViewerScreen(
            phase = ViewerSession.Phase.WAITING_FOR_HOST,
            message = null,
            remoteTrack = null,
            eglContext = null,
            onLeave = {},
        )
    }
}
