import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.agrisync.shramsafal',
  appName: 'ShramSafal',
  webDir: 'dist',
  server: {
    // No URL = bundled assets (production mode)
    androidScheme: 'https'
  },
  plugins: {
    Camera: { presentationStyle: 'fullscreen' },
    SplashScreen: { launchAutoHide: true, showSpinner: false },
    Keyboard: { resize: 'body', resizeOnFullScreen: true }
  }
};

export default config;
