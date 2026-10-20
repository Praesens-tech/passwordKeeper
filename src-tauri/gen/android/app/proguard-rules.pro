# Rust resolves these classes and static methods by name through JNI.
# R8 cannot discover those calls in libapp_lib.so and otherwise removes them.
-keep class com.passwordkeeper.vault.GoogleOAuthManager {
    public static void start(android.content.Context, java.lang.String, java.lang.String, java.lang.String, boolean);
}
-keep class com.passwordkeeper.vault.NativeHttp {
    public static java.lang.String request(android.content.Context, java.lang.String, java.lang.String, java.lang.String, java.lang.String, boolean);
}
-keep class com.passwordkeeper.vault.GoogleOAuthBridge {
    public static native void finishOAuth(java.lang.String, java.lang.String);
}

# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
