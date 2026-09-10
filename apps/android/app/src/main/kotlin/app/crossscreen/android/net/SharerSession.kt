package app.crossscreen.android.net

import android.util.Log
import app.crossscreen.android.protocol.ClientMessage
import app.crossscreen.android.protocol.ConnectionState
import app.crossscreen.android.protocol.JoinRequestInfo
import app.crossscreen.android.protocol.ServerMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.webrtc.IceCandidate
import org.webrtc.PeerConnection
import org.webrtc.SessionDescription
import org.webrtc.VideoTrack

/**
 * Sharing a phone screen, end to end — the Kotlin counterpart of
 * `packages/webrtc-core/src/sharer-session.ts`, cut to the happy path:
 * create a session, attach as host, wait for someone to ask, and — only
 * once the host says yes — negotiate with them. That order is ADR-0006.
 *
 * Deliberately not ported yet: stats reporting, quality tuning, forced
 * relay, ICE-restart recovery, and more than one viewer at a time. Each is
 * additive on top of a connection that works.
 */
class SharerSession(
    private val scope: CoroutineScope,
    serverBaseUrl: String,
    private val track: VideoTrack,
) {
    data class Ui(
        val joinCode: String? = null,
        val joinCodeDisplay: String? = null,
        val shareLink: String? = null,
        val pending: List<JoinRequestInfo> = emptyList(),
        val viewerCount: Int = 0,
        val connection: ConnectionState = ConnectionState.CONNECTING,
        val error: String? = null,
        val ended: String? = null,
    )

    private val api = ApiClient(serverBaseUrl.trim().trimEnd('/'))
    private val wsUrl = signalingUrlFrom(serverBaseUrl)

    private val _ui = MutableStateFlow(Ui())
    val ui: StateFlow<Ui> = _ui.asStateFlow()

    private var signaling: SignalingClient? = null
    private var hostToken: String? = null
    private var iceServers: List<PeerConnection.IceServer> = emptyList()
    private val peers = mutableMapOf<String, Peer>()
    private var stopped = false

    private class Peer(val pc: PeerConnection, val ice: IceCandidateQueue)

    suspend fun start() {
        iceServers = try {
            api.iceServers()
        } catch (e: ApiException) {
            _ui.update { it.copy(error = e.message) }
            return
        }

        val session = try {
            api.createSession()
        } catch (e: ApiException) {
            _ui.update { it.copy(error = e.message) }
            return
        }
        hostToken = session.hostToken
        _ui.update {
            it.copy(
                joinCode = session.joinCode,
                joinCodeDisplay = session.joinCodeDisplay,
                shareLink = session.shareLink,
            )
        }

        val client = SignalingClient(wsUrl)
        signaling = client
        wire(client)
        try {
            client.connect()
        } catch (e: Exception) {
            _ui.update { it.copy(error = "Couldn't reach the server at $wsUrl.") }
            return
        }
        if (stopped) {
            client.close()
            return
        }
        client.send(ClientMessage.SessionHostAttach(session.hostToken))
    }

    fun approve(participantId: String) {
        _ui.update { it.copy(pending = it.pending.filterNot { p -> p.participantId == participantId }) }
        signaling?.send(ClientMessage.SessionViewerApprove(participantId))
    }

    fun reject(participantId: String) {
        _ui.update { it.copy(pending = it.pending.filterNot { p -> p.participantId == participantId }) }
        signaling?.send(ClientMessage.SessionViewerReject(participantId))
    }

    fun stop() {
        if (stopped) return
        stopped = true
        signaling?.send(ClientMessage.SessionEnd)
        peers.values.forEach { it.pc.dispose() }
        peers.clear()
        signaling?.close()
        signaling = null
    }

    private fun wire(client: SignalingClient) {
        client.on<ServerMessage.SessionViewerPending> { m ->
            _ui.update { it.copy(pending = it.pending + m.request) }
        }
        client.on<ServerMessage.PeerJoined> { m ->
            scope.launch { offerTo(m.participant.participantId) }
        }
        client.on<ServerMessage.RtcAnswer> { m ->
            val peer = peers[m.from] ?: return@on
            scope.launch {
                try {
                    peer.pc.setRemoteAwait(SessionDescription(SessionDescription.Type.ANSWER, m.sdp))
                    peer.ice.onRemoteDescriptionSet()
                } catch (e: RtcException) {
                    Log.w(TAG, "setRemote(answer) failed", e)
                }
            }
        }
        client.on<ServerMessage.RtcIce> { m ->
            peers[m.from]?.ice?.add(
                IceCandidate(m.sdpMid, (m.sdpMLineIndex ?: 0L).toInt(), m.candidate),
            )
        }
        client.on<ServerMessage.PeerLeft> { m ->
            peers.remove(m.participantId)?.pc?.dispose()
            _ui.update { it.copy(viewerCount = (it.viewerCount - 1).coerceAtLeast(0)) }
        }
        client.on<ServerMessage.SessionEnded> { m ->
            _ui.update { it.copy(ended = endReasonText(m.reason)) }
            stop()
        }
        client.on<ServerMessage.ErrorMessage> { m ->
            _ui.update { it.copy(error = m.userMessage) }
        }
        client.onClosed = {
            if (!stopped) _ui.update { it.copy(ended = "The connection to CrossScreen was lost.") }
        }
    }

    private suspend fun offerTo(participantId: String) {
        val client = signaling ?: return

        val observer = object : PeerObserver() {
            override fun onIceCandidate(candidate: IceCandidate?) {
                candidate ?: return
                client.send(
                    ClientMessage.RtcIce(
                        to = participantId,
                        candidate = candidate.sdp,
                        sdpMid = candidate.sdpMid,
                        sdpMLineIndex = candidate.sdpMLineIndex.toLong(),
                    ),
                )
            }

            override fun onConnectionChange(state: PeerConnection.PeerConnectionState?) {
                _ui.update { ui ->
                    ui.copy(
                        connection = userFacingState(state),
                        viewerCount = if (state == PeerConnection.PeerConnectionState.CONNECTED) {
                            ui.viewerCount.coerceAtLeast(1)
                        } else {
                            ui.viewerCount
                        },
                    )
                }
            }
        }

        val config = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        val pc = WebRtcCore.factory.createPeerConnection(config, observer)
        if (pc == null) {
            _ui.update { it.copy(error = "Could not start the connection.") }
            return
        }
        val ice = IceCandidateQueue().also { it.attach(pc) }
        peers[participantId] = Peer(pc, ice)

        pc.addTrack(track, listOf(STREAM_ID))

        try {
            val offer = pc.createOfferAwait()
            pc.setLocalAwait(offer)
            client.send(ClientMessage.RtcOffer(to = participantId, sdp = offer.description))
        } catch (e: RtcException) {
            Log.w(TAG, "offer failed", e)
            _ui.update { it.copy(error = "Could not start the connection.") }
        }
    }

    private companion object {
        const val TAG = "SharerSession"
        const val STREAM_ID = "screen"
    }
}
