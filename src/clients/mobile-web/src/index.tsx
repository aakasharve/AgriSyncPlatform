/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

// Browser tracing must be initialised before React renders so that the
// initial page-load span captures the full hydration cost.
if (import.meta.env.VITE_OTEL_ENABLED === '1') {
  // Dynamic import keeps OTel out of the main bundle in production builds
  // where VITE_OTEL_ENABLED is unset, enabling tree-shaking.
  import('./infrastructure/observability/OtelBrowserSdk').then(({ startBrowserTracing }) => {
    startBrowserTracing();
  });
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { TenantProvider } from './core/tenant/TenantContext'; // Correct path
import { NotificationService } from './shared/services/NotificationService';
import { eventBus } from './core/telemetry/AnalyticsEventBus';
import { emitClientError } from './core/telemetry/eventEmitters';
import { initSentry } from './lib/sentry';
import { BUILD_TAG } from './buildInfo';

// Build-identity marker (login-cache-ghost / stale-install diagnostics): prints
// the exact running build so we can confirm a device is on the latest bundle
// rather than a silently-skipped stale install. Read by the DevTools agent.
console.log(`%c[ShramSafal] ${BUILD_TAG}`, 'color:#16a34a;font-weight:bold;font-size:13px');

// Sentry must be initialised before the React root renders so that
// the error boundary and unhandled-rejection capture are active for
// the full app lifecycle. No-op when VITE_SENTRY_DSN is not set.
initSentry();

// Register Service Worker for Push Notifications.
// DEV PREVIEW GUARD: never register/keep a service worker on /dev/* preview
// routes — a cached SW serves stale UI and hides live design iterations.
const __isDevPreview = import.meta.env.DEV && window.location.pathname.startsWith('/dev/');
if (__isDevPreview && 'serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    if (typeof caches !== 'undefined') caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
} else {
    NotificationService.registerSW();
    NotificationService.scheduleDisciplineNudges();
}

// login-cache-ghost fix (2026-06-11): when a NEW service worker takes control
// (after an app update OR the stale-shell-cache migration), reload ONCE so the
// fresh app shell renders immediately. Without this, the first open after an
// update can briefly show the previously-cached screen (the "old login UI"
// ghost) until the user manually relaunches. Guarded so it never loops.
if (!__isDevPreview && 'serviceWorker' in navigator) {
    let swReloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (swReloaded) return;
        swReloaded = true;
        window.location.reload();
    });
}

// DWC v2 §2.6 — boot the analytics event bus and wire the global
// error/unhandledrejection sinks into `client.error`. The bus is
// idempotent; safe under React StrictMode double-invoke in development.
eventBus.start();
window.addEventListener('error', (e) => {
    emitClientError({ message: e.message, stack: e.error?.stack });
});
window.addEventListener('unhandledrejection', (e) => {
    emitClientError({ message: String(e.reason) });
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

// DEV-ONLY: Shram Sathi understanding-meter preview (founder-facing, local only).
// Mounted standalone (no login, no backend, no Dexie) when the URL path is
// /dev/shram-sathi in a development build. `import.meta.env.DEV` is statically
// false in production builds, so Vite tree-shakes this branch + the lazy import
// entirely out of the prod bundle. NEVER merged/deployed (branch
// feat/shram-sathi-local-preview). See src/features/logs/dev/ShramSathiPreviewPage.tsx.
// Dev-only preview routes (import.meta.env.DEV → tree-shaken out of prod builds;
// NEVER merged/deployed). The FINAL, locked Shram Sathi understanding design lives
// in production at features/logs/components/shramsathi/ShramSathiUnderstanding.tsx
// and is shown in the REAL voice flow via mainView (status === 'processing').
// Only two reference previews are kept after the design was locked:
if (import.meta.env.DEV && window.location.pathname.startsWith('/dev/board')) {
  // /dev/board — standalone preview of the locked understanding design (character
  // + green→blue waveform + chalkboard with random rotating quotes).
  import('./features/logs/dev/ShramSathiBoard').then(({ ShramSathiBoard }) => {
    root.render(<React.StrictMode><ShramSathiBoard /></React.StrictMode>);
  });
} else if (import.meta.env.DEV && window.location.pathname.startsWith('/dev/reveal')) {
  // /dev/reveal — preview of the after-parse "sorted log" reveal (scroll + slide-up
  // + green highlight) that ManualEntry now does when a voice draft lands.
  import('./features/logs/dev/AfterParseRevealDemo').then(({ AfterParseRevealDemo }) => {
    root.render(<React.StrictMode><AfterParseRevealDemo /></React.StrictMode>);
  });
} else if (import.meta.env.DEV && window.location.pathname.startsWith('/dev/meter')) {
  // /dev/meter — the "20 rich logs" Understanding Meter idea: as the farmer records
  // 20 logs the AI genuinely understood (score > 50), the meter fills and the Shram
  // Sathi character/face is revealed (arriving silhouette → arrived). Committed feature.
  // Wrapped in a fixed scroll container because global body/#root are overflow:hidden.
  import('./features/logs/dev/ShramSathiPreviewPage').then(({ ShramSathiPreviewPage }) => {
    root.render(
      <React.StrictMode>
        <div style={{ position: 'fixed', inset: 0, overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch', background: '#FCFCFC' }}>
          <ShramSathiPreviewPage />
        </div>
      </React.StrictMode>
    );
  });
} else {
  root.render(
    <React.StrictMode>
      <TenantProvider>
        <App />
      </TenantProvider>
    </React.StrictMode>
  );
}
