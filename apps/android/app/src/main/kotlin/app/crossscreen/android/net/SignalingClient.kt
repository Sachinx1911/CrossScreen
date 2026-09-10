package app.crossscreen.android.net

import android.util.Log
import app.crossscreen.android.protocol.ClientEnvelope
import app.crossscreen.android.protocol.ClientMessage
import app.crossscreen.android.protocol.PROTOCOL_VERSION
import app.crossscreen.android.protocol.ServerEnvelope
import app.crossscreen.android.protocol.ServerMessage
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/**
 * A thin, typed WebSocket client for the signaling protocol — the Kotlin
 * counterpart of `packages/webrtc-core/src/signaling-client.ts`, minus its
 * auto-reconnection for now.
 *
 * Phase 2's rule (a dropped socket must not cost a session its code) needs
 * the reconnect + resume handling the TS client has; that is a follow-up.
 * This first cut connects, sends, dispatches typed messages, and closes —
 * enough to prove a phone can host and join a real session end to end.
 *
 * Messages go out and come in as `{ v, id, ts, payload }` envelopes
 * (`Protocol.kt`), decoded polymorphically on the payload's `type` field —
 * kotlinx.serialization's default discriminator, set here explicitly.
 */
class SignalingClient(
    private val url: String,
    // A ping keeps the socket alive through OkHttp's read timeout and NATs;
    // no auto-reconnect yet, so a genuinely dead link surfaces as onClosed.
    private val http: OkHttpClient = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .build(),
) {
    private val json = Json {
        ignoreUnknownKeys = true
        classDiscriminator = "type"
    }

    private var socket: WebSocket? = null
    private var closedByUs = false
    private val handlers = mutableMapOf<Class<out ServerMessage>, MutableList<(ServerMessage) -> Unit>>()

    /** Reconnection is not built yet, so a drop that is not ours is the end. */
    var onClosed: (() -> Unit)? = null
    var onError: ((Throwable) -> Unit)? = null

    /**
     * The first connection. Fails rather than retrying: a session that cannot
     * reach signaling at all has nothing to preserve, and the caller needs to
     * say so plainly instead of spinning.
     */
    suspend fun connect(): Unit = suspendCancellableCoroutine { cont ->
        val request = Request.Builder().url(url).build()
        socket = http.newWebSocket(
            request,
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    if (cont.isActive) cont.resume(Unit)
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    dispatch(text)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    if (cont.isActive) {
                        cont.resumeWithException(t)
                    } else if (!closedByUs) {
                        onError?.invoke(t)
                        onClosed?.invoke()
                    }
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    if (!closedByUs) onClosed?.invoke()
                }
            },
        )
        cont.invokeOnCancellation { close() }
    }

    /** Subscribe to one server message type. */
    inline fun <reified T : ServerMessage> on(noinline handler: (T) -> Unit) {
        @Suppress("UNCHECKED_CAST")
        register(T::class.java) { handler(it as T) }
    }

    @PublishedApi
    internal fun register(type: Class<out ServerMessage>, handler: (ServerMessage) -> Unit) {
        handlers.getOrPut(type) { mutableListOf() }.add(handler)
    }

    fun send(message: ClientMessage) {
        val ws = socket
        if (ws == null) {
            Log.w(TAG, "not connected; dropping ${message::class.simpleName}")
            return
        }
        val envelope = ClientEnvelope(
            v = PROTOCOL_VERSION,
            id = UUID.randomUUID().toString(),
            ts = System.currentTimeMillis(),
            payload = message,
        )
        ws.send(json.encodeToString(ClientEnvelope.serializer(), envelope))
    }

    fun close() {
        closedByUs = true
        socket?.close(1000, null)
        socket = null
    }

    private fun dispatch(text: String) {
        val payload = try {
            json.decodeFromString(ServerEnvelope.serializer(), text).payload
        } catch (e: Exception) {
            Log.w(TAG, "dropped unparseable frame", e)
            return
        }
        handlers[payload::class.java]?.toList()?.forEach { it(payload) }
    }

    private companion object {
        const val TAG = "SignalingClient"
    }
}
