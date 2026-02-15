/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { TenantProvider } from './core/tenant/TenantContext'; // Correct path
import { NotificationService } from './shared/services/NotificationService';

// Register Service Worker for Push Notifications
NotificationService.registerSW();
NotificationService.scheduleDisciplineNudges();

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
