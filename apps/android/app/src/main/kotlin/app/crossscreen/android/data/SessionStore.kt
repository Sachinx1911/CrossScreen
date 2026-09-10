package app.crossscreen.android.data

import android.content.SharedPreferences
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * The "Recent Sessions" list the mockup shows on Home, Join and the
 * Sessions tab — local to this device, no account behind it (ADR-0007).
 *
 * Stored as a JSON array in the app's existing `SharedPreferences`: the
 * list is short (capped at [MAX]), written once per share/join, read on a
 * screen open. A database would be a dependency and a schema to migrate for
 * something a couple of KB of string covers. `kotlinx.serialization` is
 * already on the classpath for the wire protocol.
 */
@Serializable
data class SessionRecord(
    /** Bare digits, e.g. "482719"; formatted for display where it is shown. */
    val code: String,
    val role: Role,
    val startedAtMillis: Long,
    /** Free text for now — "Ended", "Expired", "Left". Not a wire enum. */
    val status: String,
) {
    enum class Role { HOST, VIEWER }
}

class SessionStore(private val prefs: SharedPreferences) {
    private val json = Json { ignoreUnknownKeys = true }
    private val listSerializer = ListSerializer(SessionRecord.serializer())

    fun recent(): List<SessionRecord> {
        val raw = prefs.getString(KEY, null) ?: return emptyList()
        return runCatching { json.decodeFromString(listSerializer, raw) }
            .getOrDefault(emptyList())
    }

    fun add(record: SessionRecord) {
        val updated = (listOf(record) + recent()).take(MAX)
        prefs.edit().putString(KEY, json.encodeToString(listSerializer, updated)).apply()
    }

    fun clear() {
        prefs.edit().remove(KEY).apply()
    }

    private companion object {
        const val KEY = "session_history"
        const val MAX = 30
    }
}
