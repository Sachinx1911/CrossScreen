package app.crossscreen.android.net

import android.util.Log
import app.crossscreen.android.protocol.ClientMessage
import app.crossscreen.android.protocol.ConnectionState
import app.crossscreen.android.protocol.ParticipantState
import app.crossscreen.android.protocol.ServerMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.webrtc.IceCandidate
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.RtpReceiver
import org.webrtc.SessionDescription
import org.webrtc.VideoTrack

/**
 * Watching someone else's screen — the Kotlin counterpart of
 * `packages/webrtc-core/src/viewer-session.ts`, and the simpler half: it
 * asks, waits, and answers whatever offer arrives. It never initiates,
 * because it is never the side that has been trusted (ADR-0006).
 *
 * Not ported yet: resume-after-reconnect, stats, forced relay, ICE-restart
 * requests. The wait between asking and being allowed is the part that
 * matters most, and it is here.
 */
class ViewerSession(
    private val scope: CoroutineScope,
    serverBaseUrl: String,
    private val joinCode: String,
) {
    enum class Phase { CONNECTING, WAITING_FOR_HOST, APPROVED, WATCHING, REJECTED, ENDED, FAILED }

    data class Ui(
        val phase: Phase = Phase.CONNECTING,
        val message: String? = null,
        val connection: ConnectionState = ConnectionState.CONNECTING,
    )

    private val api = ApiClient(serverBaseUrl.trim().trimEnd('/'))
    private val wsUrl = signalingUrlFrom(serverBaseUrl)

    private val _ui = MutableStateFlow(Ui())
    val ui: StateFlow<Ui> = _ui.asStateFlow()

    private val _remoteTrack = MutableStateFlow<VideoTrack?>(null)
    val remoteTrack: StateFlow<VideoTrack?> = _remoteTrack.asStateFlow()

    private var signaling: SignalingClient? = null
    private var pc: PeerConnection? = null
    private var ice: IceCandidateQueue? = null
    private var iceServers: List<PeerConnection.IceServer> = emptyList()
    private var stopped = false

    suspend fun start() {
        iceServers = try {
            api.iceServers()
        } catch (e: ApiException) {
            // STUN alone still works on friendly networks; refusing here
            // would abandon a session that might have connected.
            listOf(
                PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
            )
        }

        val client = SignalingClient(wsUrl)
        signaling = client
        wire(client)
        try {
            client.connect()
        } catch (e: Exception) {
            _ui.update { it.copy(phase = Phase.FAILED, message = "CrossScreen is unreachable at $wsUrl.") }
            return
        }
        if (stopped) {
            client.close()
            return
        }
        client.send(ClientMessage.SessionViewerRequest(joinCode = joinCode))
    }

    fun stop() {
        if (stopped) return
        stopped = true
        signaling?.send(ClientMessage.SessionViewerLeave)
        pc?.dispose()
        pc = null
        signaling?.close()
        signaling = null
    }

    private fun wire(client: SignalingClient) {
        client.on<ServerMessage.SessionState> { m ->
            val self = m.session.participants.firstOrNull { it.participantId == m.you }
            if (self?.state != ParticipantState.CONNECTED) {
                _ui.update { it.copy(phase = Phase.WAITING_FOR_HOST) }
            }
        }
        client.on<ServerMessage.SessionViewerApproved> {
            _ui.update { it.copy(phase = Phase.APPROVED) }
        }
        client.on<ServerMessage.SessionViewerRejected> {
            _ui.update { it.copy(phase = Phase.REJECTED, message = "The host declined your request to join.") }
            stop()
        }
        client.on<ServerMessage.RtcOffer> { m ->
            scope.launch { answer(m.sdp, m.from) }
        }
        client.on<ServerMessage.RtcIce> { m ->
            ice?.add(IceCandidate(m.sdpMid, (m.sdpMLineIndex ?: 0L).toInt(), m.candidate))
        }
        client.on<ServerMessage.SessionEnded> { m ->
            _ui.update { it.copy(phase = Phase.ENDED, message = endReasonText(m.reason)) }
            stop()
        }
        client.on<ServerMessage.ErrorMessage> { m ->
            if (!m.retryable) {
                _ui.update { it.copy(phase = Phase.FAILED, message = m.userMessage) }
            } else {
                _ui.update { it.copy(message = m.userMessage) }
            }
        }
        client.onClosed = {
            if (!stopped) {
                _ui.update { it.copy(phase = Phase.ENDED, message = "The connection to CrossScreen was lost.") }
            }
        }
    }

    private suspend fun answer(sdp: String, from: String) {
        val client = signaling ?: return

        val observer = object : PeerObserver() {
            override fun onIceCandidate(candidate: IceCandidate?) {
                candidate ?: return
                client.send(
                    ClientMessage.RtcIce(
                        to = from,
                        candidate = candidate.sdp,
                        sdpMid = candidate.sdpMid,
                        sdpMLineIndex = candidate.sdpMLineIndex.toLong(),
                    ),
                )
            }

            override fun onConnectionChange(state: PeerConnection.PeerConnectionState?) {
                _ui.update { it.copy(connection = userFacingState(state)) }
            }

            override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {
                val remote = receiver?.track() as? VideoTrack ?: return
                _remoteTrack.value = remote
                _ui.update { it.copy(phase = Phase.WATCHING) }
            }
        }

        val newPc = pc ?: run {
            val config = PeerConnection.RTCConfiguration(iceServers).apply {
                sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            }
            val created = WebRtcCore.factory.createPeerConnection(config, observer)
            if (created == null) {
                _ui.update { it.copy(phase = Phase.FAILED, message = "Could not join the session.") }
                return
            }
            pc = created
            ice = IceCandidateQueue().also { it.attach(created) }
            created
        }

        try {
            newPc.setRemoteAwait(SessionDescription(SessionDescription.Type.OFFER, sdp))
            ice?.onRemoteDescriptionSet()
            val ans = newPc.createAnswerAwait()
            newPc.setLocalAwait(ans)
            client.send(ClientMessage.RtcAnswer(to = from, sdp = ans.description))
        } catch (e: RtcException) {
            Log.w(TAG, "answer failed", e)
            _ui.update { it.copy(phase = Phase.FAILED, message = "Could not join the session.") }
        }
    }

    private companion object {
        const val TAG = "ViewerSession"
    }
}
