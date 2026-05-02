import { expect, type Page } from '@playwright/test';

export async function selectFarmWideLogContext(page: Page): Promise<void> {
    const farmWideContext = page.getByRole('button', { name: /Entire Farm.*Overview/i }).first();

    await expect(farmWideContext).toBeVisible({ timeout: 15_000 });
    await farmWideContext.click();
    await expect(page.getByTestId('input-method-manual')).toBeVisible({ timeout: 10_000 });
}

/**
 * Sub-plan 05 root-cause fix:
 *
 * The "Entire Farm / Overview" context produces a log selection with
 * `selectedPlotIds: []`. logSyncMutationService.resolveSyncTarget reads the
 * first plotId off that array, finds nothing, and silently SKIPS the log from
 * the offline mutation queue. That's correct domain behaviour (you can't push
 * a daily log that isn't bound to a plot+cropCycle), but it makes any e2e
 * spec that wants to assert sync-queue or rejection-path behaviour impossible
 * to write against farm-wide context.
 *
 * This helper picks the first available crop card and (when its plot tray
 * appears) the first plot button, leaving the app in a context where:
 *   • selection.selectedPlotIds[0] is a real plot id from the seed data,
 *   • resolveSyncTarget() returns a {farmId, plotId, cropCycleId} target,
 *   • saving a daily log enqueues create_daily_log + add_log_task mutations.
 *
 * Specs 02 (offline log capture) and 03 (sync retry on rejection) both depend
 * on the queue actually receiving mutations, so they MUST use this helper
 * rather than selectFarmWideLogContext.
 */
export async function selectFirstPlotLogContext(page: Page): Promise<void> {
    const knownCropPattern = /grapes|pomegranate|sugarcane|onion|wheat|tomato|guava/i;
    const cropCard = page.getByRole('button', { name: knownCropPattern }).first();
    await expect(cropCard).toBeVisible({ timeout: 15_000 });
    await cropCard.click();

    // After clicking a crop, one of two things happens:
    //   (a) single-plot crop → plot tray is suppressed; ManualEntry mounts
    //       directly because the context is already complete.
    //   (b) multi-plot crop → "Select Plot" tray opens; user must pick one.
    // The tray button is rendered inside a section labelled "Select Plot"
    // and contains the plot name from the seed.
    const inputMethodToggle = page.getByTestId('input-method-manual');
    const selectPlotHeading = page.getByText(/Select Plot/i).first();

    const plotHeadingVisible = await selectPlotHeading.isVisible({ timeout: 3_000 }).catch(() => false);
    if (plotHeadingVisible) {
        // CropSelector renders each plot button with data-testid="plot-tray-button".
        // Pick the first one — order matches the seed-data plot order.
        const plotButton = page.getByTestId('plot-tray-button').first();
        await plotButton.waitFor({ state: 'visible', timeout: 5_000 });
        await plotButton.click();
    }

    await expect(inputMethodToggle).toBeVisible({ timeout: 15_000 });
}
