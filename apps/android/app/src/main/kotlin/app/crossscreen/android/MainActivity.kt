package app.crossscreen.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp

/**
 * The walking skeleton for phase-4-android.md: two screens, Share and Join,
 * on the same footing Phase 0.5 held the rest of this project to — prove
 * the toolchain end to end (Gradle, Kotlin, Compose, an actual emulator
 * launch) before a line of `MediaProjection` or `org.webrtc` exists to
 * depend on it.
 *
 * State-based screen switching rather than Navigation-Compose: three
 * screens do not earn a navigation library any more than the web app's own
 * hand-written `router.ts` needed React Router for its handful of routes —
 * the same reasoning, the same conclusion.
 */
private enum class Screen { Home, Share, Join }

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            CrossScreenApp()
        }
    }
}

@Composable
private fun CrossScreenApp() {
    var screen by remember { mutableStateOf(Screen.Home) }

    MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            Scaffold { innerPadding ->
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPadding)
                        .padding(24.dp),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    when (screen) {
                        Screen.Home -> HomeScreen(
                            onShare = { screen = Screen.Share },
                            onJoin = { screen = Screen.Join },
                        )
                        Screen.Share -> PlaceholderScreen(
                            title = "Share",
                            body = "MediaProjection capture is not wired up yet.",
                            onBack = { screen = Screen.Home },
                        )
                        Screen.Join -> PlaceholderScreen(
                            title = "Join",
                            body = "Android already views through the browser " +
                                "(phase-4-android.md's own open question) — this " +
                                "screen exists to keep the option visible, not " +
                                "because it is decided.",
                            onBack = { screen = Screen.Home },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun HomeScreen(onShare: () -> Unit, onJoin: () -> Unit) {
    Text("CrossScreen", style = MaterialTheme.typography.headlineMedium)
    Spacer()
    Button(onClick = onShare) { Text("Share your screen") }
    Spacer()
    Button(onClick = onJoin) { Text("Join a session") }
}

@Composable
private fun PlaceholderScreen(title: String, body: String, onBack: () -> Unit) {
    Text(title, style = MaterialTheme.typography.headlineMedium)
    Spacer()
    Text(body, style = MaterialTheme.typography.bodyMedium)
    Spacer()
    Button(onClick = onBack) { Text("Back") }
}

@Composable
private fun Spacer() {
    androidx.compose.foundation.layout.Spacer(modifier = Modifier.padding(8.dp))
}

@Preview(showBackground = true)
@Composable
private fun PreviewHome() {
    MaterialTheme {
        HomeScreen(onShare = {}, onJoin = {})
    }
}
