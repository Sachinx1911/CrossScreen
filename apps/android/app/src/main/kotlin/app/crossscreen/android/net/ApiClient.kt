package app.crossscreen.android.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.webrtc.PeerConnection

/**
 * The HTTP half of the API, ported from `packages/webrtc-core/src/api-client.ts`.
 * Small on purpose: create a session, and ask where the ICE servers are — a
 * client never hardcodes a TURN provider (ADR-0004), which is the whole
 * reason `/ice-servers` exists.
 *
 * `baseUrl` is the dev server the phone can actually reach — a tunnel URL,
 * usually (Settings → Server). There is no production default yet: no domain
 * has been chosen (ADR-0010).
 */
@Serializable
data class CreatedSession(
    val joinCode: String,
    val joinCodeDisplay: String,
    val joinToken: String,
    val shareLink: String,
    val hostToken: String,
    val expiresAt: Long,
)

class ApiException(
    message: String,
    val status: Int,
    val code: String? = null,
    cause: Throwable? = null,
) : Exception(message, cause)

class ApiClient(baseUrl: String, private val http: OkHttpClient = OkHttpClient()) {
    private val base = baseUrl.trimEnd('/')
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun createSession(): CreatedSession =
        request("POST", "/api/v1/sessions", CreatedSession.serializer())

    suspend fun iceServers(): List<PeerConnection.IceServer> {
        val body = request("GET", "/api/v1/ice-servers", IceServersResponse.serializer())
        return body.iceServers.mapNotNull { it.toWebRtc() }
    }

    private suspend fun <T> request(
        method: String,
        path: String,
        deserializer: DeserializationStrategy<T>,
    ): T = withContext(Dispatchers.IO) {
        val builder = Request.Builder()
            .url("$base$path")
            .header("accept", "application/json")
        if (method == "POST") builder.post("".toRequestBody(null))

        val response = try {
            http.newCall(builder.build()).execute()
        } catch (io: java.io.IOException) {
            // A network failure and a server that is unreachable read the same
            // to the user, and there is nothing different to do about either.
            throw ApiException(
                "CrossScreen is unreachable. Check the server address and your connection.",
                status = 0,
                cause = io,
            )
        }

        response.use {
            val text = it.body?.string().orEmpty()
            if (!it.isSuccessful) {
                // Rate-limit / abuse refusals carry { error, userMessage } —
                // the same shape the WebSocket errors use. Fall back to a
                // generic line for a bodyless response or a proxy error page.
                val err = runCatching { json.decodeFromString(ApiErrorBody.serializer(), text) }.getOrNull()
                throw ApiException(
                    err?.userMessage ?: "CrossScreen is having trouble. Please try again.",
                    it.code,
                    err?.error,
                )
            }
            json.decodeFromString(deserializer, text)
        }
    }
}

@Serializable
private data class ApiErrorBody(val error: String? = null, val userMessage: String? = null)

@Serializable
private data class IceServersResponse(val iceServers: List<IceServerDto> = emptyList())

/**
 * `RTCIceServer.urls` is a string or an array of strings in the spec; this
 * API always sends an array (STUN today, TURN once configured), so only the
 * array shape is parsed. `url` (singular) is accepted as a legacy fallback.
 */
@Serializable
private data class IceServerDto(
    val urls: List<String> = emptyList(),
    val url: String? = null,
    val username: String? = null,
    val credential: String? = null,
) {
    fun toWebRtc(): PeerConnection.IceServer? {
        val allUrls = if (urls.isNotEmpty()) urls else listOfNotNull(url)
        if (allUrls.isEmpty()) return null
        val builder = PeerConnection.IceServer.builder(allUrls)
        val user = username
        val cred = credential
        if (user != null) builder.setUsername(user)
        if (cred != null) builder.setPassword(cred)
        return builder.createIceServer()
    }
}
