// @vitest-environment node
/**
 * Release 1.0.13 finding F1 (spec: 2026-08-25-prod-cutover-waves): on Android 14 and older the
 * header sat under the status bar because the page reported env(safe-area-inset-top) = 0.
 *
 * HONESTY NOTE: this is a SOURCE-CONTRACT test. It reads MainActivity.java and pins the decisions
 * that keep the fix correct; it does not run Android. It cannot prove the touch lands on the
 * button. Real proof is the Android emulator run (API 34 AND API 35/36, check C15: Setup Hub
 * button centre must be below the status bar and a REAL touch must open the menu).
 *
 * Pinned:
 *  - the native publisher runs only below API 35 (Capacitor SystemBars already does it on 35+,
 *    so running it there would double the padding);
 *  - it publishes the exact variables the web layer reads (--safe-area-inset-*), which the
 *    web CSS prefers over env();
 *  - the web layer still prefers the injected variable over env().
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const activity = readFileSync(
    join(ROOT, 'android/app/src/main/java/com/agrisync/shramsafal/MainActivity.java'), 'utf8');
const css = readFileSync(join(ROOT, 'src/index.css'), 'utf8');

describe('Android safe-area insets below API 35 (source contract; real proof = emulator C15)', () => {
    it('only installs the native publisher below the API where Capacitor takes over', () => {
        expect(activity).toMatch(/FIRST_API_WITH_CAPACITOR_INSETS\s*=\s*35\s*;/);
        expect(activity).toMatch(
            /if\s*\(\s*Build\.VERSION\.SDK_INT\s*<\s*FIRST_API_WITH_CAPACITOR_INSETS\s*\)\s*\{\s*installLegacySafeAreaInsets/);
    });

    it('publishes all four variables the web layer consumes', () => {
        for (const side of ['top', 'right', 'bottom', 'left']) {
            expect(activity).toContain(`--safe-area-inset-${side}`);
        }
    });

    it('re-publishes on page load (the variables live on <html> and die with the document)', () => {
        expect(activity).toMatch(/onPageCommitVisible/);
    });

    it('the web utility classes prefer the injected variable over env()', () => {
        expect(css).toMatch(/\.pt-safe-area\s*\{\s*padding-top:\s*var\(--safe-area-inset-top,\s*env\(safe-area-inset-top/);
    });
});
