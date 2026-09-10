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
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import app.crossscreen.android.data.SessionRecord
import app.crossscreen.android.data.SessionStore
import app.crossscreen.android.protocol.ConnectionState
import app.crossscreen.android.ui.screens.ActiveSharingScreen
import app.crossscreen.android.ui.screens.HomeScreen
import app.crossscreen.android.ui.screens.JoinSessionScreen
import app.crossscreen.android.ui.screens.OnboardingScreen
import app.crossscreen.android.ui.screens.SessionsScreen
import app.crossscreen.android.ui.screens.SettingsScreen
import app.crossscreen.android.ui.screens.ShareSetupScreen
import app.crossscreen.android.ui.screens.SplashScreen
import app.crossscreen.android.ui.screens.ThemeMode
import app.crossscreen.android.ui.theme.CrossScreenTheme

/**
 * Phase 4 against docs/ui-scope-mobile.md's reconciled v1 scope: Splash,
 * Onboarding (first launch), a Home/Sessions/Settings bottom nav, and the
 * Share Setup → Active Sharing and Join sub-flows pushed over it. No
 * accounts, no Devices screen, no iOS — those are M1/M3 in that doc, and
 * ADR-0007 / ADR-0001 behind it.
 *
 * Sharing is real: `MediaProjection` consent, the Android 14+
 * foreground-service ordering, and a WebRTC `VideoTrack` all go through
 * `ScreenShareService`. Still not here: a `PeerConnection` and signaling —
 * Join records a local history row and returns Home, nothing on the wire.
 *
 * State-based screen switching, not Navigation-Compose — a handful of
 * screens no more earn a navigation library than the web app's hand-written
 * `router.ts` needed React Router.
 */
private sealed interface Screen {
    data object Splash : Screen
    data object Onboarding : Screen

    /** The three bottom-nav destinations. */
    data object Home : Screen
    data object Sessions : Screen
    data object Settings : Screen

    /** Full-screen sub-flows, no bottom bar. */
    data object ShareSetup : Screen
    data class ActiveSharing(val joinCodeDisplay: String) : Screen
    data object Join : Screen
}

private fun Screen.isTab(): Boolean =
    this is Screen.Home || this is Screen.Sessions || this is Screen.Settings

private const val PREFS_NAME = "crossscreen.prefs"
private const val KEY_ONBOARDING_SEEN = "onboarding_seen"
private const val KEY_THEME_MODE = "theme_mode"

