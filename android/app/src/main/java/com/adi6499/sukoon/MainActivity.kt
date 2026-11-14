package com.adi6499.sukoon

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader

/**
 * The whole screen is one web view showing the Sukoon web app, which is packed
 * inside the APK (nothing is downloaded to start it). This class only does the
 * things the web app cannot do for itself: the Back button, the space around
 * the status bar and keyboard, picking and saving files, and handing playback
 * details to [PlaybackService].
 */
class MainActivity : ComponentActivity() {

    private companion object {
        const val HOST = "appassets.androidplatform.net"
        const val START = "https://$HOST/assets/public/index.html"
        const val PREFS = "sukoon"
    }

    private lateinit var container: FrameLayout
    private var webView: WebView? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingSave: String? = null
    private var insetTop = 0f
    private var insetBottom = 0f

    // "Restore from a backup": the web app's file input opens Android's file picker.
    private val pickFile = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        fileCallback?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
        fileCallback = null
    }

    // "Back up": Android asks where to save, then we write the text there.
    private val createFile = registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        val text = pendingSave
        pendingSave = null
        if (uri == null || text == null) return@registerForActivityResult
        try {
            contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray(Charsets.UTF_8)) }
            Toast.makeText(this, "Backup saved", Toast.LENGTH_SHORT).show()
        } catch (_: Exception) {
            Toast.makeText(this, "Couldn't save the backup", Toast.LENGTH_LONG).show()
        }
    }

    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        container = FrameLayout(this)
        setContentView(container)
        buildWebView()

        // Tell the web app how much room the status bar and gesture bar take,
        // and shrink the page when the keyboard is up so nothing hides behind it.
        ViewCompat.setOnApplyWindowInsetsListener(container) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val keyboardUp = ime.bottom > bars.bottom
            val density = resources.displayMetrics.density
            container.setPadding(bars.left, 0, bars.right, if (keyboardUp) ime.bottom else 0)
            insetTop = bars.top / density
            insetBottom = if (keyboardUp) 0f else bars.bottom / density
            sendInsets()
            WindowInsetsCompat.CONSUMED
        }

        // Back: first let the web app close what is open or go back a screen;
        // only when it has nothing left does the app step into the background
        // (music keeps playing).
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val view = webView
                if (view == null) {
                    moveTaskToBack(true)
                    return
                }
                view.evaluateJavascript("(window.__sukoon?window.__sukoon('back'):false)") { handled ->
                    if (handled != "true") moveTaskToBack(true)
                }
            }
        })

        // Buttons on the notification, lock screen and headset reach the web app through here.
        PlaybackService.command = { name, value ->
            if (value != null) callJs("window.__sukoon&&window.__sukoon('$name',$value)")
            else callJs("window.__sukoon&&window.__sukoon('$name')")
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun buildWebView() {
        val assets = WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        val view = WebView(this)
        view.layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        view.setBackgroundColor(ContextCompat.getColor(this, R.color.app_background))
        view.overScrollMode = View.OVER_SCROLL_NEVER
        view.isVerticalScrollBarEnabled = false
        view.isHorizontalScrollBarEnabled = false

        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // Lets "next song" and the notification's Play button start sound without a fresh tap.
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = "$userAgentString SukoonApp/1.0"
        }

        view.addJavascriptInterface(Bridge(this), "SukoonNative")

        view.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(v: WebView, request: WebResourceRequest): WebResourceResponse? =
                assets.shouldInterceptRequest(request.url)

            // Links that leave the app (there are very few) open in the phone's browser.
            override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.host == HOST) return false
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                } catch (_: Exception) {
                }
                return true
            }

            override fun onPageFinished(v: WebView, url: String?) {
                sendInsets()
            }

            // If Android kills the web engine to free memory, start it again instead of crashing.
            override fun onRenderProcessGone(v: WebView, detail: RenderProcessGoneDetail): Boolean {
                if (v === webView) {
                    container.removeView(v)
                    v.destroy()
                    webView = null
                    PlaybackService.stop()
                    buildWebView()
                }
                return true
            }
        }

        view.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(v: WebView, callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    pickFile.launch("*/*")
                    true
                } catch (_: Exception) {
                    fileCallback = null
                    false
                }
            }
        }

        container.addView(view)
        webView = view
        view.loadUrl(START)
    }

    /** Run a line of JavaScript in the web app. Safe to call from any thread. */
    fun callJs(script: String) {
        runOnUiThread {
            try {
                webView?.evaluateJavascript(script, null)
            } catch (_: Exception) {
            }
        }
    }

    private fun sendInsets() {
        callJs("window.__sukoon&&window.__sukoon('insets',$insetTop,$insetBottom)")
    }

    /** Called (on the main thread) whenever the web app's playback state changes. */
    fun onPlayback(state: NowPlaying) {
        PlaybackService.push(applicationContext, state)
        if (state.playing) askForNotificationsOnce()
    }

    /** Newer Android versions want permission before showing the "now playing" notification. Ask once, ever. */
    private fun askForNotificationsOnce() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (prefs.getBoolean("askedNotifications", false)) return
        prefs.edit().putBoolean("askedNotifications", true).apply()
        try {
            askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        } catch (_: Exception) {
        }
    }

    fun saveText(name: String, text: String) {
        pendingSave = text
        try {
            createFile.launch(name)
        } catch (_: Exception) {
            pendingSave = null
            Toast.makeText(this, "Couldn't open the save screen", Toast.LENGTH_LONG).show()
        }
    }

    fun applyTheme(dark: Boolean) {
        val background = if (dark) Color.parseColor("#141312") else Color.parseColor("#F4F1EA")
        window.decorView.setBackgroundColor(background)
        webView?.setBackgroundColor(background)
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }

    override fun onDestroy() {
        PlaybackService.command = null
        if (isFinishing) PlaybackService.stop()
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        webView?.let {
            container.removeView(it)
            it.destroy()
        }
        webView = null
        super.onDestroy()
    }
}
