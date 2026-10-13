import { defineConfig, devices } from '@playwright/test';

const CHROMIUM_FAKE_MIC_ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];

export default defineConfig({
  testDir: './specs',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    storageState: undefined,
  },
  projects: [
    // Chromium-only switches: synthetic microphone for the voice-diary journey
    // (06_voice_diary_consent_gate). Never pass these to webkit - it exits at launch.
    { name: 'chromium', use: { ...devices['Desktop Chrome'], permissions: ['microphone'], launchOptions: { args: CHROMIUM_FAKE_MIC_ARGS } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-android', use: { ...devices['Pixel 5'], permissions: ['microphone'], launchOptions: { args: CHROMIUM_FAKE_MIC_ARGS } } },
  ],
  // Always start vite preview. The original `process.env.CI ? undefined`
  // gate assumed the workflow would start the preview server itself, but
  // e2e.yml only starts the backend — Playwright must boot the frontend.
  // `reuseExistingServer: !process.env.CI` keeps local-dev DX (re-use
  // a running preview between runs) while forcing a fresh server in CI.
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { VITE_E2E_HARNESS: '1' },
  },
});
