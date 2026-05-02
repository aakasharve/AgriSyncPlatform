/**
 * Spec 05 - Farm context switch
 *
 * Verifies that a user with memberships in two farms can:
 *  1. See the FarmContextSwitcher pill in the app header after login.
 *  2. Open the switcher sheet and see both farms listed.
 *  3. Confirm Farm Alpha is the initially active farm.
 *  4. Switch to Farm Beta and see the pill update to reflect the new active farm.
 *
 * Fixture: admin_two_orgs
 *   - Phone 7777777777 / password admin123.
 *   - Two farms: "E2E Farm Alpha" and "E2E Farm Beta".
 */

import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../fixtures/seed.api';
import { loginViaPassword } from '../fixtures/loginHelper';

const FARM_ALPHA = 'E2E Farm Alpha';
const FARM_BETA = 'E2E Farm Beta';

async function loginAsAdmin(page: import('@playwright/test').Page) {
    await loginViaPassword(page, '7777777777', 'admin123');
}

test.describe('Farm context switch', () => {
    test('switcher pill is visible and shows Farm Alpha as active after login', async ({ page }) => {
        await resetAndSeed('admin_two_orgs');
        await loginAsAdmin(page);

        const pill = page.getByRole('button', { name: new RegExp(`Current farm: ${FARM_ALPHA}`, 'i') });
        await expect(pill).toBeVisible({ timeout: 15_000 });
    });

    test('switcher sheet lists both farms and allows switching to Farm Beta', async ({ page }) => {
        await resetAndSeed('admin_two_orgs');
        await loginAsAdmin(page);

        const pillAlpha = page.getByRole('button', { name: new RegExp(`Current farm: ${FARM_ALPHA}`, 'i') });
        await expect(pillAlpha).toBeVisible({ timeout: 15_000 });

        await pillAlpha.click();
        const sheet = page.getByTestId('farm-switcher-sheet');
        await expect(sheet.getByText(/Your farms/)).toBeVisible({ timeout: 5_000 });

        const rowAlpha = sheet.getByRole('button', { name: new RegExp(FARM_ALPHA) });
        const rowBeta = sheet.getByRole('button', { name: new RegExp(FARM_BETA) });
        await expect(rowAlpha).toBeVisible({ timeout: 5_000 });
        await expect(rowBeta).toBeVisible({ timeout: 5_000 });

        await rowBeta.click();

        const pillBeta = page.getByRole('button', { name: new RegExp(`Current farm: ${FARM_BETA}`, 'i') });
        await expect(pillBeta).toBeVisible({ timeout: 10_000 });
        await expect(pillAlpha).not.toBeVisible();
    });

    test('switcher sheet can be closed without switching', async ({ page }) => {
        await resetAndSeed('admin_two_orgs');
        await loginAsAdmin(page);

        const pillAlpha = page.getByRole('button', { name: new RegExp(`Current farm: ${FARM_ALPHA}`, 'i') });
        await expect(pillAlpha).toBeVisible({ timeout: 15_000 });

        await pillAlpha.click();
        const sheet = page.getByTestId('farm-switcher-sheet');
        await expect(sheet.getByText(/Your farms/)).toBeVisible({ timeout: 5_000 });

        await sheet.getByTestId('farm-switcher-close').click();

        await expect(sheet).not.toBeVisible({ timeout: 5_000 });
        await expect(pillAlpha).toBeVisible({ timeout: 5_000 });
    });
});
