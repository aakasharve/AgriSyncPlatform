import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Shared login helper for Sub-plan 05 specs.
 *
 * The mobile-web LoginPage renders the OTP flow by default ("OTP पाठवा / Send OTP").
 * Specs use the legacy password form because OTP requires SMS delivery
 * which CI does not have. To reach the password form, click the
 * "पासवर्डने लॉग इन करा / Use password" toggle button.
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
 * text is "हे डिव्हाइस लक्षात ठेवा · Remember this device" (Marathi/Devanagari). We target it by
 * label role using /Remember this device/i so the query is locale-independent
 * and resilient to Marathi text changes.
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
 * The consent gate stands in FRONT of LoginPage for every unauthenticated boot
 * (`App.tsx`: `!isAuthenticated && consentGate.status === 'required'`), and each
 * Playwright test gets a fresh browser context, so it renders on every spec that
 * starts logged out. Without this the login specs time out waiting for a control
 * that is not on screen yet.
 *
 * DELIBERATELY NOT FLAG-GATED AWAY. It would have been cheaper to hide the gate
 * under `VITE_E2E_HARNESS`, but the worst defect found on this branch was a
 * consent button rendered below the fold on a real handset — a bug that made the
 * app unopenable and that every automated check passed straight through. Gating
 * the screen out of e2e would delete the only automated coverage of the surface
 * that has already failed hardest. A real farmer has to pass this screen, so the
 * test passes it too, exactly the way he does: tick 18+, then accept.
 *
 * Returns true when the gate was present and passed, false when it was already
 * satisfied. Never throws on absence — if neither the gate nor the login form
 * appears, it returns false and lets the CALLER's own wait produce the real
 * failure message, rather than masking it with a timeout from in here.
 */
export async function passConsentGateIfPresent(page: Page): Promise<boolean> {
    const acceptCta = page.getByTestId('consent-accept-cta');
    // SplashScreen owns the first moments of a cold boot, so neither the gate nor
    // the login form is on screen immediately. Race the two rather than sleeping.
    const useLegacyButton = page.getByRole('button', { name: /Use password/i });

    const GATE_SETTLE_POLLS = 8; // 8 x 250 ms = 2 s of a stable login form
    let loginSeenPolls = 0;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        if (await acceptCta.isVisible().catch(() => false)) {
            // The CTA is disabled until the 18+ declaration is ticked
            // (ConsentGateScreen: `disabled={!ageConfirmed || submitting}`).
            await page.getByTestId('consent-age-checkbox').check();
            await acceptCta.click();
            // Acceptance writes two legal records BEFORE markPassed, so the screen
            // stays up until they land. Waiting for it to go proves the write
            // succeeded — clicking and moving on would pass even if it threw.
            await expect(acceptCta).toBeHidden({ timeout: 20_000 });
            return true;
        }

        if (await useLegacyButton.isVisible().catch(() => false)) {
            // The login form being visible is NOT proof the gate was passed: while
            // the consent preference is still being read (`status: 'undecided'`,
            // App.tsx) the app renders LoginPage, then swaps to the gate once the
            // read settles. Treating the first sighting as "already past the gate"
            // clicked a button that was then detached (the 60 s "element was
            // detached" timeouts). Only believe it after it has stayed up for a
            // settle window in which the gate never appeared.
            loginSeenPolls += 1;
            if (loginSeenPolls >= GATE_SETTLE_POLLS) {
                return false; // genuinely past the gate
            }
        } else {
            loginSeenPolls = 0;
        }

        await page.waitForTimeout(250);
    }

    return false;
}

export async function loginViaPassword(
    page: Page,
    phone: string,
    password: string,
    options: LoginOptions = {},
): Promise<void> {
    await page.goto('/');

    await passConsentGateIfPresent(page);

    // Toggle from OTP (default) to password (legacy) form. The button is only
    // visible while topMode === 'otp'; clicking switches to topMode='password'.
    // LoginPage.tsx renders: "पासवर्डने लॉग इन करा / Use password" (Marathi/Devanagari).
    // Match the unambiguous English part — script-independent, avoids Devanagari/Bengali confusion.
    const useLegacyButton = page.getByRole('button', { name: /Use password/i });
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
    // not to a fragile id — label text: "हे डिव्हाइस लक्षात ठेवा · Remember this device" (Marathi)
    if (options.rememberDevice === false) {
        const rememberCheckbox = page.getByLabel(/Remember this device/i);
        await rememberCheckbox.waitFor({ timeout: 10_000 });
        // The checkbox is pre-checked; we need to uncheck it.
        await rememberCheckbox.uncheck();
    }

    // The submit button text varies by mode (Sign In / Register / etc).
    // Use the form's button[type="submit"] as the canonical selector.
    const submitButton = page.locator('button[type="submit"]').first();
    await submitButton.click();

    let landing = await waitForLoginLanding(page);
    // First-run WelcomeScreen (shramsafal_welcome_seen) renders once after login,
    // before the permission gate. Click through it, then re-evaluate the landing.
    if (landing === 'welcome') {
        await page.getByTestId('welcome-continue').click();
        landing = await waitForLoginLanding(page);
    }
    if (landing === 'permissions') {
        await page.getByTestId('onboarding-skip').click();
    }

    // Auth + initial sync pull takes a moment; the home shell only appears once
    // both complete. Generous timeout for CI.
    await expect(page.getByTestId(HOME_READY_TESTID)).toBeVisible({ timeout: 30_000 });
}

async function waitForLoginLanding(page: Page): Promise<'home' | 'permissions' | 'welcome'> {
    const deadline = Date.now() + 30_000;
    const homeGreeting = page.getByTestId(HOME_READY_TESTID);
    const welcomeContinue = page.getByTestId('welcome-continue');
    const skipBtn = page.getByTestId('onboarding-skip');
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
