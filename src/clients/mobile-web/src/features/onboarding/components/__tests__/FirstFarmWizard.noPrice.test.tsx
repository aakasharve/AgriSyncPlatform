// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g (founder 27 Nov: "Do not mention anything about pricing in the
 * app anywhere right now"). The add-a-farm wizard's summary showed "Trial · ट्रायल / 21 days free / 21 दिवस मोफत" to an owner
 * adding a farm. Behind the default-off switch VITE_BILLING_VISIBLE it is not drawn; the role stays.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const billing = vi.hoisted(() => ({ on: false }));
vi.mock('../../../../app/featureFlags', async (orig) => ({ ...(await orig<typeof import('../../../../app/featureFlags')>()), isBillingVisible: () => billing.on }));
import { cleanup, render, screen } from '@testing-library/react';
import { WizardDonePlanLine, WizardSummaryRoleTrial } from '../FirstFarmWizard';

afterEach(() => { cleanup(); billing.on = false; });

describe('add-a-farm wizard summary', () => {
    it('switch OFF (every pilot phone): no trial, no "free days", the role still shows', () => {
        const { container } = render(<WizardSummaryRoleTrial />);
        const text = container.textContent ?? '';
        expect(text).not.toMatch(/Trial|ट्रायल|days free|दिवस मोफत|मोफत|free/i);
        expect(screen.getByText('मुख्य मालक')).toBeInTheDocument();
        expect(screen.getByText('Primary Owner')).toBeInTheDocument();
    });

    it('switch ON: the trial cell shows as before', () => {
        billing.on = true;
        render(<WizardSummaryRoleTrial />);
        expect(screen.getByText('21 days free')).toBeInTheDocument();
        expect(screen.getByText('21 दिवस मोफत')).toBeInTheDocument();
    });
});

describe('add-a-farm wizard "तयार आहे!" screen: the server\'s plan line', () => {
    const trialing = {
        subscriptionId: 'sub-1', status: 'Trialing', planCode: 'shramsafal_pro', validUntilUtc: '2026-12-19T00:00:00Z', allowsOwnerWrites: true,
    };

    it('switch OFF (every pilot phone): no "Trialing", no plan code', () => {
        const { container } = render(<WizardDonePlanLine subscription={trialing} />);
        expect(container.textContent ?? '').toBe('');
        expect(screen.queryByTestId('wizard-done-plan')).not.toBeInTheDocument();
    });

    it('switch ON: the status and the plan show as before', () => {
        billing.on = true;
        render(<WizardDonePlanLine subscription={trialing} />);
        expect(screen.getByTestId('wizard-done-plan')).toHaveTextContent('Trialing · shramsafal_pro');
    });

    it('no subscription from the server: nothing, with the switch on too', () => {
        billing.on = true;
        const { container } = render(<WizardDonePlanLine subscription={null} />);
        expect(container.textContent ?? '').toBe('');
    });
});
