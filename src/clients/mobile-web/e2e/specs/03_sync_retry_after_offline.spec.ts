/**
 * Spec 03 — Sync retry after rejected mutation
 *
 * Verifies that:
 *  1. A CLIENT_TOO_OLD rejection surfaces as a conflict-badge in the app shell.
 *  2. Clicking the badge navigates to OfflineConflictPage (state-machine routing —
 *     NOT via URL, so we click the badge rather than page.goto('/offline-conflicts')).
 *  3. After clearing the failure toggle the retry button resolves the conflict and
 *     the conflict-empty state is shown.
 *
 * The __e2e/fail-pushes toggle is armed before sync so that the push endpoint
 * rejects all incoming mutations with CLIENT_TOO_OLD. After the rejection is
 * surfaced in the UI, we clear the toggle so the retry can succeed.
 */
import { test, expect } from '@playwright/test';
import { resetAndSeed, setFailPushes } from '../fixtures/seed.api';
import { loginViaPassword } from '../fixtures/loginHelper';
import { selectFirstPlotLogContext } from '../fixtures/logContextHelper';

test.describe('Sync retry after rejected mutation', () => {
    test('rejected mutation surfaces in OfflineConflictPage and can be retried after fix', async ({ page }) => {
        await resetAndSeed('ramu');

        // Arm the push-rejection toggle BEFORE logging in
        await setFailPushes('CLIENT_TOO_OLD');

        // --- Login + pick a real plot context ---
        // Entire-Farm context produces selectedPlotIds=[], which causes
        // enqueueLogsForSync to skip the log entirely. With nothing in the
        // queue there is no /sync/push call, no rejection, and the
        // conflict-badge never renders. See logContextHelper docstring.
        await loginViaPassword(page, '9999999999', 'ramu123');
        await selectFirstPlotLogContext(page);

        // --- Capture a log (online, but pushes will be rejected by server) ---
        // Switch to manual mode to create a log quickly without voice
        const manualToggle = page.getByTestId('input-method-manual');
        await expect(manualToggle).toBeVisible({ timeout: 10_000 });
        await manualToggle.click();

        // Click any visible activity chip / common-activity button
        const activityChip = page.locator('button').filter({ hasText: /pruning|weeding|spraying|irrigation|labour|harvest/i }).first();
        if (await activityChip.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await activityChip.click();
        }

        const saveBtn = page.getByTestId('manual-save-button');
        await expect(saveBtn).toBeVisible({ timeout: 10_000 });
        await saveBtn.click();

        // --- Open sync drawer and trigger sync ---
        const syncIndicator = page.getByTestId('sync-status-indicator');
        await expect(syncIndicator).toBeVisible({ timeout: 10_000 });
        await syncIndicator.click();

        const syncNowBtn = page.getByTestId('sync-trigger-now');
        await expect(syncNowBtn).toBeEnabled({ timeout: 10_000 });
        await syncNowBtn.click();

        // Close drawer so we can see the badge
        await page.keyboard.press('Escape');

        // --- Assert conflict-badge becomes visible (rejection surfaced) ---
        const conflictBadge = page.getByTestId('conflict-badge');
        await expect(conflictBadge).toBeVisible({ timeout: 30_000 });

        // --- Navigate to OfflineConflictPage via clicking the badge (NOT page.goto) ---
        await conflictBadge.click();

        // --- Assert conflict list is shown ---
        const conflictList = page.getByTestId('conflict-list');
        await expect(conflictList).toBeVisible({ timeout: 10_000 });

        // --- Clear the fail-pushes toggle so retry can succeed ---
        await setFailPushes(null);

        // --- Click retry on every conflict row, in order ---
        //
        // OfflineConflictPage's handleRetry only flips ONE mutation
        // (REJECTED_USER_REVIEW → PENDING) per click; siblings stay rejected
        // until the user retries them too. A single-save flow can produce
        // multiple mutations (1 create_daily_log + N add_log_task — the
        // exact number depends on what ActivityLedger / LogFactory derive
        // from the manual entry), so we keep clicking the first retry
        // button until none are left, then assert the empty state.
        //
        // The optimistic UI removal in handleRetry (`setItems(prev =>
        // prev.filter(...))` ) means the loop terminates quickly in the
        // happy path. If retry() throws (e.g. the toggle was still armed),
        // the row stays and we'd loop forever — guard with a hard cap.
        const retryButtons = page.getByRole('button', { name: /पुन्हा/i });
        await expect(retryButtons.first()).toBeVisible({ timeout: 10_000 });

        const MAX_RETRY_CLICKS = 10;
        for (let i = 0; i < MAX_RETRY_CLICKS; i++) {
            const stillVisible = await retryButtons
                .first()
                .isVisible({ timeout: 1_000 })
                .catch(() => false);
            if (!stillVisible) break;
            await retryButtons.first().click();
            // Yield to React for the optimistic state update + sync trigger.
            await page.waitForTimeout(250);
        }

        // --- Assert conflict-empty is shown (all conflicts resolved) ---
        const conflictEmpty = page.getByTestId('conflict-empty');
        await expect(conflictEmpty).toBeVisible({ timeout: 30_000 });
    });
});
