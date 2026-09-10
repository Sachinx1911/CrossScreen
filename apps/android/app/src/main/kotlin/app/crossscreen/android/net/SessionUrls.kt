package app.crossscreen.android.net

import app.crossscreen.android.protocol.ConnectionState
import app.crossscreen.android.protocol.EndReason
import org.webrtc.PeerConnection

/** `https://host` (or `http://host`) → `wss://host/ws` (or `ws://host/ws`). The Vite dev server proxies `/ws` to signaling and `/api` to the API, so one base URL serves both. */
internal fun signalingUrlFrom(base: String): String {
    val trimmed = base.trim().trimEnd('/')
    val ws = when {
        trimmed.startsWith("https://") -> "wss://" + trimmed.removePrefix("https://")
        trimmed.startsWith("http://") -> "ws://" + trimmed.removePrefix("http://")
        trimmed.startsWith("wss://") || trimmed.startsWith("ws://") -> trimmed
        else -> "wss://$trimmed"
    }
    return "$ws/ws"
}

/** `RTCPeerConnectionState` is a debugging vocabulary; map it to the words architecture §67 defines (mirrors userFacingState in sharer-session.ts). */
internal fun userFacingState(state: PeerConnection.PeerConnectionState?): ConnectionState = when (state) {
    PeerConnection.PeerConnectionState.NEW, null -> ConnectionState.CONNECTING
    PeerConnection.PeerConnectionState.CONNECTING -> ConnectionState.CHECKING
    PeerConnection.PeerConnectionState.CONNECTED -> ConnectionState.CONNECTED
    PeerConnection.PeerConnectionState.DISCONNECTED -> ConnectionState.UNSTABLE
    PeerConnection.PeerConnectionState.FAILED, PeerConnection.PeerConnectionState.CLOSED -> ConnectionState.FAILED
}

internal fun endReasonText(reason: EndReason): String = when (reason) {
    EndReason.HOST_ENDED -> "The host ended the session."
    EndReason.EXPIRED -> "This session has expired."
    EndReason.IDLE_TIMEOUT -> "The session ended because nobody was watching."
}
