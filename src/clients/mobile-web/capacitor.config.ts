import type { CapacitorConfig } from '@capacitor/cli';

// Source art for the Android launcher icon (moved here when marketing-web was
// retired, 2026-10-03). The generated icons live in android/app/src/main/res.
const ANDROID_BRAND_ICON = './resources/android-logo.png';

const config: CapacitorConfig & {
  android: NonNullable<CapacitorConfig['android']> & { iconPath: string };
} = {
  appId: 'com.agrisync.shramsafal',
  appName: 'ShramSafal',
  webDir: 'dist',
  zoomEnabled: false,
  server: {
    // No URL = bundled assets (production mode)
    androidScheme: 'https'
  },
  android: {
    webContentsDebuggingEnabled: false,
    iconPath: ANDROID_BRAND_ICON
  },
  plugins: {
    Camera: { presentationStyle: 'fullscreen' },
    SplashScreen: { launchAutoHide: true, showSpinner: false },
    StatusBar: {
      overlaysWebView: true,
      style: 'LIGHT',
      backgroundColor: '#FAFAF9'
    },
    SystemBars: {
      insetsHandling: 'css',
      style: 'DARK',
      hidden: false
    },
    // resizeOnFullScreen is OFF (27 Nov 2026, founder's phone: the bottom half of every screen stayed white). That
    // option shrinks the app's whole content area while the keyboard is open and grows it back only inside the
    // keyboard's close ANIMATION; when the close skips that animation (the password screen handing over to the app,
    // a password-manager sheet) the app stays shrunk on every screen until restarted. The app is lifted above the
    // keyboard by the window insets instead, which fire on every open AND close: Capacitor's SystemBars on
    // Android 15+, MainActivity's own listener below that. `resize` is iOS-only (ignored on Android).
    Keyboard: { resize: 'body', resizeOnFullScreen: false },
    SpeechRecognition: {}
  }
};

export default config;
