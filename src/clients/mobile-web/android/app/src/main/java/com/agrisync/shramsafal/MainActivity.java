package com.agrisync.shramsafal;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import java.util.Locale;

public class MainActivity extends BridgeActivity {

    // Capacitor's SystemBars plugin only publishes the status/navigation bar sizes to the page
    // (--safe-area-inset-* CSS variables) on Android 15+ (API 35). Below that the page is still
    // drawn edge-to-edge (setDecorFitsSystemWindows(false) below) but the WebView reports
    // env(safe-area-inset-*) as 0 unless the phone has a display cutout, so the header sat under
    // the status bar on Android 14 and older. We publish the same variables ourselves on
    // API < 35 only; on API 35+ Capacitor does it and this stays out of the way (no double padding).
    private static final int FIRST_API_WITH_CAPACITOR_INSETS = 35;

    private Insets legacySafeArea = Insets.NONE;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureNativeShell();
    }

    // RECORD_AUDIO is deliberately NOT requested here. It used to be (a first-use
    // workaround), which raised the OS prompt on every cold start before the farmer
    // touched the mic. The permission is now requested at his first mic tap: the
    // WebView's getUserMedia() raises Capacitor's permission launcher and resumes the
    // same call on grant (see src/infrastructure/voice/acquireMicStream.ts).

    private void configureNativeShell() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            controller.setAppearanceLightStatusBars(true);
            controller.setAppearanceLightNavigationBars(true);
        }

        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }

        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportZoom(false);

        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setBackgroundColor(Color.TRANSPARENT);

        View parent = (View) webView.getParent();
        if (parent != null) {
            parent.setOverScrollMode(View.OVER_SCROLL_NEVER);
            parent.setBackgroundColor(Color.TRANSPARENT);
        }

        if (Build.VERSION.SDK_INT < FIRST_API_WITH_CAPACITOR_INSETS) {
            installLegacySafeAreaInsets(webView, parent);
        }
    }

    private void installLegacySafeAreaInsets(WebView webView, View insetsHost) {
        if (insetsHost == null) {
            return;
        }

        ViewCompat.setOnApplyWindowInsetsListener(insetsHost, (v, insets) -> {
            Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            // Same rule as Capacitor's SystemBars: while the keyboard is up the bottom bar is
            // not the page's concern (the keyboard plugin resizes the body).
            int bottom = insets.isVisible(WindowInsetsCompat.Type.ime()) ? 0 : bars.bottom;
            legacySafeArea = Insets.of(bars.left, bars.top, bars.right, bottom);
            publishLegacySafeArea(webView);
            return insets;
        });

        // The variables live on the page's <html> element, so a freshly loaded page needs them
        // again. Re-publish at first paint and let the system re-deliver the insets.
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageCommitVisible(WebView view, String url) {
                publishLegacySafeArea(webView);
                webView.requestApplyInsets();
            }
        });
        webView.requestApplyInsets();
    }

    private void publishLegacySafeArea(WebView webView) {
        float density = getResources().getDisplayMetrics().density;
        String script = String.format(
            Locale.US,
            "try{var s=document.documentElement.style;"
                + "s.setProperty('--safe-area-inset-top','%dpx');"
                + "s.setProperty('--safe-area-inset-right','%dpx');"
                + "s.setProperty('--safe-area-inset-bottom','%dpx');"
                + "s.setProperty('--safe-area-inset-left','%dpx');}catch(e){}",
            (int) Math.ceil(legacySafeArea.top / density),
            (int) Math.ceil(legacySafeArea.right / density),
            (int) Math.ceil(legacySafeArea.bottom / density),
            (int) Math.ceil(legacySafeArea.left / density));
        webView.evaluateJavascript(script, null);
    }
}
