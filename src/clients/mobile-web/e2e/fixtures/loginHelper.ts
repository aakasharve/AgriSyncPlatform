import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Shared login helper for Sub-plan 05 specs.
 *
 * The mobile-web LoginPage renders the OTP flow by default ("OTP पाठवा / Send OTP").
 * Specs use the legacy password form because OTP requires SMS delivery
 * which CI does not have. To reach the password form, click the
 * "पासवर्डने लॉग इन करा / Use password (legacy)" toggle button.
 *
 * Then fill phone + password + click submit. Asserts home-greeting visible
 * (proves auth + initial sync pull completed).
 */
export async function loginViaPassword(
    page: Page,
    phone: string,
    password: string,
): Promise<void> {
    await page.goto('/');

    // Toggle from OTP (default) to password (legacy) form. The button is only
    // visible while topMode === 'otp'; clicking switches to topMode='password'.
    const useLegacyButton = page.getByRole('button', { name: /password.*legacy|पासवर्डने/i });
    await useLegacyButton.waitFor({ timeout: 15_000 });
    await useLegacyButton.click();

    // Now the legacy form is rendered with id="auth-phone" + id="auth-password".
    const phoneInput = page.locator('#auth-phone');
    await phoneInput.waitFor({ timeout: 10_000 });
    await phoneInput.fill(phone);

    const passwordInput = page.locator('#auth-password');
    await passwordInput.waitFor({ timeout: 10_000 });
    await passwordInput.fill(password);

    // The submit button text varies by mode (Sign In / Register / etc).
    // Use the form's button[type="submit"] as the canonical selector.
    const submitButton = page.locator('button[type="submit"]').first();
    await submitButton.click();

    const landing = await waitForLoginLanding(page);
    if (landing === 'permissions') {
        await page.getByTestId('onboarding-skip').click();
    }

    // Auth + initial sync pull takes a moment; home-greeting only appears once
    // both complete. Generous timeout for CI.
    await expect(page.getByTestId('home-greeting')).toBeVisible({ timeout: 30_000 });
}

async function waitForLoginLanding(page: Page): Promise<'home' | 'permissions'> {
    const deadline = Date.now() + 30_000;
    const homeGreeting = page.getByTestId('home-greeting');
    const skipBtn = page.getByTestId('onboarding-skip');
    const alert = page.getByRole('alert').first();

    while (Date.now() < deadline) {
        if (await homeGreeting.isVisible().catch(() => false)) {
            return 'home';
        }

        if (await skipBtn.isVisible().catch(() => false)) {
            return 'permissions';
        }

        if (await alert.isVisible().catch(() => false)) {
            const text = (await alert.textContent())?.trim() ?? 'unknown auth error';
            throw new Error(`Login failed before the app shell rendered: ${text}`);
        }

        await page.waitForTimeout(250);
    }

    await expect(homeGreeting).toBeVisible({ timeout: 1 });
    return 'home';
}
