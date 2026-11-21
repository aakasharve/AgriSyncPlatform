/**
 * F24 (read-only security audit) - the production phone build must not keep console output.
 *
 * `vite.config.ts` had no stripping, so every console.log / info / warn / error shipped in the Android bundle. The fix is
 * `esbuild.drop: ['console', 'debugger']`, and it must apply to the REAL production build ONLY:
 *   - `vite build` and `vite build --mode production` (what the release workflow runs, `npm run build`) strip;
 *   - `vite build --mode fieldtest` (the founder's TEST copy on the PC test stack) keeps its console - it is how that stack is read;
 *   - `vite` (dev) and vitest never strip.
 * `scripts/check-bundle-console.mjs` proves the same thing on a built folder; this pins the config that decides it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import viteConfig from '../../vite.config';

type Env = { command: 'build' | 'serve'; mode: string };
type Resolved = { esbuild?: { drop?: string[] } };

const resolve = (env: Env): Resolved => (viteConfig as unknown as (e: Env) => Resolved)(env);

beforeEach(() => { vi.stubEnv('VITE_AGRISYNC_API_URL', 'https://api.example.test'); }); // a production build refuses to start without it
afterEach(() => { vi.unstubAllEnvs(); });

describe('vite.config esbuild.drop (F24)', () => {
    it('the production build drops console calls and debugger statements', () => {
        const drop = resolve({ command: 'build', mode: 'production' }).esbuild?.drop;
        expect(drop).toEqual(expect.arrayContaining(['console', 'debugger']));
    });

    it('the fieldtest build (the test stack) keeps its console', () => {
        expect(resolve({ command: 'build', mode: 'fieldtest' }).esbuild?.drop).toBeUndefined();
    });

    it('any other build mode keeps its console too: only the real production build strips', () => {
        expect(resolve({ command: 'build', mode: 'staging' }).esbuild?.drop).toBeUndefined();
        expect(resolve({ command: 'build', mode: 'development' }).esbuild?.drop).toBeUndefined();
    });

    it('dev server and vitest never strip, even in a mode called production', () => {
        expect(resolve({ command: 'serve', mode: 'development' }).esbuild?.drop).toBeUndefined();
        expect(resolve({ command: 'serve', mode: 'test' }).esbuild?.drop).toBeUndefined();
        expect(resolve({ command: 'serve', mode: 'production' }).esbuild?.drop).toBeUndefined();
    });

    it('also strips the copied service worker (public/sw.js is never transformed by Vite) - in the production build only', () => {
        const names = (env: Env) => ((resolve(env) as { plugins?: Array<{ name?: string } | false | null | undefined> }).plugins ?? [])
            .flat().map(p => (p ? p.name : undefined));
        expect(names({ command: 'build', mode: 'production' })).toContain('agrisync-drop-console-in-sw');
        expect(names({ command: 'build', mode: 'fieldtest' })).not.toContain('agrisync-drop-console-in-sw');
        expect(names({ command: 'serve', mode: 'development' })).not.toContain('agrisync-drop-console-in-sw');
    });

    it('does not disturb the rest of the config (aliases and chunking stay)', () => {
        const cfg = resolve({ command: 'build', mode: 'production' }) as Resolved & { resolve?: { alias?: Record<string, string> }; build?: unknown };
        expect(cfg.resolve?.alias?.['@']).toBeTruthy();
        expect(cfg.build).toBeTruthy();
    });
});
