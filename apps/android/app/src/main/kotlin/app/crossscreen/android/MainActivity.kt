package app.crossscreen.android

import android.Manifest
import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import app.crossscreen.android.capture.CaptureState
import app.crossscreen.android.capture.ScreenCapture
import app.crossscreen.android.capture.ScreenShareService
import app.crossscreen.android.protocol.ConnectionState
import app.crossscreen.android.ui.screens.ActiveSharingScreen
import app.crossscreen.android.ui.screens.HomeScreen
import app.crossscreen.android.ui.screens.JoinSessionScreen
import app.crossscreen.android.ui.screens.ShareSetupScreen
import app.crossscreen.android.ui.theme.CrossScreenTheme

/**
 * Phase 4's design pass (docs/ui-scope-mobile.md): real screens for the
 * v1-scoped part of the loop — Home, Share Setup, Active Sharing, Join.
 * Sharing is real as of this slice: `MediaProjection` consent, the
 * Android 14+ foreground-service ordering, and a WebRTC `VideoTrack` from
 * the captured screen all go through `ScreenShareService`
 * (capture/ScreenShareService.kt), and Active Sharing renders that track
 * locally. What is *not* here yet: a `PeerConnection` and signaling — Join
 * still accepts any 6-digit code, and no session exists on the server for
 * a phone-originated share to attach to.
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
    val context = LocalContext.current
    var screen by remember { mutableStateOf<Screen>(Screen.Home) }
    var viewerCount by remember { mutableIntStateOf(0) }
    var homeMessage by remember { mutableStateOf<String?>(null) }
    var stoppedByUser by remember { mutableStateOf(false) }

    var boundService by remember { mutableStateOf<ScreenShareService?>(null) }
    var screenCapture by remember { mutableStateOf<ScreenCapture?>(null) }

    // Bound for this Activity's lifetime so the UI can observe capture
    // state and call stopCapture() directly. The service is also
    // *started* separately (captureLauncher below) — the standard
    // "started and bound" split for a foreground service that must keep
    // running even if this binding drops (an Activity recreation on
    // rotation, for instance) — so losing this connection is not the same
    // as sharing stopping.
    DisposableEffect(Unit) {
        val connection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
                boundService = (binder as ScreenShareService.LocalBinder).service()
            }

            override fun onServiceDisconnected(name: ComponentName?) {
                boundService = null
            }
        }
        context.bindService(
            Intent(context, ScreenShareService::class.java),
            connection,
            Context.BIND_AUTO_CREATE,
        )
        onDispose { context.unbindService(connection) }
    }

    LaunchedEffect(boundService) {
        boundService?.state?.collect { state ->
            // screenCapture is a plain var on the service (a VideoTrack is
            // not a value type — see ScreenShareService); read it alongside
            // each state change rather than observing it separately.
            screenCapture = boundService?.screenCapture
            if (state is CaptureState.Stopped && screen is Screen.ActiveSharing) {
                // A user-confirmed Stop Sharing and a system-initiated stop
                // both land here — ScreenShareService.finishCapture() is the
                // one teardown path, whoever triggered it. stoppedByUser is
                // what tells the two apart, so an expected stop does not show
                // a message explaining something the user just did.
                homeMessage = if (stoppedByUser) null else state.reason
                stoppedByUser = false
                screen = Screen.Home
            }
        }
    }

    // Denial is not fatal: the foreground service still runs and captures
    // without it on API 33+, it just cannot show the persistent "you are
    // sharing" notification the OS itself gates behind this permission —
    // a worse abuse-prevention posture, not a broken one.
    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { }

    val captureLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val data = result.data
        if (result.resultCode == Activity.RESULT_OK && data != null) {
            val serviceIntent = Intent(context, ScreenShareService::class.java).apply {
                putExtra(ScreenShareService.EXTRA_RESULT_CODE, result.resultCode)
                putExtra(ScreenShareService.EXTRA_RESULT_DATA, data)
            }
            ContextCompat.startForegroundService(context, serviceIntent)
            viewerCount = 0
            homeMessage = null
            // A fixed mock code until real session creation exists
            // (services/api's POST /api/v1/sessions, from this client).
            // Never a real, resolvable code.
            screen = Screen.ActiveSharing(joinCodeDisplay = "482 719")
        } else {
            // The user declined Android's own capture-consent dialog.
            // CAPTURE_PERMISSION_DENIED territory (packages/protocol/src/errors.ts)
            // in spirit, even though no signaling connection exists yet to
            // report it over — stay on Share Setup rather than pretending
            // sharing started.
            screen = Screen.ShareSetup
        }
    }

    fun requestCapture() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        val projectionManager = context.getSystemService(MediaProjectionManager::class.java)
        captureLauncher.launch(projectionManager.createScreenCaptureIntent())
    }

    CrossScreenTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            when (val current = screen) {
                is Screen.Home -> HomeScreen(
                    onShare = { screen = Screen.ShareSetup },
                    onJoin = { screen = Screen.Join },
                    stoppedMessage = homeMessage,
                )

                is Screen.ShareSetup -> ShareSetupScreen(
                    onStartSharing = { requestCapture() },
                    onBack = { screen = Screen.Home },
                )

                is Screen.ActiveSharing -> ActiveSharingScreen(
                    joinCodeDisplay = current.joinCodeDisplay,
                    viewerCount = viewerCount,
                    connection = if (viewerCount > 0) ConnectionState.CONNECTED else ConnectionState.CONNECTING,
                    onStopSharing = {
                        stoppedByUser = true
                        boundService?.stopCapture()
                    },
                    screenCapture = screenCapture,
                )

                is Screen.Join -> JoinSessionScreen(
                    onJoin = { screen = Screen.Home },
                    onBack = { screen = Screen.Home },
                )
            }
        }
    }
}
