/*
 * GENERATED — do not edit by hand.
 *
 * Source of truth: packages/protocol/src/{messages,session,errors}.ts
 * Regenerate: pnpm --filter @crossscreen/protocol generate:kotlin
 *
 * Not enforced in CI yet (phase-4-android.md exit criterion 6's second
 * half) — a protocol change and forgetting to re-run this will not fail a
 * build on its own. Re-run it whenever packages/protocol/src changes.
 */

package app.crossscreen.android.protocol

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Matches PROTOCOL_VERSION in packages/protocol/src/constants.ts. A mismatch is refused, never guessed at. */
const val PROTOCOL_VERSION: Int = 1


@Serializable
enum class ConnectionQuality {
    @SerialName("excellent") EXCELLENT,
    @SerialName("good") GOOD,
    @SerialName("poor") POOR,
    @SerialName("unstable") UNSTABLE,
}

@Serializable
enum class ConnectionState {
    @SerialName("connecting") CONNECTING,
    @SerialName("checking") CHECKING,
    @SerialName("securing") SECURING,
    @SerialName("connected") CONNECTED,
    @SerialName("unstable") UNSTABLE,
    @SerialName("reconnecting") RECONNECTING,
    @SerialName("failed") FAILED,
}

@Serializable
enum class Transport {
    @SerialName("direct") DIRECT,
    @SerialName("relay") RELAY,
    @SerialName("unknown") UNKNOWN,
}

@Serializable
enum class SessionState {
    @SerialName("waiting") WAITING,
    @SerialName("active") ACTIVE,
    @SerialName("ended") ENDED,
    @SerialName("expired") EXPIRED,
}

@Serializable
enum class ParticipantRole {
    @SerialName("host") HOST,
    @SerialName("viewer") VIEWER,
}

@Serializable
enum class ParticipantState {
    @SerialName("pending") PENDING,
    @SerialName("approved") APPROVED,
    @SerialName("rejected") REJECTED,
    @SerialName("connected") CONNECTED,
    @SerialName("disconnected") DISCONNECTED,
}

@Serializable
enum class JoinedVia {
    @SerialName("code") CODE,
    @SerialName("link") LINK,
}

@Serializable
enum class EndReason {
    @SerialName("host_ended") HOST_ENDED,
    @SerialName("expired") EXPIRED,
    @SerialName("idle_timeout") IDLE_TIMEOUT,
}

@Serializable
enum class ErrorCode {
    @SerialName("SESSION_NOT_FOUND") SESSION_NOT_FOUND,
    @SerialName("SESSION_EXPIRED") SESSION_EXPIRED,
    @SerialName("SESSION_ENDED_BY_HOST") SESSION_ENDED_BY_HOST,
    @SerialName("SESSION_FULL") SESSION_FULL,
    @SerialName("SESSION_LOCKED") SESSION_LOCKED,
    @SerialName("JOIN_REJECTED") JOIN_REJECTED,
    @SerialName("JOIN_REQUEST_TIMED_OUT") JOIN_REQUEST_TIMED_OUT,
    @SerialName("INVALID_TOKEN") INVALID_TOKEN,
    @SerialName("TOKEN_EXPIRED") TOKEN_EXPIRED,
    @SerialName("NOT_SESSION_HOST") NOT_SESSION_HOST,
    @SerialName("RATE_LIMITED") RATE_LIMITED,
    @SerialName("TOO_MANY_SESSIONS") TOO_MANY_SESSIONS,
    @SerialName("CONNECTION_FAILED") CONNECTION_FAILED,
    @SerialName("CONNECTION_LOST") CONNECTION_LOST,
    @SerialName("SIGNALING_UNAVAILABLE") SIGNALING_UNAVAILABLE,
    @SerialName("CAPTURE_PERMISSION_DENIED") CAPTURE_PERMISSION_DENIED,
    @SerialName("CAPTURE_UNAVAILABLE") CAPTURE_UNAVAILABLE,
    @SerialName("CAPTURE_STOPPED_BY_SYSTEM") CAPTURE_STOPPED_BY_SYSTEM,
    @SerialName("MALFORMED_MESSAGE") MALFORMED_MESSAGE,
    @SerialName("UNSUPPORTED_PROTOCOL_VERSION") UNSUPPORTED_PROTOCOL_VERSION,
    @SerialName("MESSAGE_TOO_LARGE") MESSAGE_TOO_LARGE,
    @SerialName("INTERNAL_ERROR") INTERNAL_ERROR,
}

@Serializable
data class ResumeInfo(
    val participantId: String,
    val participantToken: String,
)

@Serializable
data class Participant(
    val participantId: String,
    val role: ParticipantRole,
    val state: ParticipantState,
    val deviceLabel: String,
    val joinedAt: Long? = null,
)

@Serializable
data class SessionSummary(
    val joinCode: String,
    val state: SessionState,
    val createdAt: Long,
    val expiresAt: Long,
    val participants: List<Participant>,
)

