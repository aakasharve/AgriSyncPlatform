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

// Register Service Worker for Push Notifications
NotificationService.registerSW();
NotificationService.scheduleDisciplineNudges();

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
root.render(
  <React.StrictMode>
    <TenantProvider>
      <App />
    </TenantProvider>
  </React.StrictMode>
);
