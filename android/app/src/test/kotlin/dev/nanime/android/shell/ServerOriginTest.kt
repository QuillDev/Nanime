package dev.nanime.android.shell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerOriginTest {
    @Test
    fun normalizesTypedServerAddresses() {
        assertEquals("https://anime.example.com", ServerOrigin.parse(" anime.example.com/ ")?.value)
        assertEquals("https://anime.example.com", ServerOrigin.parse("HTTPS://Anime.Example.com:443")?.value)
        assertEquals("http://10.0.0.5:8096", ServerOrigin.parse("http://10.0.0.5:8096")?.value)
    }

    @Test
    fun rejectsAddressesThatAreNotABareOrigin() {
        assertNull(ServerOrigin.parse(""))
        assertNull(ServerOrigin.parse("ftp://anime.example.com"))
        assertNull(ServerOrigin.parse("https://anime.example.com/library"))
        assertNull(ServerOrigin.parse("https://user@anime.example.com"))
    }

    @Test
    fun keepsTheServerAndAniListSignInInsideTheApp() {
        val origin = ServerOrigin.parse("https://anime.example.com")!!

        assertTrue(origin.opensInApp("https://anime.example.com/show/1?x=2"))
        assertTrue(origin.opensInApp("https://anilist.co/api/v2/oauth/authorize?client_id=1"))
        assertFalse(origin.opensInApp("https://anilist.co/anime/1"))
        assertFalse(origin.opensInApp("http://anime.example.com/"))
        assertFalse(origin.opensInApp("https://anime.example.com.evil.test/"))
        assertFalse(origin.opensInApp("https://nyaa.si/view/1"))
    }
}
