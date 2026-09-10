package app.crossscreen.android.net

import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.RtpReceiver
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription

/**
 * `org.webrtc`'s Java callback surface, wrapped so `SharerSession` and
 * `ViewerSession` can read as the straight-line flows they are.
 *
 * `SdpObserver` and most of `PeerConnection.Observer` have no default
 * implementation, so every method has to be written even to ignore it —
 * hence the no-op bases here.
 */

/** Implement only the callbacks that matter; the rest are ignored. */
open class PeerObserver : PeerConnection.Observer {
    override fun onSignalingChange(state: PeerConnection.SignalingState?) {}
    override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) {}
    override fun onStandardizedIceConnectionChange(state: PeerConnection.IceConnectionState?) {}
    override fun onConnectionChange(state: PeerConnection.PeerConnectionState?) {}
    override fun onIceConnectionReceivingChange(receiving: Boolean) {}
    override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {}
    override fun onIceCandidate(candidate: IceCandidate?) {}
    override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}
    override fun onSelectedCandidatePairChanged(event: org.webrtc.CandidatePairChangeEvent?) {}
    override fun onAddStream(stream: MediaStream?) {}
    override fun onRemoveStream(stream: MediaStream?) {}
    override fun onDataChannel(channel: DataChannel?) {}
    override fun onRenegotiationNeeded() {}
    override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {}
    override fun onTrack(transceiver: RtpTransceiver?) {}
}

private class ContinuationSdpObserver(
    private val onCreate: ((SessionDescription) -> Unit)? = null,
    private val onSet: (() -> Unit)? = null,
    private val onFail: (String) -> Unit,
) : SdpObserver {
    override fun onCreateSuccess(description: SessionDescription) {
        onCreate?.invoke(description)
    }

    override fun onSetSuccess() {
        onSet?.invoke()
    }

    override fun onCreateFailure(error: String?) {
        onFail(error ?: "createSdp failed")
    }

    override fun onSetFailure(error: String?) {
        onFail(error ?: "setSdp failed")
    }
}

suspend fun PeerConnection.createOfferAwait(): SessionDescription =
    suspendCancellableCoroutine { cont ->
        createOffer(
            ContinuationSdpObserver(
                onCreate = { if (cont.isActive) cont.resume(it) },
                onFail = { if (cont.isActive) cont.resumeWithException(RtcException(it)) },
            ),
            MediaConstraints(),
        )
    }

suspend fun PeerConnection.createAnswerAwait(): SessionDescription =
    suspendCancellableCoroutine { cont ->
        createAnswer(
            ContinuationSdpObserver(
                onCreate = { if (cont.isActive) cont.resume(it) },
                onFail = { if (cont.isActive) cont.resumeWithException(RtcException(it)) },
            ),
            MediaConstraints(),
        )
    }

suspend fun PeerConnection.setLocalAwait(description: SessionDescription): Unit =
    suspendCancellableCoroutine<Unit> { cont ->
        setLocalDescription(
            ContinuationSdpObserver(
                onSet = { if (cont.isActive) cont.resume(Unit) },
                onFail = { if (cont.isActive) cont.resumeWithException(RtcException(it)) },
            ),
            description,
        )
    }

suspend fun PeerConnection.setRemoteAwait(description: SessionDescription): Unit =
    suspendCancellableCoroutine<Unit> { cont ->
        setRemoteDescription(
            ContinuationSdpObserver(
                onSet = { if (cont.isActive) cont.resume(Unit) },
                onFail = { if (cont.isActive) cont.resumeWithException(RtcException(it)) },
            ),
            description,
        )
    }

class RtcException(message: String) : Exception(message)
