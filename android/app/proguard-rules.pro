# The game lives in assets/ as plain HTML+JS; nothing here is reachable by reflection.
# Keep the WebView bridge surface intact in case a JavascriptInterface is added later.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
