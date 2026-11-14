# The web app calls these methods by name through addJavascriptInterface
-keepclassmembers class com.adi6499.sukoon.Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
