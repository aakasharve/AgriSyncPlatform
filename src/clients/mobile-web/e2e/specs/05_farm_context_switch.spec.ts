/**
 * Spec 05 — Farm context switch
 *
 * Verifies that a user with memberships in two farms can:
 *  1. See the FarmContextSwitcher pill in the app header after login.
 *  2. Open the switcher sheet and see both farms listed.
 *  3. Confirm Farm Alpha is the initially active farm (emerald border / CheckCircle).
 *  4. Switch to Farm Beta and see the pill update to reflect the new active farm.
 *
 * Fixture: admin_two_orgs
 *   - Phone 8888888888 / password admin123
 *   - Two farms: "E2E Farm Alpha" (FarmAId) and "E2E Farm Beta" (FarmBId)
 *   - Both farms have the admin user as OwnerUserId, so getMyFarms returns 2 entries.
 *
 * Selectors rationale:
 *   FarmContextSwitcher renders the pill with
 *     aria-label={`Current farm: ${current.name}`}
 *   and each row in the sheet as a button whose accessible text includes the farm name.
 *   No data-testid is present on this component; aria-label + text-content selectors
 *   are sufficiently stable for these assertions.
 */

import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../fixtures/seed.api';

const FARM_ALPHA = 'E2E Farm Alpha';
const FARM_BETA  = 'E2E Farm Beta';

// ---------------------------------------------------------------------------
// Shared login helper (mirrors pattern used in specs 01–03)
// ---------------------------------------------------------------------------
async function loginAsAdmin(page: import('@playwright/test').Page) {
    await page.goto('/');

    const phoneInput = page
        .locator('input[type="tel"], input[placeholder*="phone"]')
        .first();
    await phoneInput.waitFor({ timeout: 15_000 });
    await phoneInput.fill('8888888888');

    const passwordInput = page.locator('input[type="password"]').first();
    await passwordInput.waitFor({ timeout: 10_000 });
    await passwordInput.fill('admin123');

    await page.getByRole('button', { name: /sign in|login|submit/i }).first().click();

    // Wait until the app has rendered the home greeting (auth + data load done)
    await expect(page.getByTestId('home-greeting')).toBeVisible({ timeout: 25_000 });
}

test.describe('Farm context switch', () => {
    test('switcher pill is visible and shows Farm Alpha as active after login', async ({ page }) => {
        await resetAndSeed('admin_two_orgs');
        await loginAsAdmin(page);

        // The FarmContextSwitcher pill must be visible — it only renders when
        // myFarms is populated (non-null), which happens after getMyFarms() resolves.
        const pill = page.getByRole('button', { name: new RegExp(`Current farm: ${FARM_ALPHA}`, 'i') });
        await expect(pill).toBeVisible({ timeout: 15_000 });
    });

    test('switcher sheet lists both farms and allows switching to Farm Beta', async ({ page }) => {
        await resetAndSeed('admin_two_orgs');
        await loginAsAdmin(page);

        // Wait for the pill (Farm Alpha should be active — it is farms[0] from the
        // backend, which returns farms in creation order; Farm Alpha was seeded first).
        const pillAlpha = page.getByRole('button', { name: new RegExp(`Current farm: ${FARM_ALPHA}`, 'i') });
        await expect(pillAlpha).toBeVisible({ timeout: 15_000 });

        // Open the switcher sheet
        await pillAlpha.click();

        // The sheet header shows "Your farms · N" — assert N = 2
        const sheetHeader = page.locator('text=/Your farms · 2/');
        await expect(sheetHeader).toBeVisible({ timeout: 5_000 });

        // Both farm names must be present as buttons in the sheet
        const rowAlpha = page.getByRole('button', { name: new RegExp(FARM_ALPHA) });
        const rowBeta  = page.getByRole('button', { name: new RegExp(FARM_BETA) });
        await expect(rowAlpha).toBeVisible({ timeout: 5_000 });
        await expect(rowBeta).toBeVisible({ timeout: 5_000 });

        // Switch to Farm Beta
        await rowBeta.click();

        // After switching the sheet closes and the pill must now read Farm Beta
        const pillBeta = page.getByRole('button', { name: new RegExp(`Current farm: ${FARM_BETA}`, 'i') });
        await expect(pillBeta).toBeVisible({ timeout: 10_000 });

        // Farm Alpha pill must be gone (different active farm)
        await expect(pillAlpha).not.toBeVisible();
    });

    test('switcher sheet can be closed without switching', async ({ page }) => {
        await resetAndSeed('admin_two_orgs');
        await loginAsAdmin(page);

        const pillAlpha = page.getByRole('button', { name: new RegExp(`Current farm: ${FARM_ALPHA}`, 'i') });
        await expect(pillAlpha).toBeVisible({ timeout: 15_000 });

        // Open the sheet
        await pillAlpha.click();
        await expect(page.locator('text=/Your farms · 2/')).toBeVisible({ timeout: 5_000 });

        // Close via the X button
        await page.getByRole('button', { name: /^Close$/i }).click();

        // Sheet must be gone; active farm is still Alpha
        await expect(page.locator('text=/Your farms · 2/')).not.toBeVisible({ timeout: 5_000 });
        await expect(pillAlpha).toBeVisible({ timeout: 5_000 });
    });
});
