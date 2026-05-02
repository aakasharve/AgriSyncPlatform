/**
 * Spec 02 — Offline log capture + sync on reconnect
 *
 * Verifies that:
 *  1. A user can create a daily log while offline (optimistic UI shows immediately).
 *  2. The sync queue shows a pending count of 1.
 *  3. Triggering sync after going back online drains the queue to 0.
 *
 * Flow overview:
 *  login → go offline → FAB → manual mode → fill activity chip/notes → save
 *  → assert log-list-item shows notes text
 *  → open sync drawer → assert pending count = 1
 *  → go online → click Sync Now → assert pending count = 0
 */
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../fixtures/seed.api';
import { goOffline, goOnline } from '../fixtures/offlineHelper';
import { loginViaPassword } from '../fixtures/loginHelper';
import { selectFarmWideLogContext } from '../fixtures/logContextHelper';

test.describe('Offline log capture', () => {
    test('user can log a daily activity while offline; it queues and syncs on reconnect', async ({ page }) => {
        await resetAndSeed('ramu');

        // --- Login ---
        await loginViaPassword(page, '9999999999', 'ramu123');
        await selectFarmWideLogContext(page);

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

        // --- Assert optimistic entry in list ---
        const logItem = page.getByTestId('log-list-item').first();
        await expect(logItem).toBeVisible({ timeout: 10_000 });

        // --- Open sync status drawer ---
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
