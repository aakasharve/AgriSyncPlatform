#!/usr/bin/env node
/**
 * Sub-plan 04 Task 3 — localStorage architecture gate.
 *
 * Enforces: window.localStorage and bare localStorage `getItem|setItem|
 * removeItem|clear` reads/writes only inside infrastructure/storage/. All
 * other code must go through repositories, the useUiPref hook, or a
 * purpose-named module under infrastructure/storage/ (e.g., AuthTokenStore,
 * DemoModeStore, SessionStore).
 *
 * Strict mode (default in this script): any violation fails CI with a
 * pinpointed file path + line. An allow-list lives below for sites that
 * are scheduled for migration in named follow-up pending tasks; the list
 * MUST shrink over time and is reviewed in PR.
 *
 * Run:
 *   node scripts/check-storage-discipline.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../src', import.meta.url));
const ALLOWED_PREFIX = 'infrastructure' + sep + 'storage';
const PATTERNS = [
    /\blocalStorage\.(getItem|setItem|removeItem|clear)\b/,
    /\bwindow\.localStorage\.(getItem|setItem|removeItem|clear)\b/,
];
const SKIP_DIRS = new Set([
    'node_modules', 'dist', '__tests__', '__mocks__', '__snapshots__', 'test',
]);

/**
 * Files explicitly waived from the gate while their migration ships in
 * named follow-up tasks. Each entry MUST cite the pending-task code so the
 * list can be audited and shrunk. Adding a new entry without a matching
 * pending task is a review-blocking violation.
 */
const ALLOWLIST = new Map([
    // T-IGH-04-LOCALSTORAGE-MIGRATION (P1) — bulk of pre-existing violators
    // are scheduled for migration in a follow-up that decomposes by area:
    //   pages/   -> useUiPref hook
    //   services/-> legacy services slated for deletion (Task 10 restricts
    //               imports; deletion is a separate follow-up)
    //   i18n/    -> useUiPref hook
    //   features/-> per-feature Dexie repos or storage adapters
    //   core/    -> SessionStore + AppRouter routing-state migration
    //   sync/    -> co-located with Task 7 SyncPullReconciler split
    ['app' + sep + 'providers' + sep + 'DataSourceProvider.tsx', 'T-IGH-04-LOCALSTORAGE-MIGRATION'],
    ['AppContent.tsx', 'T-IGH-04-LOCALSTORAGE-MIGRATION'],
    ['core' + sep + 'data' + sep + 'LocalDB.ts', 'T-IGH-04-LOCALSTORAGE-MIGRATION'],
    ['core' + sep + 'navigation' + sep + 'AppRouter.tsx', 'T-IGH-04-LOCALSTORAGE-MIGRATION'],
    ['core' + sep + 'session' + sep + 'FarmContext.tsx', 'T-IGH-04-LOCALSTORAGE-MIGRATION'],
    ['features' + sep + 'finance' + sep + 'financeService.ts', 'T-IGH-04-LOCALSTORAGE-MIGRATION'],
    ['features' + sep + 'onboarding' + sep + 'qr' + sep + 'farmInviteStore.ts', 'T-IGH-04-LOCALSTORAGE-MIGRATION'],
    ['features' + sep + 'voice' + sep + 'vocab' + sep + 'vocabStore.ts', 'T-IGH-04-LOCALSTORAGE-MIGRATION'],
    ['infrastructure' + sep + 'api' + sep + 'AuthTokenStore.ts', 'T-IGH-04-LOCALSTORAGE-MIGRATION'],
    ['infrastructure' + sep + 'sync' + sep + 'MutationQueue.ts', 'T-IGH-04-LOCALSTORAGE-MIGRATION'],
    ['infrastructure' + sep + 'sync' + sep + 'SyncPullReconciler.ts', 'T-IGH-04-LOCALSTORAGE-MIGRATION'],
    ['services' + sep + 'harvestService.ts', 'T-IGH-04-LOCALSTORAGE-MIGRATION'],
    ['services' + sep + 'procurementRepository.ts', 'T-IGH-04-LOCALSTORAGE-MIGRATION'],
    // T-IGH-04-LOCALSTORAGE-MIGRATION wave-4-A — module-level singleton
    // (object literal, not a React component) so it cannot consume the
    // useUiPref hook directly. The discipline-nudge sent flags read from
    // an event handler scheduled via setTimeout; migrating would require
    // a non-React storage adapter under infrastructure/storage/. Tracked
    // as a follow-up; intentionally kept allow-listed for this wave.
    ['shared' + sep + 'services' + sep + 'NotificationService.ts', 'T-IGH-04-LOCALSTORAGE-MIGRATION'],
]);

let violations = 0;
let allowed = 0;
const newViolations = [];

async function walk(dir, rel = '') {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
        const full = join(dir, e.name);
        const r = rel ? rel + sep + e.name : e.name;
        if (e.isDirectory()) {
            if (SKIP_DIRS.has(e.name)) continue;
            await walk(full, r);
        } else if (['.ts', '.tsx', '.mjs', '.js'].includes(extname(e.name))) {
            const src = await readFile(full, 'utf8');
            const hits = PATTERNS.some(p => p.test(src));
            if (!hits) continue;
            const insideAllowedDir = r.startsWith(ALLOWED_PREFIX);
            if (insideAllowedDir) continue;
            if (ALLOWLIST.has(r)) {
                allowed += 1;
                continue;
            }
            newViolations.push(r);
            violations += 1;
        }
    }
}

await walk(ROOT);

if (newViolations.length > 0) {
    for (const file of newViolations) {
        console.error(`::error file=src/${file.replaceAll(sep, '/')}::localStorage usage outside infrastructure/storage/ — route through useUiPref, a Dexie repository, or a purpose-named storage adapter.`);
    }
    console.error(`\nFAIL — ${newViolations.length} new localStorage violation(s) outside the allow-list.`);
    console.error(`Allow-listed (pre-existing, T-IGH-04-LOCALSTORAGE-MIGRATION): ${allowed}`);
    process.exit(1);
}

console.log(`OK — localStorage discipline upheld.`);
console.log(`  Allow-listed (scheduled for migration): ${allowed}`);
