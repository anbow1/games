package com.anbow.combatarcade

import android.annotation.SuppressLint
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader

/**
 * Combat Arcade — three WebGL games bundled in `assets/`, picked from a launcher page.
 *
 * Everything is served over https://appassets.androidplatform.net/ rather than file://:
 * the games load Three.js as ES modules through an import map, and module scripts are
 * rejected by CORS on an opaque file:// origin. WebViewAssetLoader answers those
 * requests straight out of the APK, so nothing ever touches the network — the app holds
 * no INTERNET permission.
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private var lastBackAt = 0L

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain(ASSET_DOMAIN)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        if (isDebuggable()) WebView.setWebContentsDebuggingEnabled(true)

        val background = getColor(R.color.app_bg)
        web = WebView(this).apply {
            setBackgroundColor(background)
            isFocusableInTouchMode = true
            overScrollMode = View.OVER_SCROLL_NEVER
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true            // localStorage: graphics preset + aim sensitivity
                mediaPlaybackRequiresUserGesture = false
                cacheMode = WebSettings.LOAD_NO_CACHE
                allowFileAccess = false
                allowContentAccess = false
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
                textZoom = 100                      // ignore the system font scale; the HUD sizes itself in vh
            }
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

                // Everything the game needs is in the APK; refuse to navigate anywhere else.
                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest
                ): Boolean = request.url.host != ASSET_DOMAIN
            }
        }

        setContentView(web)
        goImmersive()
        web.loadUrl(LAUNCHER_URL)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Three levels, in order: a game pauses itself and claims the press;
                // otherwise step back out to the launcher; from the launcher, leave.
                // The launcher defines no __androidBack hook, which is what makes it
                // identifiable as the top of the stack.
                web.evaluateJavascript(BACK_HOOK) { handled ->
                    if (handled == "true") return@evaluateJavascript
                    if (web.canGoBack()) web.goBack() else confirmExit()
                }
            }
        })
    }

    private fun confirmExit() {
        val now = SystemClock.elapsedRealtime()
        if (now - lastBackAt < EXIT_WINDOW_MS) {
            finish()
        } else {
            lastBackAt = now
            Toast.makeText(this, R.string.back_again_to_exit, Toast.LENGTH_SHORT).show()
        }
    }

    private fun goImmersive() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowCompat.getInsetsController(window, web).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private fun isDebuggable() =
        (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) goImmersive()
    }

    override fun onPause() {
        super.onPause()
        // The page also pauses itself on visibilitychange; this stops the render loop and audio.
        web.onPause()
        web.pauseTimers()
    }

    override fun onResume() {
        super.onResume()
        web.resumeTimers()
        web.onResume()
    }

    override fun onDestroy() {
        (web.parent as? ViewGroup)?.removeView(web)
        web.destroy()
        super.onDestroy()
    }

    private companion object {
        const val ASSET_DOMAIN = "appassets.androidplatform.net"
        const val LAUNCHER_URL = "https://$ASSET_DOMAIN/assets/launcher.html"
        const val BACK_HOOK = "(typeof window.__androidBack==='function'&&window.__androidBack()===true)"
        const val EXIT_WINDOW_MS = 2000L
    }
}
