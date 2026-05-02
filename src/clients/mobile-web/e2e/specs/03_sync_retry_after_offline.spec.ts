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
import { selectFarmWideLogContext } from '../fixtures/logContextHelper';

test.describe('Sync retry after rejected mutation', () => {
    test('rejected mutation surfaces in OfflineConflictPage and can be retried after fix', async ({ page }) => {
        await resetAndSeed('ramu');

        // Arm the push-rejection toggle BEFORE logging in
        await setFailPushes('CLIENT_TOO_OLD');

        // --- Login ---
        await loginViaPassword(page, '9999999999', 'ramu123');
        await selectFarmWideLogContext(page);

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

        // --- Click the retry button for the first (and only) conflict row ---
        // OfflineConflictPage renders per-row buttons as data-testid="retry-<mutationId>"
        // Use a role + name match as fallback when we don't know the mutationId upfront.
        const retryBtn = page.getByRole('button', { name: /पुन्हा/i }).first();
        await expect(retryBtn).toBeVisible({ timeout: 10_000 });
        await retryBtn.click();

        // --- Assert conflict-empty is shown (all conflicts resolved) ---
        const conflictEmpty = page.getByTestId('conflict-empty');
        await expect(conflictEmpty).toBeVisible({ timeout: 30_000 });
    });
});
