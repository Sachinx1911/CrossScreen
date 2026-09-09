package app.crossscreen.android.capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Binder
import android.os.Build
import android.os.HandlerThread
import android.os.IBinder
import android.os.Parcelable
import androidx.core.app.NotificationCompat
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The Android 14+ ordering rule phase-4-android.md has flagged since before
 * this app had a single Kotlin file: `startForeground()` with type
 * `mediaProjection` must complete *before*
 * `MediaProjectionManager.getMediaProjection()` is ever called, or the OS
 * throws `SecurityException` rather than returning null. That ordering is
 * why this whole flow lives in a `Service.onStartCommand()` — the one place
 * guaranteed to run the two in the right sequence — and not inline in
 * `MainActivity` where it would be one refactor away from being silently
 * reordered.
 *
 * Deliberately stops short of `org.webrtc` (phase-4-android.md's own next
 * item, after this one). What this proves instead: real user consent, the
 * ordering above, and actual frames arriving from a `VirtualDisplay` backed
 * by this projection — counted, not assumed — via a plain `ImageReader`.
 * Turning those frames into a `VideoTrack` is additive work on top of a
 * mechanism already shown to produce them, the same split the walking
 * skeleton itself made between "the toolchain builds" and "the app does
 * anything".
 */
class ScreenShareService : Service() {
    private val binder = LocalBinder()
    private val serviceScope = CoroutineScope(SupervisorJob())
    private var frameSamplerJob: Job? = null
    private var handlerThread: HandlerThread? = null

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private val frameCount = AtomicInteger(0)

    private val _state = MutableStateFlow<CaptureState>(CaptureState.Idle)
    val state: StateFlow<CaptureState> = _state.asStateFlow()

    inner class LocalBinder : Binder() {
        fun service(): ScreenShareService = this@ScreenShareService
    }

