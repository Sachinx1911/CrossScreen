package app.crossscreen.android.capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Parcelable
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.PeerConnectionFactory
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack

/**
 * The Android 14+ ordering rule phase-4-android.md has flagged since before
 * this app had a single Kotlin file: `startForeground()` with type
 * `mediaProjection` must complete *before* the OS is asked for a
 * `MediaProjection` — here, before `ScreenCapturerAndroid.startCapture()`,
 * which reaches `MediaProjectionManager.getMediaProjection()` internally.
 * Android throws `SecurityException` on the reverse order. That ordering is
 * why this flow lives in `Service.onStartCommand()` — the one place
 * guaranteed to run the two in sequence — and not inline in `MainActivity`
 * where a later refactor could silently reorder it.
 *
 * This slice turns the captured screen into a WebRTC `VideoTrack` and no
 * further: `org.webrtc`'s `ScreenCapturerAndroid` feeds a `VideoSource`
 * created with `isScreencast = true`, and the resulting track is exposed
 * for the UI to render locally (ActiveSharingScreen's live preview). There
 * is no `PeerConnection` yet and no signaling — a phone-originated session
 * does not exist on the server for one to attach to. Proving the
 * capture -> encoder-input -> renderable-track path first, then adding the
 * peer, is the same split the walking skeleton made between "the toolchain
 * builds" and "the app does anything".
 */
class ScreenShareService : Service() {
    private val binder = LocalBinder()
    private val mainHandler = Handler(Looper.getMainLooper())

    // Every WebRTC handle below is created, used, and disposed on the main
    // thread — teardown from the system's own callback thread is posted
    // here first (see the MediaProjection.Callback in beginCapture) so
    // dispose ordering never races setup.
    private var tearingDown = false
    private var eglBase: EglBase? = null
    private var factory: PeerConnectionFactory? = null
    private var screenCapturer: ScreenCapturerAndroid? = null
    private var surfaceTextureHelper: SurfaceTextureHelper? = null
    private var videoSource: VideoSource? = null
    private var videoTrack: VideoTrack? = null

    private val _state = MutableStateFlow<CaptureState>(CaptureState.Idle)
    val state: StateFlow<CaptureState> = _state.asStateFlow()

    /**
     * Non-null exactly while [state] is [CaptureState.Capturing]. Held here
     * rather than inside the state value because a `VideoTrack` is a native
     * handle, not a value — putting it in a `data class` would give it an
     * identity-based `equals` that means nothing.
     */
    var screenCapture: ScreenCapture? = null
        private set

    inner class LocalBinder : Binder() {
        fun service(): ScreenShareService = this@ScreenShareService
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Foreground FIRST, unconditionally, before a single line touches
        // capture — see the class doc. If the consent extras below turn out
        // missing or stale, this call has still already happened, which is
        // the point: the ordering does not get to depend on the intent
        // being well-formed.
        startForegroundWithNotification()

        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, RESULT_CANCELED_SENTINEL)
            ?: RESULT_CANCELED_SENTINEL
        val data = intent?.parcelableExtraCompat<Intent>(EXTRA_RESULT_DATA)

