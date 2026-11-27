// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane HONESTY-1, item H9; doctrine P4)
 *
 * "plan ends in N days" needs N. The banner used to turn a missing number into 0 ("प्लॅन 0 दिवसांत संपेल" - the plan ends in zero
 * days), a made-up figure that reads as an emergency. With no number from the server it now draws nothing. The other alerts, and the
 * banner when the number IS there, are unchanged.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The billing switch (VITE_BILLING_VISIBLE, default off). featureFlags.ts reads its env in a form vi.stubEnv does not reach in
// this repo (see MeterQuestionHost.test.tsx), so the switch is turned through the module.
const billing = vi.hoisted(() => ({ on: false }));
vi.mock('../../../../app/featureFlags', async (orig) => ({ ...(await orig<typeof import('../../../../app/featureFlags')>()), isBillingVisible: () => billing.on }));
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';

const farmContext = vi.hoisted(() => ({ meContext: null as unknown }));
vi.mock('../../../../core/session/FarmContext', () => ({ useFarmContext: () => farmContext }));

import MeAlertRail from '../MeAlertRail';

const withAlerts = (alerts: unknown[]) => {
    farmContext.meContext = { me: {}, farms: [{ farmId: 'f1', name: 'सोनाका शेत' }], share: {}, alerts };
};

// Repair R1-g 1c (founder, 27 Nov): the plan alerts are drawn only with the billing switch on (off by default;
// MeAlertRail.billingSwitch.test.tsx). This suite checks what they SAY once drawn, so it turns the switch on.
beforeEach(() => { farmContext.meContext = null; billing.on = true; });
afterEach(() => { cleanup(); billing.on = false; });

describe('H9 - the plan-ending banner never invents a number of days', () => {
    it('daysLeft missing (undefined, null, NaN): nothing is drawn - not "0 दिवसांत"', () => {
        for (const daysLeft of [undefined, null, Number.NaN]) {
            withAlerts([{ kind: 'plan_expiring', severity: 'warn', farmId: 'f1', ...(daysLeft === undefined ? {} : { daysLeft }) }]);
            const { container, unmount } = render(<MeAlertRail />);
            expect(container.textContent).toBe('');
            expect(container.querySelector('[role="status"]')).toBeNull();
            unmount();
        }
    });

    it('a number that is not a count of days left (negative): nothing is drawn', () => {
        withAlerts([{ kind: 'plan_expiring', severity: 'warn', farmId: 'f1', daysLeft: -2 }]);
        const { container } = render(<MeAlertRail />);
        expect(container.textContent).toBe('');
    });

    it('daysLeft present: the banner reads as before, in both languages', () => {
        withAlerts([{ kind: 'plan_expiring', severity: 'warn', farmId: 'f1', daysLeft: 5 }]);
        render(<MeAlertRail />);
        expect(screen.getByRole('status').textContent).toContain('सोनाका शेत — प्लॅन 5 दिवसांत संपेल');
        expect(screen.getByRole('status').textContent).toContain('plan ends in 5 days');
    });

    it('a real 0 (the plan ends today) is still said - 0 is only wrong when it was never sent', () => {
        withAlerts([{ kind: 'plan_expiring', severity: 'warn', farmId: 'f1', daysLeft: 0 }]);
        render(<MeAlertRail />);
        expect(screen.getByRole('status').textContent).toContain('प्लॅन 0 दिवसांत संपेल');
    });

    it('an unknown-days banner leaves the OTHER alerts alone, and no empty strip behind it', () => {
        withAlerts([
            { kind: 'plan_expiring', severity: 'warn', farmId: 'f1' },
            { kind: 'plan_expired', severity: 'error', farmId: 'f1' },
            { kind: 'verify_phone', severity: 'info' },
        ]);
        render(<MeAlertRail />);
        const rows = screen.getAllByRole('status').map(n => n.textContent ?? '');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toContain('प्लॅन संपला आहे');
        expect(rows[1]).toContain('तुमचा फोन नंबर तपासून पहा');
        expect(document.body.textContent).not.toContain('दिवसांत संपेल');
    });
});
