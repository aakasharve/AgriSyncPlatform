import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// DATA_PRINCIPLE_SPINE Phase 01 sub-phase 01.W0 (Y.md §7): the browser
// bundle must not carry any direct AI-provider API key. This guard fails
// the build immediately if a forbidden client-visible env var is defined.
// Server-side calls (BackendAiClient -> /api/ai/*) are the only sanctioned
// path; provider keys live in AWS Secrets Manager + are injected into the
// backend host only.
function assertNoForbiddenEnv(): void {
  const forbidden = [
    'VITE_GEMINI_API_KEY',
    'VITE_GOOGLE_API_KEY',
    'VITE_SARVAM_API_KEY',
    'VITE_OPENAI_API_KEY',
  ] as const;
  const leaked = forbidden.filter((name) => {
    const value = process.env[name];
    return typeof value === 'string' && value.length > 0;
  });
  if (leaked.length > 0) {
    throw new Error(
      `[vite] AgriSync privacy-edge guard rejected build: ` +
        `client-visible env var(s) ${leaked.join(', ')} must not be set. ` +
        `Route AI calls through BackendAiClient. See Y.md §7.`,
    );
  }
}

assertNoForbiddenEnv();

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
    // Preview-only: allow Cloudflare quick-tunnel hosts so the founder can view
    // the dev preview on a phone over the internet. Safe for a dev-only preview.
    allowedHosts: ['.trycloudflare.com'],
    // Preview-only: proxy the ShramSafal backend prefixes to the local API on :5000
    // so the browser calls SAME-ORIGIN paths (no CORS) and it works over the tunnel
    // too (no separate backend tunnel needed). Requires VITE_AGRISYNC_API_URL='' so
    // the app emits relative URLs. Covers login (/user), voice + everything
    // (/shramsafal incl. /ai/*-stream SSE), and offline sync (/sync).
    proxy: {
      '/user': { target: 'http://localhost:5000', changeOrigin: true },
      '/shramsafal': { target: 'http://localhost:5000', changeOrigin: true },
      '/sync': { target: 'http://localhost:5000', changeOrigin: true },
      '/version': { target: 'http://localhost:5000', changeOrigin: true },
      '/health': { target: 'http://localhost:5000', changeOrigin: true },
    },
  },
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');
          if (!normalizedId.includes('/node_modules/')) {
            return;
          }

          if (
            normalizedId.includes('/react/') ||
            normalizedId.includes('/react-dom/') ||
            normalizedId.includes('/react-router-dom/') ||
            normalizedId.includes('/react-router/') ||
            normalizedId.includes('/@remix-run/') ||
            normalizedId.includes('/scheduler/')
          ) {
            return 'framework-vendor';
          }

          if (normalizedId.includes('/@react-google-maps/')) {
            return 'maps-vendor';
          }

          if (normalizedId.includes('/@capacitor/')) {
            return 'capacitor-vendor';
          }

          if (normalizedId.includes('/dexie/')) {
            return 'storage-vendor';
          }

          if (normalizedId.includes('/axios/')) {
            return 'network-vendor';
          }

          if (normalizedId.includes('/lucide-react/')) {
            return 'ui-vendor';
          }

          if (normalizedId.includes('/zod/') || normalizedId.includes('/uuid/')) {
            return 'utility-vendor';
          }

          return;
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    }
  }
});
