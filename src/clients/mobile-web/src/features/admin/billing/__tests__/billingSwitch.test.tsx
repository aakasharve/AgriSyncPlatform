// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 1, task 1c (founder change, 28 Nov: "Don't show billing
 * card yet for Pilot users"). Behind the default-off switch VITE_BILLING_VISIBLE: the बिलिंग card (`SubscriptionCard`) and the
 * hub's trial banner (`EntitlementBanner`). Off, neither draws anything — no empty box, no "coming soon" — even for a primary
 * owner on a trial. On, each shows exactly what it showed before (its own words are not changed by this repair).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The billing switch (VITE_BILLING_VISIBLE, default off). featureFlags.ts reads its env in a form vi.stubEnv does not reach in
// this repo (see MeterQuestionHost.test.tsx), so the switch is turned through the module.
const billing = vi.hoisted(() => ({ on: false }));
vi.mock('../../../../app/featureFlags', async (orig) => ({ ...(await orig<typeof import('../../../../app/featureFlags')>()), isBillingVisible: () => billing.on }));
import { cleanup, render, screen } from '@testing-library/react';
import SubscriptionCard from '../SubscriptionCard';
import EntitlementBanner from '../EntitlementBanner';
import type { SubscriptionSnapshotDto } from '../../../onboarding/qr/inviteApi';

const DAY = 24 * 60 * 60 * 1000;
const TRIAL: SubscriptionSnapshotDto = {
    statusCode: 1, status: 'Trialing', planCode: 'pro_monthly',
    validUntilUtc: new Date(Date.now() + 21 * DAY).toISOString(), allowsOwnerWrites: true,
};
const ENDED: SubscriptionSnapshotDto = { ...TRIAL, statusCode: 3, status: 'Expired', allowsOwnerWrites: false, validUntilUtc: new Date(Date.now() - DAY).toISOString() };

afterEach(() => { cleanup(); billing.on = false; });

describe('switch OFF (the default, every pilot phone)', () => {
    it('the बिलिंग card draws nothing for a primary owner — on a trial, ended, or with no answer', () => {
        for (const subscription of [TRIAL, ENDED, null]) {
            const { container, unmount } = render(<SubscriptionCard subscription={subscription} role="PrimaryOwner" />);
            expect(container, String(subscription?.status)).toBeEmptyDOMElement();
            unmount();
        }
    });

    it('the hub\'s trial banner draws nothing for an owner or co-owner — on a trial, ended, or with no snapshot', () => {
        for (const role of ['PrimaryOwner', 'SecondaryOwner']) {
            for (const subscription of [TRIAL, ENDED, null]) {
                const { container, unmount } = render(<EntitlementBanner subscription={subscription} role={role} />);
                expect(container, `${role} ${String(subscription?.status)}`).toBeEmptyDOMElement();
                unmount();
            }
        }
    });
});

describe('switch ON: what was there before shows, unchanged', () => {
    it('the card: the trial and its end date', () => {
        billing.on = true;
        render(<SubscriptionCard subscription={TRIAL} role="PrimaryOwner" />);
        expect(screen.getByTestId('billing-known')).toBeInTheDocument();
        expect(screen.getByText('Trial')).toBeInTheDocument();
        expect(screen.getByTestId('billing-until')).toHaveTextContent(/Valid until/);
    });

    it('the banner: "Trial active · ट्रायल चालू" with the days left; a worker still sees nothing', () => {
        billing.on = true;
        render(<EntitlementBanner subscription={TRIAL} role="PrimaryOwner" />);
        expect(screen.getByText('Trial active · ट्रायल चालू')).toBeInTheDocument();
        expect(document.body.textContent).toMatch(/2[01] days left on your trial\./);
        cleanup();
        const { container } = render(<EntitlementBanner subscription={TRIAL} role="Worker" />);
        expect(container).toBeEmptyDOMElement();
    });
});