@Serializable
data class JoinRequestInfo(
    val participantId: String,
    val deviceLabel: String,
    val approximateLocation: String? = null,
    val joinedVia: JoinedVia,
    val requestedAt: Long,
)

@Serializable
sealed interface ClientMessage {

    @Serializable
    @SerialName("session.host.attach")
    data class SessionHostAttach(
        val hostToken: String,
    ) : ClientMessage

    @Serializable
    @SerialName("session.viewer.request")
    data class SessionViewerRequest(
        val joinCode: String? = null,
        val joinToken: String? = null,
        val resume: ResumeInfo? = null,
    ) : ClientMessage

    @Serializable
    @SerialName("session.viewer.approve")
    data class SessionViewerApprove(
        val participantId: String,
    ) : ClientMessage

    @Serializable
    @SerialName("session.viewer.reject")
    data class SessionViewerReject(
        val participantId: String,
    ) : ClientMessage

    @Serializable
    @SerialName("session.end")
    data object SessionEnd : ClientMessage

    @Serializable
    @SerialName("session.viewer.leave")
    data object SessionViewerLeave : ClientMessage

    @Serializable
    @SerialName("rtc.offer")
    data class RtcOffer(
        val to: String,
        val sdp: String,
    ) : ClientMessage

    @Serializable
    @SerialName("rtc.answer")
    data class RtcAnswer(
        val to: String,
        val sdp: String,
    ) : ClientMessage

    @Serializable
    @SerialName("rtc.ice")
    data class RtcIce(
        val to: String,
        val candidate: String,
        val sdpMid: String?,
        val sdpMLineIndex: Long?,
    ) : ClientMessage

    @Serializable
    @SerialName("rtc.restart")
    data class RtcRestart(
        val to: String,
    ) : ClientMessage

    @Serializable
    @SerialName("stats.report")
    data class StatsReport(
        val quality: ConnectionQuality,
        val connectionState: ConnectionState,
        val transport: Transport,
        val roundTripMs: Double? = null,
        val packetLossPct: Double? = null,
        val bitrateKbps: Double? = null,
        val framesPerSecond: Double? = null,
        val resolution: String? = null,
        val codec: String? = null,
    ) : ClientMessage

    @Serializable
    @SerialName("session.report")
    data class SessionReport(
        val reason: String? = null,
    ) : ClientMessage

    @Serializable
    @SerialName("ping")
    data object Ping : ClientMessage
}

@Serializable
sealed interface ServerMessage {

    @Serializable
    @SerialName("session.state")
    data class SessionState(
        val session: SessionSummary,
        val you: String,
    ) : ServerMessage

    @Serializable
    @SerialName("session.viewer.pending")
    data class SessionViewerPending(
        val request: JoinRequestInfo,
    ) : ServerMessage

    @Serializable
    @SerialName("session.viewer.approved")
    data class SessionViewerApproved(
        val participantId: String,
        val participantToken: String,
    ) : ServerMessage

    @Serializable
    @SerialName("session.viewer.rejected")
    data object SessionViewerRejected : ServerMessage

    @Serializable
    @SerialName("peer.joined")
    data class PeerJoined(
        val participant: Participant,
    ) : ServerMessage

    @Serializable
    @SerialName("peer.left")
    data class PeerLeft(
        val participantId: String,
    ) : ServerMessage

    @Serializable
    @SerialName("session.ended")
    data class SessionEnded(
        val reason: EndReason,
    ) : ServerMessage

    @Serializable
    @SerialName("rtc.offer")
    data class RtcOffer(
        val from: String,
        val sdp: String,
    ) : ServerMessage

    @Serializable
    @SerialName("rtc.answer")
    data class RtcAnswer(
        val from: String,
        val sdp: String,
    ) : ServerMessage

    @Serializable
    @SerialName("rtc.ice")
    data class RtcIce(
        val from: String,
        val candidate: String,
        val sdpMid: String?,
        val sdpMLineIndex: Long?,
    ) : ServerMessage

    @Serializable
    @SerialName("rtc.restart")
    data class RtcRestart(
        val from: String,
    ) : ServerMessage

    @Serializable
    @SerialName("error")
    data class ErrorMessage(
        val code: ErrorCode,
        val userMessage: String,
        val retryable: Boolean,
        val inReplyTo: String? = null,
    ) : ServerMessage

    @Serializable
    @SerialName("session.report.received")
    data object SessionReportReceived : ServerMessage

    @Serializable
    @SerialName("pong")
    data object Pong : ServerMessage
}

@Serializable
data class ClientEnvelope(
    val v: Int,
    val id: String,
    val ts: Long,
    val payload: ClientMessage,
)

@Serializable
data class ServerEnvelope(
    val v: Int,
    val id: String,
    val ts: Long,
    val payload: ServerMessage,
)