    override fun onBind(intent: Intent?): IBinder = binder

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Foreground FIRST, unconditionally, before a single line touches
        // MediaProjection — see the class doc. If the consent extras below
        // turn out to be missing or stale, this call has still already
        // happened, which is the point: the ordering does not get to depend
        // on the intent being well-formed.
        startForegroundWithNotification()

        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, RESULT_CANCELED_SENTINEL)
            ?: RESULT_CANCELED_SENTINEL
        val data = intent?.parcelableExtraCompat<Intent>(EXTRA_RESULT_DATA)

        if (resultCode == RESULT_OK_SENTINEL && data != null) {
            beginCapture(resultCode, data)
        } else {
            // Nothing to do without real consent data — never fabricate a
            // "capturing" state to match. stopSelf() here still shows a
            // notification for a frame or two on some OEM skins; that is a
            // known, accepted cost of the ordering requirement above, not a
            // bug in this service.
            _state.value = CaptureState.Stopped(reason = "No capture permission was granted")
            stopSelf()
        }
        return START_NOT_STICKY
    }

    /** Called from the bound Activity's "Stop Sharing" action, not only by the system. */
    fun stopCapture() {
        // MediaProjection.stop() invokes the Callback's onStop() below,
        // which is the single teardown path regardless of who initiated
        // the stop — this app, the system's kill-switch chip, or the
        // screen-lock behaviour Android 15 QPR1+ enforces on its own.
        mediaProjection?.stop()
    }

    private fun beginCapture(resultCode: Int, data: Intent) {
        val projectionManager =
            getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val projection = projectionManager.getMediaProjection(resultCode, data)
        if (projection == null) {
            // Documented as nullable rather than throwing — seen in practice
            // when the consent token from captureLauncher's result has gone
            // stale (an OS-killed Activity resumed later, say). No different
            // in kind from the "consent missing entirely" branch above this
            // function; same non-crashing answer applies.
            _state.value = CaptureState.Stopped(reason = "Screen capture could not be started")
            stopSelf()
            return
        }
        mediaProjection = projection

        projection.registerCallback(
            object : MediaProjection.Callback() {
                override fun onStop() {
                    // Fires for every stop path (see stopCapture() above),
                    // so this is the one place capture ever actually ends.
                    val reason = if (_state.value is CaptureState.Capturing) {
                        "Screen sharing stopped"
                    } else {
                        "Screen sharing was stopped before it started"
                    }
                    teardownCapture()
                    _state.value = CaptureState.Stopped(reason = reason)
                    stopSelf()
                }
            },
            null,
        )

        val thread = HandlerThread("ScreenShareImageReader").apply { start() }
        handlerThread = thread

        val metrics = resources.displayMetrics
        val reader = ImageReader.newInstance(
            metrics.widthPixels,
            metrics.heightPixels,
            android.graphics.PixelFormat.RGBA_8888,
            2,
        )
        imageReader = reader
        reader.setOnImageAvailableListener(
            { r ->
                // acquireLatestImage() can legitimately return null if the
                // reader has nothing new — MediaProjection can call this
                // listener opportunistically, not on a strict one-image
                // guarantee. Closed explicitly rather than via Kotlin's
                // `use {}`: android.media.Image implements only
                // java.lang.AutoCloseable, not the java.io.Closeable that
                // extension actually requires.
                val image = r.acquireLatestImage()
                if (image != null) {
                    frameCount.incrementAndGet()
                    image.close()
                }
            },
            android.os.Handler(thread.looper),
        )

        virtualDisplay = projection.createVirtualDisplay(
            "CrossScreenCapture",
            metrics.widthPixels,
            metrics.heightPixels,
            metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.surface,
            null,
            null,
        )

        _state.value = CaptureState.Capturing(frameCount = 0)

        // Sampled, not emitted per-frame: a busy screen can produce frames
        // far faster than Compose needs to redraw a counter, and the
        // ImageReader listener already runs off the main thread.
        frameSamplerJob = serviceScope.launch {
            while (true) {
                delay(500)
                _state.value = CaptureState.Capturing(frameCount = frameCount.get())
            }
        }
    }

    private fun teardownCapture() {
        frameSamplerJob?.cancel()
        frameSamplerJob = null
        virtualDisplay?.release()
        virtualDisplay = null
        imageReader?.close()
        imageReader = null
        handlerThread?.quitSafely()
        handlerThread = null
        mediaProjection = null
        frameCount.set(0)
    }

    private fun startForegroundWithNotification() {
        val manager = getSystemService(NotificationManager::class.java)
        // IMPORTANCE_LOW: visible and non-dismissible (this is the
        // "you are sharing your screen" abuse-prevention banner architecture
        // §7 requires — a user must always be able to see it), but silent —
        // a chime every time this fires would be its own kind of nuisance.
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
            // manifest's own launcher icon uses (sym_def_app_icon), not an
            // oversight specific to this file.
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
            // at all — minSdk 26 still needs this branch to compile and run
            // there, even though MediaProjection's stricter rules are an
            // API 29+/34+ concern.
            @Suppress("DEPRECATION")
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    override fun onDestroy() {
        teardownCapture()
        serviceScope.cancel()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_RESULT_CODE = "app.crossscreen.android.capture.EXTRA_RESULT_CODE"
        const val EXTRA_RESULT_DATA = "app.crossscreen.android.capture.EXTRA_RESULT_DATA"

        // Mirrors android.app.Activity.RESULT_OK / RESULT_CANCELED (0 / -1)
        // without an Activity import in a Service file that has no other
        // reason to depend on one.
        private const val RESULT_OK_SENTINEL = -1
        private const val RESULT_CANCELED_SENTINEL = 0

        private const val CHANNEL_ID = "screen_share"
        private const val NOTIFICATION_ID = 1
    }
}

/** Sealed over Idle -> Capturing -> Stopped; there is no path back to Capturing without a fresh consent grant. */
sealed interface CaptureState {
    data object Idle : CaptureState
    data class Capturing(val frameCount: Int) : CaptureState
    data class Stopped(val reason: String) : CaptureState
}

/**
 * `Intent.getParcelableExtra(String)` was deprecated in API 33 in favour of
 * the type-checked overload; minSdk 26 still needs the old one on devices
 * below that.
 */
private inline fun <reified T : Parcelable> Intent.parcelableExtraCompat(key: String): T? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        getParcelableExtra(key, T::class.java)
    } else {
        @Suppress("DEPRECATION")
        getParcelableExtra(key)
    }
