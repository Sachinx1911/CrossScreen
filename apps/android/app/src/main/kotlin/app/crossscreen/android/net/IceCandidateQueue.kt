package app.crossscreen.android.net

import org.webrtc.IceCandidate
import org.webrtc.PeerConnection

/**
 * Holds ICE candidates that arrive before the peer can accept them — ported
 * from `packages/webrtc-core/src/ice-queue.ts`.
 *
 * Signaling delivers candidates and the offer/answer over the same socket,
 * and a peer starts producing candidates the moment it has a local
 * description, so candidates routinely arrive before the offer or answer
 * does. Adding one then is rejected, and a discarded candidate is a
 * connection path silently thrown away — most likely to matter on exactly
 * the slow links (a tunnel, mobile data) where the arrival order is worst.
 */
class IceCandidateQueue {
    private var peer: PeerConnection? = null
    private var remoteReady = false
    private val pending = ArrayDeque<IceCandidate>()

    fun attach(pc: PeerConnection) {
        peer = pc
    }

    /** Call right after `setRemoteDescription` succeeds; drains whatever is held. */
    @Synchronized
    fun onRemoteDescriptionSet() {
        remoteReady = true
        val pc = peer ?: return
        while (pending.isNotEmpty()) pc.addIceCandidate(pending.removeFirst())
    }

    /** Add now if the peer is ready, otherwise hold until [onRemoteDescriptionSet]. */
    @Synchronized
    fun add(candidate: IceCandidate) {
        val pc = peer
        if (pc == null || !remoteReady) {
            pending.add(candidate)
            return
        }
        pc.addIceCandidate(candidate)
    }
}
