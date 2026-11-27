// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 1, task 1c as the founder changed it on 27 Nov: "Do not
 * mention anything about pricing in the app anywhere right now." The "तुमचं शेत तयार आहे" screen says nothing about a price, a
 * plan, a trial or its days — for the primary owner too, and with the billing switch on or off (the price lines were never
 * built; this pins that they stay out).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The billing switch (VITE_BILLING_VISIBLE, default off). featureFlags.ts reads its env in a form vi.stubEnv does not reach in
// this repo (see MeterQuestionHost.test.tsx), so the switch is turned through the module.
const billing = vi.hoisted(() => ({ on: false }));
vi.mock('../../app/featureFlags', async (orig) => ({ ...(await orig<typeof import('../../app/featureFlags')>()), isBillingVisible: () => billing.on }));
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../onboarding/DawnScene', () => ({ default: () => null }));

import WelcomeScreen from '../WelcomeScreen';

afterEach(() => { cleanup(); billing.on = false; });

/** What the person reads: the screen's text without its <style> block. */
const visibleText = () => {
    const el = screen.getByTestId('role-welcome').cloneNode(true) as HTMLElement;
    el.querySelectorAll('style').forEach(s => s.remove());
    return el.textContent ?? '';
};
const NO_MONEY_WORDS = /₹|रुपये|शुल्क|विनामूल्य|चाचणी|ट्रायल|प्लॅन|बिलिंग|सदस्यता|trial|plan|billing|price|free|subscription/i;

describe('the "तुमचं शेत तयार आहे" screen says nothing about money', () => {
    it.each(['false', 'true'])('primary owner, billing switch %s: no price, plan, trial or day-count line', (on) => {
        billing.on = on === 'true';
        render(<WelcomeScreen onContinue={vi.fn()} farmRole="PrimaryOwner" farmName="आर्वे शेती" />);
        expect(screen.getByTestId('role-welcome-title')).toHaveTextContent('तुमचं शेत तयार आहे');
        expect(visibleText()).not.toMatch(NO_MONEY_WORDS);
        expect(visibleText()).not.toMatch(/[0-9०-९]/);
    });
});
