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

test.describe('Login', () => {
    test('login with seeded user lands on home', async ({ page }) => {
        await resetAndSeed('ramu');

        await page.goto('/');

        // If already showing the login page directly, or wait for it to load
        await page.waitForURL(/\/|login/, { timeout: 15_000 });

        // The app may redirect unauthenticated users to login automatically;
        // wait for the password input to be visible.
        const phoneInput = page.locator('input[type="tel"], input[placeholder*="phone"], input[placeholder*="9999"]').first();
        await phoneInput.waitFor({ timeout: 15_000 });
        await phoneInput.fill('9999999999');

        // Move to password field — there may be a "Next" step or a combined form
        const passwordInput = page.locator('input[type="password"]').first();
        await passwordInput.waitFor({ timeout: 10_000 });
        await passwordInput.fill('ramu123');

        // Submit
        const submitBtn = page.getByRole('button', { name: /sign in|login|submit/i }).first();
        await submitBtn.click();

        // Assert home-greeting is visible (owner name displayed post-login)
        const greeting = page.getByTestId('home-greeting');
        await expect(greeting).toBeVisible({ timeout: 20_000 });

        // Assert we are no longer on the /login route
        await expect(page).not.toHaveURL(/login/i);
    });

    test('invalid password shows inline error and stays on login', async ({ page }) => {
        await resetAndSeed('ramu');

        await page.goto('/');

        const phoneInput = page.locator('input[type="tel"], input[placeholder*="phone"], input[placeholder*="9999"]').first();
        await phoneInput.waitFor({ timeout: 15_000 });
        await phoneInput.fill('9999999999');

        const passwordInput = page.locator('input[type="password"]').first();
        await passwordInput.waitFor({ timeout: 10_000 });
        await passwordInput.fill('wrong_password_xyz');

        const submitBtn = page.getByRole('button', { name: /sign in|login|submit/i }).first();
        await submitBtn.click();

        // An inline alert div (role="alert") should appear with an error message
        const alert = page.getByRole('alert').first();
        await expect(alert).toBeVisible({ timeout: 10_000 });
        await expect(alert).toContainText(/invalid|incorrect|wrong|चुकीचे|unauthorized/i);

        // Still on login — home-greeting should NOT be present
        await expect(page.getByTestId('home-greeting')).not.toBeVisible();
    });
});
