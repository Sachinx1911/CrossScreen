package app.crossscreen.android.protocol

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The generated types compiling proves nothing about whether they actually
 * decode the wire format — `@SerialName` on the wrong thing, or a
 * discriminator kotlinx.serialization is not actually reading from `type`,
 * would still compile. These round-trip real envelope JSON, shaped exactly
 * as `packages/protocol` would produce it, through the generated classes.
 */
class ProtocolTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `a client envelope decodes to the right sealed variant`() {
        val wire =
            """{"v":1,"id":"abc123","ts":1700000000000,"payload":{"type":"session.viewer.approve","participantId":"11111111-1111-4111-8111-111111111111"}}"""

        val envelope = json.decodeFromString<ClientEnvelope>(wire)

        assertEquals(1, envelope.v)
        val payload = envelope.payload
        assertTrue("expected SessionViewerApprove, got $payload", payload is ClientMessage.SessionViewerApprove)
        assertEquals(
            "11111111-1111-4111-8111-111111111111",
            (payload as ClientMessage.SessionViewerApprove).participantId,
        )
    }

    @Test
    fun `an optional field absent from the wire decodes as null, not a crash`() {
        // No joinToken, no resume — exactly what a fresh join by code sends.
        val wire = """{"v":1,"id":"x","ts":0,"payload":{"type":"session.viewer.request","joinCode":"482719"}}"""

        val payload = json.decodeFromString<ClientEnvelope>(wire).payload
        val request = payload as ClientMessage.SessionViewerRequest

        assertEquals("482719", request.joinCode)
        assertEquals(null, request.joinToken)
        assertEquals(null, request.resume)
    }

    @Test
    fun `a required-but-nullable ICE field round-trips an explicit null`() {
        // sdpMid and sdpMLineIndex are required keys whose value can be null
        // (end-of-candidates) — distinct from a merely optional field.
        val wire =
            """{"v":1,"id":"x","ts":0,"payload":{"type":"rtc.ice","from":"11111111-1111-4111-8111-111111111111","candidate":"","sdpMid":null,"sdpMLineIndex":null}}"""

        val ice = json.decodeFromString<ServerEnvelope>(wire).payload as ServerMessage.RtcIce
        assertEquals(null, ice.sdpMid)
        assertEquals(null, ice.sdpMLineIndex)

        val reencoded = json.encodeToString(ServerMessage.RtcIce.serializer(), ice)
        assertTrue(reencoded.contains("\"sdpMid\":null"))
    }

    @Test
    fun `client and server variants with the same wire type do not collide`() {
        // rtc.offer means something different depending on direction — `to`
        // going out, `from` coming back — which is the whole reason these are
        // nested per-interface rather than sharing one top-level class.
        val clientWire =
            """{"v":1,"id":"x","ts":0,"payload":{"type":"rtc.offer","to":"11111111-1111-4111-8111-111111111111","sdp":"v=0"}}"""
        val serverWire =
            """{"v":1,"id":"x","ts":0,"payload":{"type":"rtc.offer","from":"11111111-1111-4111-8111-111111111111","sdp":"v=0"}}"""

        val clientOffer = json.decodeFromString<ClientEnvelope>(clientWire).payload as ClientMessage.RtcOffer
        val serverOffer = json.decodeFromString<ServerEnvelope>(serverWire).payload as ServerMessage.RtcOffer

        assertEquals("11111111-1111-4111-8111-111111111111", clientOffer.to)
        assertEquals("11111111-1111-4111-8111-111111111111", serverOffer.from)
    }

    @Test
    fun `an enum decodes from its wire string, not its Kotlin constant name`() {
        val wire =
            """{"v":1,"id":"x","ts":0,"payload":{"type":"error","code":"SESSION_NOT_FOUND","userMessage":"We couldn't find that session.","retryable":false}}"""

        val error = json.decodeFromString<ServerEnvelope>(wire).payload as ServerMessage.ErrorMessage
        assertEquals(ErrorCode.SESSION_NOT_FOUND, error.code)
        assertEquals(false, error.retryable)
        assertEquals(null, error.inReplyTo)
    }

    @Test
    fun `a nested session summary carries its participants`() {
        val wire =
            """{"v":1,"id":"x","ts":0,"payload":{"type":"session.state","you":"11111111-1111-4111-8111-111111111111","session":{"joinCode":"482719","state":"active","createdAt":0,"expiresAt":1,"participants":[{"participantId":"11111111-1111-4111-8111-111111111111","role":"host","state":"connected","deviceLabel":"Host"}]}}}"""

        val state = json.decodeFromString<ServerEnvelope>(wire).payload as ServerMessage.SessionState
        assertEquals(SessionState.ACTIVE, state.session.state)
        assertEquals(1, state.session.participants.size)
        assertEquals(ParticipantRole.HOST, state.session.participants[0].role)
    }

    @Test
    fun `an unknown field from a newer server does not break an older app`() {
        val wire =
            """{"v":1,"id":"x","ts":0,"payload":{"type":"pong","somethingAddedLater":true}}"""

        val payload = json.decodeFromString<ServerEnvelope>(wire).payload
        assertTrue(payload is ServerMessage.Pong)
    }
}
