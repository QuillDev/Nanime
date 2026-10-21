package dev.nanime.android.shell

import java.net.URI

/** The one Nanime server this install talks to, normalized to `scheme://host[:port]`. */
@JvmInline
value class ServerOrigin private constructor(val value: String) {
    val url: String get() = "$value/"

    /** Pages that belong inside the app: the server itself and AniList's OAuth hop back to it. */
    fun opensInApp(link: String): Boolean {
        val uri = runCatching { URI(link) }.getOrNull() ?: return false
        if (originOf(uri) == value) {
            return true
        }
        return uri.scheme == "https" && uri.host == "anilist.co" && uri.rawPath.orEmpty().startsWith("/api/v2/oauth/")
    }

    /**
     * The approval page for a TV sign-in code the web page handed to the app
     * (`nanime://link?code=…`, see src/components/LoginScreen.tsx); null for anything else.
     */
    fun deviceLinkPage(link: String): String? {
        val uri = runCatching { URI(link) }.getOrNull() ?: return null
        if (uri.scheme != "nanime" || uri.host != "link") {
            return null
        }
        val code = uri.rawQuery.orEmpty().split('&').firstOrNull { it.startsWith("code=") }?.removePrefix("code=")
        return code?.takeIf { DEVICE_CODE.matches(it) }?.let { "$value/link?code=$it" }
    }

    companion object {
        private val DEVICE_CODE = Regex("[A-Za-z0-9-]{4,20}")

        /** Accepts `anime.example.com`, `https://anime.example.com/` or `http://10.0.0.5:8096`; null otherwise. */
        fun parse(input: String): ServerOrigin? {
            val trimmed = input.trim().trimEnd('/')
            if (trimmed.isEmpty()) {
                return null
            }
            val withScheme = if ("://" in trimmed) trimmed else "https://$trimmed"
            val uri = runCatching { URI(withScheme) }.getOrNull() ?: return null
            val bare = uri.rawPath.isNullOrEmpty() && uri.rawQuery == null && uri.rawFragment == null && uri.rawUserInfo == null
            return if (bare) originOf(uri)?.let(::ServerOrigin) else null
        }

        private fun originOf(uri: URI): String? {
            val scheme = uri.scheme?.lowercase()
            val host = uri.host?.lowercase()
            if (scheme !in setOf("http", "https") || host.isNullOrEmpty()) {
                return null
            }
            val defaultPort = if (scheme == "https") 443 else 80
            val port = if (uri.port == -1 || uri.port == defaultPort) "" else ":${uri.port}"
            return "$scheme://$host$port"
        }
    }
}
