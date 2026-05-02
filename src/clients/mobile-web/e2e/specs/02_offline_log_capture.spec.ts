/**
 * Spec 02 — Offline log capture + sync on reconnect
 *
 * Verifies that:
 *  1. A user can create a daily log while offline (optimistic save → success view).
 *  2. The sync queue accumulates the pending mutation while offline.
 *  3. Triggering sync after going back online drains the queue to 0.
 *
 * Flow overview:
 *  login → pick first crop+plot context (NOT Entire Farm — see helper docstring)
 *   → go offline → FAB → manual mode → fill activity chip → save
 *   → assert "Saved to Ledger" success view
 *   → open sync drawer → assert pending count > 0
 *   → go online → click Sync Now → assert pending count = 0
 *
 * Why a real plot context (not Entire Farm)?
 *  enqueueLogsForSync needs `selection.selectedPlotIds[0]` to resolve a sync
 *  target. FARM_GLOBAL produces an empty plotId array, so the log gets saved
 *  locally but never queued for /sync/push — meaning sync-pending-count would
 *  stay at 0 and the test could never observe the offline → drain transition.
 */
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../fixtures/seed.api';
import { goOffline, goOnline } from '../fixtures/offlineHelper';
import { loginViaPassword } from '../fixtures/loginHelper';
import { selectFirstPlotLogContext } from '../fixtures/logContextHelper';

test.describe('Offline log capture', () => {
    test('user can log a daily activity while offline; it queues and syncs on reconnect', async ({ page }) => {
        await resetAndSeed('ramu');

        // --- Login + pick a real plot so sync mutations actually queue ---
        await loginViaPassword(page, '9999999999', 'ramu123');
        await selectFirstPlotLogContext(page);

        // --- Go offline ---
        await goOffline(page);

        // --- Open quick-log sheet via FAB ---
        const fab = page.getByTestId('add-log-fab');
        await expect(fab).toBeVisible({ timeout: 10_000 });
        await fab.click();

        // --- Select the quick chip. The chip closes the sheet and lands on
        // ManualEntry with the selected segment active.
        await page.getByTestId('quick-log-chip-irrigation').click();

        // --- Interact with ManualEntry form ---
        // The ManualEntry uses chip-based activity selection (no <select>).
        // Click the first available activity chip / common-activity button.
        const activityChip = page.locator('button').filter({ hasText: /pruning|weeding|spraying|irrigation|labour|harvest/i }).first();
        if (await activityChip.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await activityChip.click();
        }

        // --- Save the log ---
        const saveBtn = page.getByTestId('manual-save-button');
        await expect(saveBtn).toBeVisible({ timeout: 10_000 });
        await saveBtn.click();

        // --- Assert optimistic save: status='success' renders the "Saved to
        // Ledger" view. The DailyLogCard timeline (data-testid="log-list-item")
        // is hidden while in this terminal state, so we anchor on the success
        // view's testid instead.
        const savedView = page.getByTestId('saved-to-ledger');
        await expect(savedView).toBeVisible({ timeout: 15_000 });

        // --- Open sync status drawer (header indicator stays mounted) ---
        const syncIndicator = page.getByTestId('sync-status-indicator');
        await expect(syncIndicator).toBeVisible({ timeout: 10_000 });
        await syncIndicator.click();

        // --- Assert pending count > 0 while offline ---
        const pendingCount = page.getByTestId('sync-pending-count');
        await expect(pendingCount).toBeVisible({ timeout: 10_000 });
        // The count text should contain a number ≥ 1
        await expect(pendingCount).not.toHaveText('0', { timeout: 5_000 });

        // --- Go online and sync ---
        await goOnline(page);

        const syncNowBtn = page.getByTestId('sync-trigger-now');
        await expect(syncNowBtn).toBeEnabled({ timeout: 15_000 });
        await syncNowBtn.click();

        // --- Assert pending count drains to 0 ---
        await expect(pendingCount).toHaveText('0', { timeout: 30_000 });
    });
});
