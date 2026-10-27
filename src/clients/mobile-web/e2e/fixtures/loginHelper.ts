import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Shared login helper for Sub-plan 05 specs.
 *
 * A fresh browser context first shows स्वागत (plr-d10 I16); `passFirstRunWelcomeIfPresent` taps
 * "सुरू करूया". The mobile-web LoginPage then renders the OTP flow by default ("OTP पाठवा").
 * Specs use the legacy password form because OTP requires SMS delivery
 * which CI does not have. To reach the password form, click the
 * "पासवर्डने लॉग इन करा" toggle button (Marathi only since plr-d10 I16).
 *
 * Then fill phone + password + optionally toggle the "Remember this device"
 * checkbox (pre-checked by default; pass rememberDevice: false to uncheck it),
 * then click submit. Asserts the home shell visible (proves auth + initial sync
 * pull completed).
 *
 * spec: secure-remembered-device-sessions-2026-06-24 — Task 7.1
 * Added `options.rememberDevice` — when false, unchecks the "Remember this
 * device" checkbox before submit. The checkbox is pre-checked by default
 * (founder decision 2026-06-27), so callers that want the default behaviour
 * can omit the option or pass `true`.
 *
 * Selector note: the checkbox has id="remember-device-password" and its label
 * text is "हे डिव्हाइस लक्षात ठेवा" (Marathi only since plr-d10 I16 — the English half is gone).
 */
/**
 * The testid that proves the signed-in app shell (the Home log view) is on screen.
 *
 * `the home shell` (the "Owner: <name>" chip) was removed from Home by the
 * home-reorder change (spec §4.2; `log-view-home-reorder.test.tsx` pins that it
 * must NOT come back). The owner now shows in the header, so the greeting chip
 * is the wrong thing to wait for. `main-view-transition` wraps every main view
 * and is rendered only for an authenticated user past the consent / login gates,
 * so "visible" still means "auth + shell rendered", exactly what the old
 * assertion proved.
 */
export const HOME_READY_TESTID = 'main-view-transition';

export interface LoginOptions {
    /** When explicitly false, unchecks the "Remember this device" checkbox. Default: true (leave pre-checked). */
    rememberDevice?: boolean;
}

/**
 * spec: plr-d10-x1-consent-tick-on-phone-screen-2026-10-25 — consent is one tick on the
 * phone-number screen (LoginPage, both modes; the QR join page), recorded before the
 * number leaves the device. There is no full-screen gate any more, and the tick is shown
 * on EVERY login (consent belongs to the person logging in, not the phone), so the submit
 * button stays disabled until it is ticked - including after a logout.
 *
 * DELIBERATELY NOT FLAG-GATED AWAY. A real farmer has to tick this box, so the test
 * ticks it too, the way he does - and the submit then records consent for real before
 * signing in, so every login spec exercises the consent write.
 *
 * Waits for ONE of two things rather than sleeping: the tick appearing (tick it, then the
 * submit must turn enabled), or the submit turning enabled on its own (the tick was
 * already given on this visit). Neither is true while the screen is still mounting, and
 * clicking a disabled submit would do nothing.
 *
 * Returns true when the tick was present and ticked. Never throws on absence: if neither
 * happens it returns false and lets the CALLER's own wait produce the real failure.
 */
export async function tickConsentIfPresent(page: Page, submit: Locator): Promise<boolean> {
    const tick = page.getByTestId('consent-tick');
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        if (await tick.isVisible().catch(() => false)) {
            await tick.check();
            await expect(submit).toBeEnabled({ timeout: 10_000 });
            return true;
        }
        if (await submit.isEnabled().catch(() => false)) return false;
        await page.waitForTimeout(250);
    }
    return false;
}


/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — FR-1) — स्वागत is the first screen on a
 * phone (browser context) that has not seen it, before the login. Tap "सुरू करूया" when it is there;
 * return quietly when the login is already on screen.
 */
export async function passFirstRunWelcomeIfPresent(page: Page): Promise<void> {
    const start = page.getByTestId('first-run-start');
    const login = page.getByRole('button', { name: /पासवर्डने/ });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        if (await start.isVisible().catch(() => false)) {
            await start.click();
            return;
        }
        if (await login.isVisible().catch(() => false)) return;
        await page.waitForTimeout(250);
    }
}

export async function loginViaPassword(
    page: Page,
    phone: string,
    password: string,
    options: LoginOptions = {},
): Promise<void> {
    await page.goto('/');
    await passFirstRunWelcomeIfPresent(page);

    // Toggle from OTP (default) to password (legacy) form. The button is only
    // visible while topMode === 'otp'; clicking switches to topMode='password'.
    // spec: plr-d10 I16 (LANG-2) — LoginPage.tsx renders "पासवर्डने लॉग इन करा" only (no "/ Use password").
    const useLegacyButton = page.getByRole('button', { name: /पासवर्डने लॉग इन करा/ });
    await useLegacyButton.waitFor({ timeout: 15_000 });
    await useLegacyButton.click();

    // Now the legacy form is rendered with id="auth-phone" + id="auth-password".
    const phoneInput = page.locator('#auth-phone');
    await phoneInput.waitFor({ timeout: 10_000 });
    await phoneInput.fill(phone);

    const passwordInput = page.locator('#auth-password');
    await passwordInput.waitFor({ timeout: 10_000 });
    await passwordInput.fill(password);

    // spec: secure-remembered-device-sessions-2026-06-24 — Task 7.1
    // The "Remember this device" checkbox (id="remember-device-password") is
    // pre-checked. Only interact when the caller explicitly wants it OFF.
    // We use getByLabel so the selector is tied to the visible label text,
    // not to a fragile id — label text: "हे डिव्हाइस लक्षात ठेवा" (Marathi only since plr-d10 I16)
    if (options.rememberDevice === false) {
        const rememberCheckbox = page.getByLabel(/हे डिव्हाइस लक्षात ठेवा/);
        await rememberCheckbox.waitFor({ timeout: 10_000 });
        // The checkbox is pre-checked; we need to uncheck it.
        await rememberCheckbox.uncheck();
    }

    // The submit button text varies by mode (Sign In / Register / etc).
    // Use the form's button[type="submit"] as the canonical selector.
    const submitButton = page.locator('button[type="submit"]').first();
    await tickConsentIfPresent(page, submitButton);
    await submitButton.click();

    // spec: plr-d10 I16 — after sign-in, a first-run phone shows फोनच्या परवानग्या and then the welcome
    // written for the role (in that order). Click through whichever is on screen until home.
    for (let step = 0; step < 3; step += 1) {
        const landing = await waitForLoginLanding(page);
        if (landing === 'home') break;
        await page.getByTestId(landing === 'welcome' ? 'welcome-continue' : 'permissions-continue').click();
    }

    // Auth + initial sync pull takes a moment; the home shell only appears once
    // both complete. Generous timeout for CI.
    await expect(page.getByTestId(HOME_READY_TESTID)).toBeVisible({ timeout: 30_000 });
}

async function waitForLoginLanding(page: Page): Promise<'home' | 'permissions' | 'welcome'> {
    const deadline = Date.now() + 30_000;
    const homeGreeting = page.getByTestId(HOME_READY_TESTID);
    const welcomeContinue = page.getByTestId('welcome-continue');
    const skipBtn = page.getByTestId('permissions-continue');
    const alert = page.getByRole('alert').first();

    while (Date.now() < deadline) {
        if (await homeGreeting.isVisible().catch(() => false)) {
            return 'home';
        }

        if (await welcomeContinue.isVisible().catch(() => false)) {
            return 'welcome';
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
