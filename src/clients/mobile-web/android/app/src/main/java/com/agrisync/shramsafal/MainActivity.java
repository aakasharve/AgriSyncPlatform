package com.agrisync.shramsafal;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

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
    }
}
