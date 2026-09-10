package app.crossscreen.android.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import app.crossscreen.android.ui.theme.CrossScreenTheme
import app.crossscreen.android.ui.theme.Spacing
import kotlinx.coroutines.delay

/**
 * design/mobile spec §4A: wordmark + tagline, "minimal background
 * decoration", "no unnecessary loading controls", auto-transition on.
 *
 * A Compose screen rather than the `core:splashscreen` install-time API —
 * the spec's splash is a *branded* screen with copy on it, which the
 * system splash window cannot show. Swapping in `core:splashscreen` for the
 * cold-start window underneath this is a later refinement, not a scope
 * item. No logo mark yet, same as the manifest's placeholder launcher
 * icon; the wordmark carries it for now.
 */
@Composable
fun SplashScreen(onDone: () -> Unit) {
    LaunchedEffect(Unit) {
        delay(SPLASH_MILLIS)
        onDone()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(Spacing.xl),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            "CrossScreen",
            style = MaterialTheme.typography.displayLarge,
            color = MaterialTheme.colorScheme.primary,
        )
        Text(
            "Any Screen. Any Device. Together.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = Spacing.sm),
        )
    }
}

private const val SPLASH_MILLIS = 1_100L

@Preview(showBackground = true)
@Composable
private fun PreviewSplashScreen() {
    CrossScreenTheme {
        SplashScreen(onDone = {})
    }
}
