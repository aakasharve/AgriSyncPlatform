import fs from 'fs';
import path from 'path';
import { defineConfig, transformWithEsbuild, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// F24 - `public/sw.js` is copied into the build as it is: Vite never transforms it, so `esbuild.drop` cannot reach it. In the
// production build ONLY, run the copied file through the same drop. (The source file keeps its lifecycle logs for dev and fieldtest.)
function dropConsoleInServiceWorker(): Plugin {
  let outDir = '';
  return {
    name: 'agrisync-drop-console-in-sw',
    apply: 'build',
    configResolved(resolved) {
      outDir = path.resolve(resolved.root, resolved.build.outDir);
    },
    async closeBundle() {
      const file = path.join(outDir, 'sw.js');
      if (!fs.existsSync(file)) return;
      const out = await transformWithEsbuild(fs.readFileSync(file, 'utf8'), file, { loader: 'js', drop: ['console', 'debugger'] });
      fs.writeFileSync(file, out.code);
    },
  };
}

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

// spec: dfes-companion-2026-07-11 (wave-0.3) — this is assertNoForbiddenEnv's
// *require*-twin. Nine call sites (otpClient.ts, complianceClient.ts,
// dfesQuestionApi.ts, inviteApi.ts, serviceProofClient.ts, testsClient.ts,
// jobCardsClient.ts, BackendFarmGeographyClient.ts, BackendWeatherClient.ts)
// silently fall back to http://localhost:5048 when VITE_AGRISYNC_API_URL is
// absent. A production build shipped without it looks completely dead in
// the field, with nothing pointing at the cause. This guard fails PRODUCTION
// builds only — dev and test must keep working without the variable set, or
// this becomes a blocker for every local workflow instead of a safety net.
function assertRequiredEnv(): void {
  const required = ['VITE_AGRISYNC_API_URL'] as const;
  const missing = required.filter((name) => {
    const value = process.env[name];
    return typeof value !== 'string' || value.length === 0;
  });
  if (missing.length > 0) {
    throw new Error(
      `[vite] AgriSync deploy-safety guard rejected build: ` +
        `required env var(s) ${missing.join(', ')} must be set for a ` +
        `production build. Without it, nine call sites silently fall back ` +
        `to http://localhost:5048 and the shipped app looks dead.`,
    );
  }
}

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    assertRequiredEnv();
  }

  // F24 (read-only security audit): the production phone build shipped every console.log / info / warn / error. Strip
  // them, and `debugger`, from the REAL production build ONLY (`vite build`, `--mode production`: what the release workflow
  // runs). The fieldtest build (the founder's TEST copy on the PC test stack, `--mode fieldtest`) keeps its console - it is
  // how that stack is read - and so do dev and vitest. `scripts/check-bundle-console.mjs` proves it on a built folder.
  const dropConsole = command === 'build' && mode === 'production';

  return {
    ...(dropConsole ? { esbuild: { drop: ['console', 'debugger'] as ('console' | 'debugger')[] } } : {}),
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [react(), ...(dropConsole ? [dropConsoleInServiceWorker()] : [])],
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
      },
    },
  };
});
