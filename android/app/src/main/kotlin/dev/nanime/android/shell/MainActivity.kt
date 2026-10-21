package dev.nanime.android.shell

import android.annotation.SuppressLint
import android.app.UiModeManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.edit
import androidx.core.graphics.toColorInt
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.updatePadding
import androidx.lifecycle.lifecycleScope
import dev.nanime.android.update.AppUpdater
import kotlinx.coroutines.launch

/**
 * Hosts the Nanime web client in a WebView. The UI, its service worker and its
 * offline downloads all come from the server, so every web deploy updates the
 * app; only this shell ships as an APK (see [AppUpdater]).
 */
class MainActivity : ComponentActivity() {
    private val preferences by lazy { getSharedPreferences("shell", Context.MODE_PRIVATE) }
    private val updater by lazy { AppUpdater(this) }

    /** Android TV: the web client turns on remote navigation when the user agent says so. */
    private val television by lazy {
        getSystemService(UiModeManager::class.java)?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
    }
    private lateinit var root: FrameLayout
    private var webView: WebView? = null
    private var fullscreenView: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
    private var pendingFiles: ValueCallback<Array<Uri>>? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        pendingFiles?.onReceiveValue(uris.toTypedArray())
        pendingFiles = null
    }

    private var origin: ServerOrigin?
        get() = preferences.getString("origin", null)?.let(ServerOrigin::parse)
        set(value) = preferences.edit { putString("origin", value?.value) }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime(),
            )
            val padded = fullscreenView == null
            view.updatePadding(
                left = if (padded) bars.left else 0,
                top = if (padded) bars.top else 0,
                right = if (padded) bars.right else 0,
                bottom = if (padded) bars.bottom else 0,
            )
            WindowInsetsCompat.CONSUMED
        }
        setContentView(root)
        onBackPressedDispatcher.addCallback(this, backCallback)

        val server = origin
        if (server == null) {
            showServerPrompt(null)
        } else {
            showWebApp(server, savedInstanceState)
        }
    }

    override fun onResume() {
        super.onResume()
        val server = origin ?: return
        lifecycleScope.launch { updater.checkAndInstall(server, this@MainActivity) }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView?.saveState(outState)
    }

    override fun onPause() {
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onDestroy() {
        webView?.destroy()
        super.onDestroy()
    }

    private val backCallback = object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
            val web = webView
            when {
                fullscreenView != null -> fullscreenCallback?.onCustomViewHidden()
                // The page closes its own dialogs, menus and player first (src/lib/tvRemote.ts).
                web != null -> web.evaluateJavascript("globalThis.nanimeTv?.back() === true") { handled ->
                    if (handled != "true") navigateBack(web)
                }
                else -> leave()
            }
        }

        private fun navigateBack(web: WebView) {
            if (web === webView && web.canGoBack()) web.goBack() else leave()
        }

        private fun leave() {
            isEnabled = false
            onBackPressedDispatcher.onBackPressed()
            isEnabled = true
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun showWebApp(server: ServerOrigin, savedInstanceState: Bundle?) {
        root.removeAllViews()
        val web = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            val version = updater.installedVersionName
            val tvToken = if (television) " NanimeTV/$version" else ""
            settings.userAgentString = "${settings.userAgentString} NanimeAndroid/$version$tvToken"
            webViewClient = ShellWebViewClient(server)
            webChromeClient = ShellChromeClient()
        }
        CookieManager.getInstance().setAcceptCookie(true)
        webView = web
        root.addView(web, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        // A remote's keys go to the focused view; nothing else on screen can take them.
        web.requestFocus()
        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(server.url)
        }
    }

    private inner class ShellWebViewClient(private val server: ServerOrigin) : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val link = request.url.toString()
            if (server.opensInApp(link)) {
                return false
            }
            openExternally(request.url)
            return true
        }

        // A killed renderer (often memory pressure during playback) would otherwise crash the app.
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            if (view === webView) {
                root.removeView(view)
                webView = null
                view.destroy()
                showWebApp(server, null)
            }
            return true
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            // The service worker answers offline navigations itself; this only fires when it cannot.
            if (request.isForMainFrame) {
                showUnreachable(server, error.description?.toString())
            }
        }
    }

    private inner class ShellChromeClient : WebChromeClient() {
        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            fullscreenView = view
            fullscreenCallback = callback
            root.addView(view, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            setSystemBarsHidden(true)
        }

        override fun onHideCustomView() {
            fullscreenView?.let(root::removeView)
            fullscreenView = null
            fullscreenCallback = null
            setSystemBarsHidden(false)
        }

        override fun onShowFileChooser(
            view: WebView,
            callback: ValueCallback<Array<Uri>>,
            params: FileChooserParams,
        ): Boolean {
            pendingFiles?.onReceiveValue(null)
            pendingFiles = callback
            val types = params.acceptTypes.filter { it.contains('/') }.ifEmpty { listOf("*/*") }
            pickFiles.launch(types.toTypedArray())
            return true
        }
    }

    private fun setSystemBarsHidden(hidden: Boolean) {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        if (hidden) {
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
        ViewCompat.requestApplyInsets(root)
    }

    private fun openExternally(uri: Uri) {
        runCatching { CustomTabsIntent.Builder().build().launchUrl(this, uri) }
            .recoverCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
            // Most TVs have no browser.
            .onFailure { Toast.makeText(this, "No app here can open ${uri.host}", Toast.LENGTH_LONG).show() }
    }

    private fun showServerPrompt(error: String?) {
        webView?.destroy()
        webView = null
        root.removeAllViews()
        val input = EditText(this).apply {
            hint = "anime.example.com"
            setText(origin?.value.orEmpty())
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            isSingleLine = true
            inputType = android.text.InputType.TYPE_TEXT_VARIATION_URI
            imeOptions = EditorInfo.IME_ACTION_GO
        }
        val message = label(error ?: "Nanime server address", if (error == null) Color.LTGRAY else ERROR)
        val connect = Button(this).apply { text = "Connect" }
        val submit = {
            val parsed = ServerOrigin.parse(input.text.toString())
            if (parsed == null) {
                message.text = "Enter an address like https://anime.example.com"
                message.setTextColor(ERROR)
            } else {
                origin = parsed
                showWebApp(parsed, null)
            }
        }
        connect.setOnClickListener { submit() }
        input.setOnEditorActionListener { _, _, _ ->
            submit()
            true
        }
        root.addView(column(label("Nanime", ACCENT, 34f), message, input, connect))
        input.requestFocus()
    }

    private fun showUnreachable(server: ServerOrigin, detail: String?) {
        root.removeAllViews()
        webView?.let { it.stopLoading() }
        val retry = Button(this).apply {
            text = "Retry"
            setOnClickListener { showWebApp(server, null) }
        }
        val change = Button(this).apply {
            text = "Change server"
            setOnClickListener { showServerPrompt(null) }
        }
        root.addView(column(label("Can't reach ${server.value}", Color.WHITE, 18f), label(detail.orEmpty(), Color.GRAY), retry, change))
    }

    private fun label(text: String, color: Int, size: Float = 15f) = TextView(this).apply {
        this.text = text
        setTextColor(color)
        textSize = size
        gravity = Gravity.CENTER
    }

    private fun column(vararg views: View) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        val metrics = resources.displayMetrics
        val pad = (24 * metrics.density).toInt()
        // Keep the form a readable width on a TV instead of stretching across it.
        val side = maxOf(pad, (metrics.widthPixels - (560 * metrics.density).toInt()) / 2)
        setPadding(side, pad, side, pad)
        views.forEach { addView(it, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)) }
        layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    }

    companion object {
        private val ACCENT = "#EC4899".toColorInt()
        private val ERROR = "#F87171".toColorInt()
    }
}
