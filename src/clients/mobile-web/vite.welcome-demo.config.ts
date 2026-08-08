import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Standalone preview for the redesigned first-run WelcomeScreen.
// Renders the REAL component with the FarmContext aliased to a demo stub so it
// shows a personalised name without a backend. Run:
//   npx vite --config vite.welcome-demo.config.ts
export default defineConfig({
    root: __dirname,
    plugins: [react()],
    resolve: {
        alias: [
            {
                find: /.*core\/session\/FarmContext$/,
                replacement: path.resolve(__dirname, 'welcome-demo-farmctx-stub.tsx'),
            },
        ],
    },
    server: { port: 3010, strictPort: true, open: false },
});
