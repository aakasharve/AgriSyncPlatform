/**
 * Spec 02 — Offline log capture + sync on reconnect
 *
 * Verifies that:
 *  1. A user can create a daily log while offline (optimistic save → success view).
 *  2. The sync queue accumulates the pending mutation while offline.
 *  3. Going back online drains the queue to 0 (server-acknowledged, APPLIED).
 *
 * Flow overview:
 *  login → pick first crop+plot context (NOT Entire Farm — see helper docstring)
 *   → go offline → FAB → manual mode → fill activity chip → save
 *   → assert "Saved to Ledger" success view
 *   → read the mutation queue → assert unacknowledged > 0
 *   → go online → queue drains: unacknowledged = 0 and a row is APPLIED
 *
 * Why a real plot context (not Entire Farm)?
 *  enqueueLogsForSync needs `selection.selectedPlotIds[0]` to resolve a sync
 *  target. FARM_GLOBAL produces an empty plotId array, so the log gets saved
 *  locally but never queued for /sync/push — meaning sync-pending-count would
 *  stay at 0 and the test could never observe the offline → drain transition.
 */
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../fixtures/seed.api';
import { goOffline, goOnline, readMutationQueue } from '../fixtures/offlineHelper';
import { loginViaPassword } from '../fixtures/loginHelper';
import { selectFirstPlotLogContext } from '../fixtures/logContextHelper';

test.describe('Offline log capture', () => {
    test('user can log a daily activity while offline; it queues and syncs on reconnect', async ({ page }) => {
        await resetAndSeed('purvesh-demo');

        // --- Login + pick a real plot so sync mutations actually queue ---
        await loginViaPassword(page, '8888888888', 'Testuser@123');
        await selectFirstPlotLogContext(page);

        // --- Go offline ---
        await goOffline(page);

        // --- Open quick-log sheet via FAB ---
        const fab = page.getByTestId('add-log-fab');
        await expect(fab).toBeVisible({ timeout: 10_000 });
        await fab.click();

        // --- Select the irrigation quick chip. The chip closes the sheet and
        // lands on ManualEntry with the irrigation segment seeded into the
        // active log. We deliberately do NOT click an additional activity
        // chip from the body of ManualEntry afterwards — the sheet's close
        // animation lasts ~200ms, and a broad "any button matching
        // pruning|weeding|...|harvest" locator would pin to the still-mounted
        // QuickLogSheet harvest chip during that window, racing the close.
        // The irrigation seeding from the quick-log chip alone is enough to
        // produce a saveable log.
        await page.getByTestId('quick-log-chip-irrigation').click();

        // --- Save the log ---
        // Wait for the QuickLogSheet to fully unmount (no more chip-irrigation
        // testid in the DOM) before clicking save, so we know we're in the
        // ManualEntry context.
        await expect(page.getByTestId('quick-log-chip-irrigation')).toHaveCount(0, { timeout: 5_000 });
        const saveBtn = page.getByTestId('manual-save-button');
        await expect(saveBtn).toBeVisible({ timeout: 10_000 });
        await saveBtn.click();

        // --- Assert optimistic save: status='success' renders the "Saved to
        // Ledger" view. The DailyLogCard timeline (data-testid="log-list-item")
        // is hidden while in this terminal state, so we anchor on the success
        // view's testid instead.
        const savedView = page.getByTestId('saved-to-ledger');
        await expect(savedView).toBeVisible({ timeout: 15_000 });

        // --- Assert the mutation is queued (unacknowledged) while offline ---
        // The header sync indicator / drawer opener no longer exists (oversight
        // rework, spec 4.1), so the queue is read from IndexedDB - the same rows the
        // drawer used to count. Intent unchanged: pending > 0 while offline ...
        await expect.poll(async () => (await readMutationQueue(page)).unacknowledged, { timeout: 15_000 })
            .toBeGreaterThan(0);

        // --- Go online: the worker's `online` handler drains the queue ---
        await goOnline(page);

        // ... and it drains to 0 once the server has acknowledged it.
        await expect.poll(async () => (await readMutationQueue(page)).unacknowledged, { timeout: 60_000 })
            .toBe(0);
        expect((await readMutationQueue(page)).byStatus['APPLIED'] ?? 0).toBeGreaterThan(0);
    });
});
