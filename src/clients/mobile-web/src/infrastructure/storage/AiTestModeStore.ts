/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AiTestModeStore — purpose-named storage adapter for the AI test-mode
 * session flags (toggled via `?aiTest=1`/`?aiTest=0` and read by the
 * AiTestModeBanner shell). Lives under `infrastructure/storage/` to
 * satisfy the Sub-plan 04 Task 3 localStorage discipline gate
 * (scripts/check-storage-discipline.mjs).
 *
 * Three keys, all session-scoped, never sent over the wire:
 * - `agrisync_ai_test_mode` — "true" when the banner should show.
 * - `agrisync_ai_test_bucket` — the visible bucket id under test.
 * - `agrisync_ai_test_capture_count` — count of captures so far this run.
 *
 * The store is intentionally synchronous + browser-only so the banner can
 * read state during render without a hook.
 */

const FLAG_KEY = 'agrisync_ai_test_mode';
const BUCKET_KEY = 'agrisync_ai_test_bucket';
const COUNT_KEY = 'agrisync_ai_test_capture_count';

function hasWindow(): boolean {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function isAiTestModeEnabled(): boolean {
    if (!hasWindow()) return false;
    return window.localStorage.getItem(FLAG_KEY) === 'true';
}

export function setAiTestModeEnabled(enabled: boolean): void {
    if (!hasWindow()) return;
    if (enabled) {
        window.localStorage.setItem(FLAG_KEY, 'true');
    } else {
        window.localStorage.removeItem(FLAG_KEY);
    }
}

export function getAiTestBucket(): string | null {
    if (!hasWindow()) return null;
    return window.localStorage.getItem(BUCKET_KEY);
}

export function getAiTestCaptureCount(): string | null {
    if (!hasWindow()) return null;
    return window.localStorage.getItem(COUNT_KEY);
}

/**
 * Clear every AI test-mode key. Called when `?aiTest=0` is on the URL.
 */
export function clearAiTestMode(): void {
    if (!hasWindow()) return;
    window.localStorage.removeItem(FLAG_KEY);
    window.localStorage.removeItem(BUCKET_KEY);
    window.localStorage.removeItem(COUNT_KEY);
}

/**
 * Snapshot read for the banner. Returns null when the flag is off so the
 * banner can render nothing.
 */
export function readAiTestModeSnapshot(): { bucket: string; count: string } | null {
    if (!isAiTestModeEnabled()) return null;
    return {
        bucket: getAiTestBucket() ?? '—',
        count: getAiTestCaptureCount() ?? '0',
    };
}
