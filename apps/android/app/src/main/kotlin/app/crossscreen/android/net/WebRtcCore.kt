package app.crossscreen.android.net

import android.content.Context
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.PeerConnectionFactory

/**
 * One `PeerConnectionFactory` and one `EglBase` for the whole process.
 *
 * WebRTC requires that a `VideoTrack` and any `PeerConnection` it is added to
 * come from the *same* factory — so the screen capturer
 * (`capture/ScreenShareService.kt`) and the sessions (`SharerSession`,
 * `ViewerSession`) cannot each own one. `PeerConnectionFactory.initialize()`
 * is also a once-per-process call. Both facts point at a single owner.
 *
 * Deliberately never disposed. The factory is a heavy, long-lived object;
 * apps that share screens create it once and keep it. Per-capture handles
 * (the capturer, its `VideoSource`, the `VideoTrack`) are still disposed
 * where they are made.
 */
object WebRtcCore {
    @Volatile
    private var initialized = false
    private var eglBaseOrNull: EglBase? = null
    private var factoryOrNull: PeerConnectionFactory? = null

    val eglBase: EglBase
        get() = eglBaseOrNull ?: error("WebRtcCore.ensureInitialized() was not called first")

    val factory: PeerConnectionFactory
        get() = factoryOrNull ?: error("WebRtcCore.ensureInitialized() was not called first")

    @Synchronized
    fun ensureInitialized(context: Context) {
        if (initialized) return

        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions
                .builder(context.applicationContext)
                .createInitializationOptions(),
        )

        val egl = EglBase.create()
        eglBaseOrNull = egl
        factoryOrNull = PeerConnectionFactory.builder()
            // Prefer hardware VP8/VP9/H.264 where present, software otherwise.
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(egl.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(egl.eglBaseContext))
            .createPeerConnectionFactory()

        initialized = true
    }
}
