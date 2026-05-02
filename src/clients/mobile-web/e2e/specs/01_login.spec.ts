/**
 * Spec 01 — Login
 *
 * Tests the password-form (LoginPage.tsx "legacy" flow) rather than the OTP flow.
 * Rationale: the seeded Ramu user (phone 9999999999 / password ramu123) was
 * created with a hashed password and can be authenticated via the password form
 * directly. The OTP flow sends a real SMS code and cannot be exercised headlessly
 * without a stub. The password form is the reliable path for CI.
 */
import { test, expect } from '@playwright/test';
import { resetAndSeed } from '../fixtures/seed.api';
import { loginViaPassword } from '../fixtures/loginHelper';

test.describe('Login', () => {
    test('login with seeded user lands on home', async ({ page }) => {
        await resetAndSeed('ramu');

        await loginViaPassword(page, '9999999999', 'ramu123');

        // Assert we are no longer on the /login route
        await expect(page).not.toHaveURL(/login/i);
    });

    test('invalid password shows inline error and stays on login', async ({ page }) => {
        await resetAndSeed('ramu');

        // Negative test — cannot use loginViaPassword (it asserts success).
        // Inline the toggle-to-password flow with a WRONG password.
        await page.goto('/');

        const useLegacyButton = page.getByRole('button', { name: /password.*legacy|पासवर्डने/i });
        await useLegacyButton.waitFor({ timeout: 15_000 });
        await useLegacyButton.click();

        const phoneInput = page.locator('#auth-phone');
        await phoneInput.waitFor({ timeout: 10_000 });
        await phoneInput.fill('9999999999');

        const passwordInput = page.locator('#auth-password');
        await passwordInput.waitFor({ timeout: 10_000 });
        await passwordInput.fill('wrong_password_xyz');

        const submitBtn = page.locator('button[type="submit"]').first();
        await submitBtn.click();

        // An inline alert div (role="alert") should appear with an error message
        const alert = page.getByRole('alert').first();
        await expect(alert).toBeVisible({ timeout: 10_000 });
        await expect(alert).toContainText(/invalid|incorrect|wrong|चुकीचे|unauthorized/i);

        // Still on login — home-greeting should NOT be present
        await expect(page.getByTestId('home-greeting')).not.toBeVisible();
    });
});