// Kept in sync with app/build.gradle.kts defaultConfig.versionName. Cheaper
// than turning BuildConfig generation on for one string.
private const val APP_VERSION = "0.1.0"

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
    val prefs = remember { context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE) }
    val sessionStore = remember { SessionStore(prefs) }

    var screen by remember { mutableStateOf<Screen>(Screen.Splash) }
    var viewerCount by remember { mutableIntStateOf(0) }
    var homeMessage by remember { mutableStateOf<String?>(null) }
    var stoppedByUser by remember { mutableStateOf(false) }
    var themeMode by remember { mutableStateOf(readThemeMode(prefs)) }

    var sessionsVersion by remember { mutableIntStateOf(0) }
    val recentSessions = remember(sessionsVersion) { sessionStore.recent() }
    fun recordSession(record: SessionRecord) {
        sessionStore.add(record)
        sessionsVersion++
    }

    var boundService by remember { mutableStateOf<ScreenShareService?>(null) }
    var screenCapture by remember { mutableStateOf<ScreenCapture?>(null) }

    // Bound for this Activity's lifetime so the UI can observe capture
    // state and call stopCapture() directly. The service is also *started*
    // separately (captureLauncher below) — the standard "started and bound"
    // split for a foreground service that must keep running even if this
    // binding drops (an Activity recreation on rotation, for instance).
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
            screenCapture = boundService?.screenCapture
            if (state is CaptureState.Stopped && screen is Screen.ActiveSharing) {
                // A user-confirmed Stop Sharing and a system-initiated stop
                // both land here — ScreenShareService.finishCapture() is the
                // one teardown path. stoppedByUser tells the two apart so an
                // expected stop shows no message about something the user
                // just did.
                homeMessage = if (stoppedByUser) null else state.reason
                stoppedByUser = false
                screen = Screen.Home
            }
        }
    }

    // Denial is not fatal: the foreground service still runs and captures
    // without it on API 33+, it just cannot show the persistent "you are
    // sharing" notification the OS gates behind this permission.
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
            recordSession(
                SessionRecord("482719", SessionRecord.Role.HOST, System.currentTimeMillis(), "Shared"),
            )
            screen = Screen.ActiveSharing(joinCodeDisplay = "482 719")
        } else {
            // The user declined Android's own capture-consent dialog.
            // CAPTURE_PERMISSION_DENIED territory in spirit — stay on Share
            // Setup rather than pretending sharing started.
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

    val darkTheme = when (themeMode) {
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
    }

    CrossScreenTheme(darkTheme = darkTheme) {
        Scaffold(
            bottomBar = {
                if (screen.isTab()) {
                    NavigationBar {
                        NavigationBarItem(
                            selected = screen is Screen.Home,
                            onClick = { screen = Screen.Home },
                            icon = { Icon(Icons.Filled.Home, contentDescription = null) },
                            label = { Text("Home") },
                        )
                        NavigationBarItem(
                            selected = screen is Screen.Sessions,
                            onClick = { screen = Screen.Sessions },
                            icon = { Icon(Icons.Filled.DateRange, contentDescription = null) },
                            label = { Text("Sessions") },
                        )
                        NavigationBarItem(
                            selected = screen is Screen.Settings,
                            onClick = { screen = Screen.Settings },
                            icon = { Icon(Icons.Filled.Settings, contentDescription = null) },
                            label = { Text("Settings") },
                        )
                    }
                }
            },
        ) { innerPadding ->
            Surface(modifier = Modifier.fillMaxSize().padding(innerPadding)) {
                // Restrained crossfade — design/mobile spec §13 asks for
                // 150–250 ms transitions and nothing showier.
                Crossfade(targetState = screen, animationSpec = tween(220), label = "screen") { current ->
                    when (current) {
                        is Screen.Splash -> SplashScreen(
                            onDone = {
                                screen = if (prefs.getBoolean(KEY_ONBOARDING_SEEN, false)) {
                                    Screen.Home
                                } else {
                                    Screen.Onboarding
                                }
                            },
                        )

                        is Screen.Onboarding -> OnboardingScreen(
                            onFinish = {
                                prefs.edit().putBoolean(KEY_ONBOARDING_SEEN, true).apply()
                                screen = Screen.Home
                            },
                        )

                        is Screen.Home -> HomeScreen(
                            onShare = { screen = Screen.ShareSetup },
                            onJoin = { screen = Screen.Join },
                            recentSessions = recentSessions,
                            onSeeAllSessions = { screen = Screen.Sessions },
                            stoppedMessage = homeMessage,
                        )

                        is Screen.Sessions -> SessionsScreen(
                            records = recentSessions,
                            onClearHistory = {
                                sessionStore.clear()
                                sessionsVersion++
                            },
                        )

                        is Screen.Settings -> SettingsScreen(
                            themeMode = themeMode,
                            onThemeModeChange = { mode ->
                                themeMode = mode
                                prefs.edit().putString(KEY_THEME_MODE, mode.name).apply()
                            },
                            appVersion = APP_VERSION,
                        )

                        is Screen.ShareSetup -> ShareSetupScreen(
                            onStartSharing = { requestCapture() },
                            onBack = { screen = Screen.Home },
                        )

                        is Screen.ActiveSharing -> ActiveSharingScreen(
                            joinCodeDisplay = current.joinCodeDisplay,
                            viewerCount = viewerCount,
                            connection = if (viewerCount > 0) {
                                ConnectionState.CONNECTED
                            } else {
                                ConnectionState.CONNECTING
                            },
                            onStopSharing = {
                                stoppedByUser = true
                                boundService?.stopCapture()
                            },
                            screenCapture = screenCapture,
                        )

                        is Screen.Join -> JoinSessionScreen(
                            onJoin = { code ->
                                recordSession(
                                    SessionRecord(
                                        code,
                                        SessionRecord.Role.VIEWER,
                                        System.currentTimeMillis(),
                                        "Joined",
                                    ),
                                )
                                screen = Screen.Home
                            },
                            onBack = { screen = Screen.Home },
                        )
                    }
                }
            }
        }
    }
}

private fun readThemeMode(prefs: android.content.SharedPreferences): ThemeMode =
    runCatching { ThemeMode.valueOf(prefs.getString(KEY_THEME_MODE, null) ?: ThemeMode.SYSTEM.name) }
        .getOrDefault(ThemeMode.SYSTEM)
