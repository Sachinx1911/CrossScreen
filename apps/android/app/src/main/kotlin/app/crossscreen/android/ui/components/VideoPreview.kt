package app.crossscreen.android.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import org.webrtc.EglBase
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

/**
 * Renders a WebRTC [VideoTrack] locally with a `SurfaceViewRenderer` — the
 * same renderer the viewer side will use for the remote track, pointed at
 * the local capture for now (ActiveSharingScreen's live preview).
 *
 * `AndroidView`'s factory creates the renderer, initialises it against the
 * capture's GL context, and attaches the track as a sink; `onRelease`
 * detaches and releases it. The composable is only in the tree while a
 * capture exists and the track is stable for that capture's lifetime, so
 * there is no mid-life track swap to re-wire — a fresh capture re-enters
 * this composable and re-runs the factory.
 */
@Composable
fun VideoPreview(
    track: VideoTrack,
    eglContext: EglBase.Context,
    modifier: Modifier = Modifier,
) {
    AndroidView(
        modifier = modifier,
        factory = { context ->
            SurfaceViewRenderer(context).also { view ->
                view.init(eglContext, null)
                view.setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
                view.setEnableHardwareScaler(true)
                track.addSink(view)
            }
        },
        onRelease = { view ->
            track.removeSink(view)
            view.release()
        },
    )
}
