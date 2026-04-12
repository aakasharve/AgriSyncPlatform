import type { CapacitorConfig } from '@capacitor/cli';

const ANDROID_BRAND_ICON = '../marketing-web/public/brand-assets/android-logo.png';

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
    Keyboard: { resize: 'body', resizeOnFullScreen: true }
  }
};

export default config;
