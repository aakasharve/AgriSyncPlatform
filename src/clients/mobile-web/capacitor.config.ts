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
    Keyboard: { resize: 'body', resizeOnFullScreen: true },
    SpeechRecognition: {}
  }
};

export default config;
