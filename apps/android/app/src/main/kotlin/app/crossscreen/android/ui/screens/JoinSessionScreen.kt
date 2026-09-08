package app.crossscreen.android.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import app.crossscreen.android.ui.components.SessionCodeField
import app.crossscreen.android.ui.theme.CrossScreenTheme
import app.crossscreen.android.ui.theme.MinTouchTarget
import app.crossscreen.android.ui.theme.Spacing

/**
 * design/mobile spec §I. `onJoin` receives the plain 6-digit code — parsing
 * a pasted link into one, and everything that happens once a code is
 * submitted, is join-flow networking (phase-4-android.md's next slice), not
 * this screen's job.
 */
@Composable
fun JoinSessionScreen(onJoin: (code: String) -> Unit, onBack: () -> Unit) {
    var code by remember { mutableStateOf("") }
    var problem by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        Text("Join a Session", style = MaterialTheme.typography.headlineMedium)

        SessionCodeField(
            value = code,
            onValueChange = {
                code = it
                problem = null
            },
            modifier = Modifier.fillMaxWidth(),
        )

        if (problem != null) {
            Text(
                problem ?: "",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.error,
            )
        }

        Button(
            onClick = {
                if (code.length == 6) {
                    onJoin(code)
                } else {
                    problem = "A session code is six digits. Check it and try again."
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = MinTouchTarget),
        ) {
            Text("Join Session")
        }

        Text(
            "The host will be asked to let you in.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        TextButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) {
            Text("Back")
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun PreviewJoinSessionScreen() {
    CrossScreenTheme {
        JoinSessionScreen(onJoin = {}, onBack = {})
    }
}
