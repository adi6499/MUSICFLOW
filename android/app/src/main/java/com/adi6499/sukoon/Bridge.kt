package com.adi6499.sukoon

import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * What the web app can ask Android to do. It appears inside the page as
 * `window.SukoonNative` (see src/lib/native.ts in the web app).
 *
 * These methods are called on a background thread, never the main one.
 */
class Bridge(private val activity: MainActivity) {

    private val network = Executors.newFixedThreadPool(2)

    /** The song or the play/pause state changed: update the notification and lock screen. */
    @JavascriptInterface
    fun update(json: String) {
        val state = try {
            val o = JSONObject(json)
            NowPlaying(
                id = o.optString("id"),
                title = o.optString("title"),
                artist = o.optString("artist"),
                album = o.optString("album"),
                image = o.optString("image"),
                playing = o.optBoolean("playing"),
                position = o.optDouble("position", 0.0).let { if (it.isNaN()) 0.0 else it },
                duration = o.optDouble("duration", 0.0).let { if (it.isNaN() || it.isInfinite()) 0.0 else it },
            )
        } catch (_: Exception) {
            return
        }
        activity.runOnUiThread { activity.onPlayback(state) }
    }

    /**
     * Send a JSON POST and hand the answer back to the page. Web pages are not
     * allowed to ask YouTube Music directly; the app is. Only that one host is
     * permitted, so this cannot be used to reach anything else.
     */
    @JavascriptInterface
    fun httpPost(id: String, url: String, body: String) {
        val target = try { URL(url) } catch (_: Exception) { null }
        if (target == null || target.protocol != "https" || target.host != "music.youtube.com") {
            answer(id, false, "That address is not allowed.")
            return
        }
        network.execute {
            try {
                val conn = target.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.connectTimeout = 12000
                conn.readTimeout = 15000
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Origin", "https://music.youtube.com")
                conn.setRequestProperty("Referer", "https://music.youtube.com/")
                conn.setRequestProperty("Accept-Language", "en-IN,en;q=0.9")
                conn.setRequestProperty(
                    "User-Agent",
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
                )
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                val code = conn.responseCode
                if (code !in 200..299) {
                    conn.disconnect()
                    answer(id, false, "YouTube Music answered $code")
                    return@execute
                }
                val text = conn.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }
                conn.disconnect()
                answer(id, true, text)
            } catch (e: Exception) {
                answer(id, false, "Couldn't reach YouTube Music. Check your internet and try again.")
            }
        }
    }

    private fun answer(id: String, ok: Boolean, text: String) {
        // JSONObject.quote turns any text into a safe, quoted piece of JavaScript.
        activity.callJs("window.__sukoon&&window.__sukoon('http',${JSONObject.quote(id)},$ok,${JSONObject.quote(text)})")
    }

    /** Save a backup: Android asks the person where to put the file. */
    @JavascriptInterface
    fun saveText(name: String, text: String) {
        activity.runOnUiThread { activity.saveText(name, text) }
    }

    /** Light or dark was chosen in the app: make the status-bar icons readable. */
    @JavascriptInterface
    fun theme(dark: Boolean) {
        activity.runOnUiThread { activity.applyTheme(dark, null) }
    }

    /** The same, with the chosen theme's background colour ("#rrggbb"). */
    @JavascriptInterface
    fun themeColor(dark: Boolean, background: String) {
        activity.runOnUiThread { activity.applyTheme(dark, background) }
    }
}
