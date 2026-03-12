import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
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