        if (resultCode == RESULT_OK_SENTINEL && data != null) {
            beginCapture(data)
        } else {
            // Nothing to do without real consent data — never fabricate a
            // "capturing" state to match.
            _state.value = CaptureState.Stopped(reason = "No capture permission was granted")
            stopSelf()
        }
        return START_NOT_STICKY
    }

    /** Called from the bound Activity's "Stop Sharing" action, not only by the system. */
    fun stopCapture() {
        // Routes through the same teardown as a system-initiated stop
        // (screen lock on Android 15 QPR1+, the kill-switch chip): there is
        // one path capture ever ends by, regardless of who asked.
        finishCapture(reason = "Screen sharing stopped")
    }

    private fun beginCapture(permissionData: Intent) {
        ensureFactoryInitialized(applicationContext)

        val egl = EglBase.create()
        eglBase = egl

        val peerConnectionFactory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(
                // Prefer hardware VP8/VP9/H.264 where present, software
                // otherwise. (enableIntelVp8Encoder, enableH264HighProfile)
                DefaultVideoEncoderFactory(egl.eglBaseContext, true, true),
            )
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext))
            .createPeerConnectionFactory()
        factory = peerConnectionFactory

        val capturer = ScreenCapturerAndroid(
            permissionData,
            object : MediaProjection.Callback() {
                override fun onStop() {
                    // The system ended the projection (screen lock, the
                    // kill-switch chip) — not this app. This fires on the
                    // capturer's own handler thread; hop to main so teardown
                    // runs where setup did.
                    mainHandler.post {
                        finishCapture(reason = "The system stopped screen sharing")
                    }
                }
            },
        )
        screenCapturer = capturer

        val helper = SurfaceTextureHelper.create("ScreenCaptureThread", egl.eglBaseContext)
        surfaceTextureHelper = helper

        // isScreencast = true: turns on the screen-content coding paths
        // (architecture §9) — text stays sharp under bandwidth pressure
        // rather than the frame-rate-first behaviour tuned for camera video.
        val source = peerConnectionFactory.createVideoSource(true)
        videoSource = source
        capturer.initialize(helper, applicationContext, source.capturerObserver)

        val metrics = resources.displayMetrics
        val (width, height) = fitWithin(metrics.widthPixels, metrics.heightPixels, MAX_EDGE_PX)

        val track = peerConnectionFactory.createVideoTrack(VIDEO_TRACK_ID, source)
        track.setEnabled(true)
        videoTrack = track

        try {
            capturer.startCapture(width, height, TARGET_FPS)
        } catch (runtime: RuntimeException) {
            // getMediaProjection() can still fail here even past the consent
            // dialog — a token invalidated between grant and use, most
            // often. Non-crashing answer, same as everywhere else.
            android.util.Log.w(TAG, "startCapture failed", runtime)
            finishCapture(reason = "Screen capture could not be started")
            return
        }

        screenCapture = ScreenCapture(track = track, eglContext = egl.eglBaseContext)
        _state.value = CaptureState.Capturing(width = width, height = height, fps = TARGET_FPS)
    }

    /**
     * The single teardown path — every stop trigger (this app's Stop
     * Sharing, the system chip, a failed start, onDestroy) routes here.
     * Re-entrant calls are no-ops: [tearingDown] plus the null-out of each
     * handle means a second call finds nothing left to do.
     */
    private fun finishCapture(reason: String) {
        if (tearingDown) return
        tearingDown = true

        val alreadyStopped = _state.value is CaptureState.Stopped
        val wasCapturing = _state.value is CaptureState.Capturing

        screenCapture = null

        // stopCapture() unregisters our MediaProjection.Callback before
        // stopping the projection, so this does not re-enter onStop().
        try {
            screenCapturer?.stopCapture()
        } catch (interrupted: InterruptedException) {
            Thread.currentThread().interrupt()
            android.util.Log.w(TAG, "interrupted while stopping capture", interrupted)
        }
        screenCapturer?.dispose()
        screenCapturer = null

        videoTrack?.dispose()
        videoTrack = null
        videoSource?.dispose()
        videoSource = null
        surfaceTextureHelper?.dispose()
        surfaceTextureHelper = null
        factory?.dispose()
        factory = null
        eglBase?.release()
        eglBase = null

        // Do not overwrite a more specific Stopped reason a failed start may
        // already have set; do announce the stop of a live capture.
        if (wasCapturing || !alreadyStopped) {
            _state.value = CaptureState.Stopped(reason = reason)
        }
        // Left true: this service instance is on its way out via stopSelf().
        // A later share is a fresh instance with tearingDown = false again.
        stopSelf()
    }

    private fun startForegroundWithNotification() {
        val manager = getSystemService(NotificationManager::class.java)
        // IMPORTANCE_LOW: visible and non-dismissible (the "you are sharing
        // your screen" banner architecture §7 requires — a user must always
        // be able to see it), but silent.
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Screen sharing",
            NotificationManager.IMPORTANCE_LOW,
        )
        manager.createNotificationChannel(channel)

        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("CrossScreen")
            .setContentText("You are sharing your screen")
            // No custom icon exists yet — same disposable placeholder the
            // manifest's launcher icon uses (sym_def_app_icon).
            .setSmallIcon(android.R.drawable.ic_menu_share)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
            )
        } else {
            // Below API 29, startForeground() has no service-type argument
            // at all — minSdk 26 still needs this branch.
            @Suppress("DEPRECATION")
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    override fun onDestroy() {
        // Belt and braces: finishCapture() already runs on every stop path,
        // but a service killed some other way still must not leak native
        // handles.
        if (screenCapturer != null || factory != null || eglBase != null) {
            finishCapture(reason = "Screen sharing stopped")
        }
        super.onDestroy()
    }

    companion object {
        const val EXTRA_RESULT_CODE = "app.crossscreen.android.capture.EXTRA_RESULT_CODE"
        const val EXTRA_RESULT_DATA = "app.crossscreen.android.capture.EXTRA_RESULT_DATA"

        // Mirrors android.app.Activity.RESULT_OK / RESULT_CANCELED (-1 / 0)
        // without an Activity import in a Service file with no other reason
        // to depend on one.
        private const val RESULT_OK_SENTINEL = -1
        private const val RESULT_CANCELED_SENTINEL = 0

        private const val TAG = "ScreenShareService"
        private const val CHANNEL_ID = "screen_share"
        private const val NOTIFICATION_ID = 1

        private const val VIDEO_TRACK_ID = "screen_video"
        // architecture §9: cap the long edge at 1920, never upscale. A phone
        // in portrait therefore caps height, not width.
        private const val MAX_EDGE_PX = 1920
        private const val TARGET_FPS = 30

        @Volatile
        private var factoryInitialized = false

        /**
         * `PeerConnectionFactory.initialize()` is a once-per-process call and
         * must precede any factory construction. Guarded rather than pushed
         * into an `Application` subclass so an app launch that never shares a
         * screen pays none of its cost.
         */
        private fun ensureFactoryInitialized(appContext: android.content.Context) {
            if (factoryInitialized) return
            synchronized(ScreenShareService::class.java) {
                if (factoryInitialized) return
                PeerConnectionFactory.initialize(
                    PeerConnectionFactory.InitializationOptions
                        .builder(appContext)
                        .createInitializationOptions(),
                )
                factoryInitialized = true
            }
        }

        /** Scales (w, h) down so its longer edge is at most [maxEdge]; never scales up. */
        private fun fitWithin(w: Int, h: Int, maxEdge: Int): Pair<Int, Int> {
            val longEdge = maxOf(w, h)
            if (longEdge <= maxEdge) return w to h
            val scale = maxEdge.toDouble() / longEdge
            // Even dimensions — some encoders reject odd width/height.
            val sw = (w * scale).toInt().let { it - (it % 2) }
            val sh = (h * scale).toInt().let { it - (it % 2) }
            return sw to sh
        }
    }
}

/** What the UI needs to render the local capture: the track, and the GL context its frames live in. */
class ScreenCapture(
    val track: VideoTrack,
    val eglContext: EglBase.Context,
)

/** Sealed over Idle -> Capturing -> Stopped; no path back to Capturing without a fresh consent grant. */
sealed interface CaptureState {
    data object Idle : CaptureState
    data class Capturing(val width: Int, val height: Int, val fps: Int) : CaptureState
    data class Stopped(val reason: String) : CaptureState
}

/**
 * `Intent.getParcelableExtra(String)` was deprecated in API 33 for the
 * type-checked overload; minSdk 26 still needs the old one below that.
 */
private inline fun <reified T : Parcelable> Intent.parcelableExtraCompat(key: String): T? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        getParcelableExtra(key, T::class.java)
    } else {
        @Suppress("DEPRECATION")
        getParcelableExtra(key)
    }
