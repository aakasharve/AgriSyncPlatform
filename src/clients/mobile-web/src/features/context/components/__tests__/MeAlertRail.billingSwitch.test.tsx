// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 1, task 1c (founder change, 27 Nov). The server's two
 * plan alerts ("प्लॅन ‹N› दिवसांत संपेल" / "प्लॅन संपला आहे" and their English) are behind the default-off switch
 * VITE_BILLING_VISIBLE. Off, they are not drawn and leave no gap: the rail shows the other alerts as before, or nothing at all.
 * On, they read exactly as before.
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
const PLAN_ALERTS = [
    { kind: 'plan_expiring', severity: 'warn', farmId: 'f1', daysLeft: 5 },
    { kind: 'plan_expired', severity: 'error', farmId: 'f1' },
];

beforeEach(() => { farmContext.meContext = null; });
afterEach(() => { cleanup(); billing.on = false; });

describe('switch OFF (the default, every pilot phone)', () => {
    it('only plan alerts: the rail draws nothing at all (no empty strip)', () => {
        withAlerts(PLAN_ALERTS);
        const { container } = render(<MeAlertRail />);
        expect(container).toBeEmptyDOMElement();
    });

    it('a plan alert beside another: only the other is drawn, and no plan word anywhere', () => {
        withAlerts([...PLAN_ALERTS, { kind: 'verify_phone', severity: 'info' }]);
        render(<MeAlertRail />);
        const rows = screen.getAllByRole('status');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toHaveTextContent('तुमचा फोन नंबर तपासून पहा');
        expect(document.body.textContent).not.toMatch(/प्लॅन|plan/i);
    });
});

describe('switch ON', () => {
    it('both plan alerts read as before, in both languages', () => {
        billing.on = true;
        withAlerts(PLAN_ALERTS);
        render(<MeAlertRail />);
        const rows = screen.getAllByRole('status').map(n => n.textContent ?? '');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toContain('सोनाका शेत — प्लॅन 5 दिवसांत संपेल');
        expect(rows[0]).toContain('plan ends in 5 days');
        expect(rows[1]).toContain('सोनाका शेत — प्लॅन संपला आहे');
        expect(rows[1]).toContain('plan has expired');
    });
});
