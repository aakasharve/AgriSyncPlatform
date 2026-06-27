/**
 * Build identity marker — lets the founder AND us confirm exactly which build is
 * actually running on a device, killing the recurring "is my app stale?"
 * ambiguity (Android silently skips installing an APK with an unchanged
 * versionCode, so an "update" can leave the old bundle in place).
 *
 * Keep APP_VERSION in lockstep with android/app/build.gradle versionName, and
 * bump both on every release. Surfaced via a console marker on boot
 * (index.tsx) so the Chrome DevTools agent can read it, and (Android side) via
 * the OS app-version which the founder can check in Settings → Apps.
 */
export const APP_VERSION = '1.0.5';
export const BUILD_TAG = `ShramSafal v${APP_VERSION} · remembered-device-sessions 2026-06-27`;
