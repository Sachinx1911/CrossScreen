package app.crossscreen.android.ui.screens

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.tooling.preview.Preview
import app.crossscreen.android.ui.components.SessionCodeField
import app.crossscreen.android.ui.theme.CrossScreenTheme
import app.crossscreen.android.ui.theme.MinTouchTarget
import app.crossscreen.android.ui.theme.Spacing

/**
 * design/mobile spec §I. `onJoin` receives the plain 6-digit code.
 *
 * "Paste" (spec §8's paste support) pulls the clipboard and keeps the
 * digits it finds — so a code sent over a message pastes cleanly whether
 * it arrived bare ("482 719") or inside surrounding text. Resolving a
 * full share *link* — the 22-char joinToken path, deep links — needs the
 * session lookup that only exists once signaling is wired, so that half
 * waits for phase-4-android.md's next slice; this button never pretends to
 * have done more than fill the field.
 */
@Composable
fun JoinSessionScreen(onJoin: (code: String) -> Unit, onBack: () -> Unit) {
    val context = LocalContext.current
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

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
        ) {
            TextButton(onClick = {
                val pasted = readClipboardText(context)
                val digits = pasted.filter { it.isDigit() }.take(6)
                if (digits.isEmpty()) {
                    problem = "Nothing on the clipboard looked like a session code."
                } else {
                    code = digits
                    problem = null
                }
            }) {
                Text("Paste")
            }
        }

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

/**
 * The framework `ClipboardManager` rather than Compose's — `coerceToText`
 * flattens a pasted URL, styled text or plain text to one string, and
 * Android's foreground-app clipboard rule is satisfied because the user
 * just tapped a control in this Activity.
 */
private fun readClipboardText(context: Context): String {
    val manager = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
        ?: return ""
    val item = manager.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0) ?: return ""
    return item.coerceToText(context)?.toString().orEmpty()
}

@Preview(showBackground = true)
@Composable
private fun PreviewJoinSessionScreen() {
    CrossScreenTheme {
        JoinSessionScreen(onJoin = {}, onBack = {})
    }
}
