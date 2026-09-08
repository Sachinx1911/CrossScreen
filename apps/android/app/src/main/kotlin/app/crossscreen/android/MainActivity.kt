package app.crossscreen.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import app.crossscreen.android.protocol.ConnectionState
import app.crossscreen.android.ui.screens.ActiveSharingScreen
import app.crossscreen.android.ui.screens.HomeScreen
import app.crossscreen.android.ui.screens.JoinSessionScreen
import app.crossscreen.android.ui.screens.ShareSetupScreen
import app.crossscreen.android.ui.theme.CrossScreenTheme

/**
 * Phase 4's design pass (docs/ui-scope-mobile.md): real screens for the
 * v1-scoped part of the loop — Home, Share Setup, Active Sharing, Join —
 * still on mock, in-memory state. `MediaProjection` and `org.webrtc` are
 * the next slice per phase-4-android.md's own ordering ("prove the
 * toolchain... before a line of MediaProjection or org.webrtc exists to
 * depend on it"), so Share Setup's "Start Sharing" jumps straight to a
 * fake Active Sharing state rather than requesting real capture, and Join
 * accepts any 6-digit code rather than asking signaling.
 *
 * State-based screen switching, not Navigation-Compose — same reasoning as
 * the walking skeleton this replaces: a handful of screens do not earn a
 * navigation library any more than the web app's hand-written `router.ts`
 * needed React Router.
 */
private sealed interface Screen {
    data object Home : Screen
    data object ShareSetup : Screen
    data class ActiveSharing(val joinCodeDisplay: String) : Screen
    data object Join : Screen
}

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
    var screen by remember { mutableStateOf<Screen>(Screen.Home) }
    var viewerCount by remember { mutableIntStateOf(0) }

    CrossScreenTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            when (val current = screen) {
                is Screen.Home -> HomeScreen(
                    onShare = { screen = Screen.ShareSetup },
                    onJoin = { screen = Screen.Join },
                )

                is Screen.ShareSetup -> ShareSetupScreen(
                    onStartSharing = {
                        viewerCount = 0
                        // A fixed mock code until real session creation exists
                        // (services/api's POST /api/v1/sessions, from this
                        // client). Never a real, resolvable code.
                        screen = Screen.ActiveSharing(joinCodeDisplay = "482 719")
                    },
                    onBack = { screen = Screen.Home },
                )

                is Screen.ActiveSharing -> ActiveSharingScreen(
                    joinCodeDisplay = current.joinCodeDisplay,
                    viewerCount = viewerCount,
                    connection = if (viewerCount > 0) ConnectionState.CONNECTED else ConnectionState.CONNECTING,
                    onStopSharing = { screen = Screen.Home },
                )

                is Screen.Join -> JoinSessionScreen(
                    onJoin = { screen = Screen.Home },
                    onBack = { screen = Screen.Home },
                )
            }
        }
    }
}
