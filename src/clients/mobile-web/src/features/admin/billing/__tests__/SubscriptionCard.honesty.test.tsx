// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane HONESTY-2 (H5), the billing page tells the truth.
 *
 * No snapshot, or a status the card has no wording for, says "माहिती उपलब्ध नाही" — never "No active subscription",
 * never a red "Expired" with "Renew". There is no billing portal, so no button is drawn (they all only fired an
 * English "coming soon" alert). A status the server really sends, with its date and trial days, still shows.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The billing switch (VITE_BILLING_VISIBLE, default off). featureFlags.ts reads its env in a form vi.stubEnv does not reach in
// this repo (see MeterQuestionHost.test.tsx), so the switch is turned through the module.
const billing = vi.hoisted(() => ({ on: false }));
vi.mock('../../../../app/featureFlags', async (orig) => ({ ...(await orig<typeof import('../../../../app/featureFlags')>()), isBillingVisible: () => billing.on }));
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import SubscriptionCard, { BILLING_UNKNOWN } from '../SubscriptionCard';
import type { SubscriptionSnapshotDto } from '../../../onboarding/qr/inviteApi';

// Repair R1-g 1c (founder, 27 Nov): the card is drawn only with the billing switch on (off by default; billingSwitch.test.tsx).
// This suite checks what the card SAYS once it is drawn, so it turns the switch on.
beforeEach(() => { billing.on = true; });
afterEach(() => { cleanup(); billing.on = false; });

const DAY = 24 * 60 * 60 * 1000;
const snap = (over: Partial<SubscriptionSnapshotDto> = {}): SubscriptionSnapshotDto => ({
    statusCode: 1, status: 'Trialing', planCode: 'pro_monthly',
    validUntilUtc: new Date(Date.now() + 5 * DAY).toISOString(), allowsOwnerWrites: true, ...over,
});

describe('H5 — what the card says when it does not know', () => {
    it('no snapshot: "माहिती उपलब्ध नाही", not "No active subscription", and no button', () => {
        render(<SubscriptionCard subscription={null} role="PrimaryOwner" />);
        expect(screen.getByTestId('billing-unknown')).toHaveTextContent(BILLING_UNKNOWN);
        expect(BILLING_UNKNOWN).toBe('माहिती उपलब्ध नाही');
        expect(document.body.textContent).not.toContain('No active subscription');
        expect(document.body.textContent).not.toContain('Start Pro');
        expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    it('an undefined snapshot reads the same', () => {
        render(<SubscriptionCard subscription={undefined} role="PrimaryOwner" />);
        expect(screen.getByTestId('billing-unknown')).toBeInTheDocument();
    });

    it.each(['Pending', 'Unknown', '', 'constructor'])('an unknown status "%s" is not "Expired" and has no Renew', (status) => {
        render(<SubscriptionCard subscription={snap({ status })} role="PrimaryOwner" onManageBilling={vi.fn()} />);
        expect(screen.getByTestId('billing-unknown')).toHaveTextContent(BILLING_UNKNOWN);
        expect(document.body.textContent).not.toContain('Expired');
        expect(document.body.textContent).not.toContain('Renew');
        expect(document.body.textContent).not.toContain('Valid until');
        expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    it('anyone but the primary owner sees nothing, as before', () => {
        const { container } = render(<SubscriptionCard subscription={null} role="Worker" />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('H5 — no button that only apologises', () => {
    it.each(['Trialing', 'Active', 'PastDue', 'Expired', 'Canceled', 'Suspended'])('%s with no portal wired: no button at all', (status) => {
        render(<SubscriptionCard subscription={snap({ status })} role="PrimaryOwner" />);
        expect(screen.getByTestId('billing-known')).toBeInTheDocument();
        expect(screen.queryAllByRole('button')).toHaveLength(0);
        for (const word of ['Pay now', 'Renew', 'Manage billing', 'Resubscribe', 'Contact support']) {
            expect(document.body.textContent, word).not.toContain(word);
        }
    });

    it('a button appears only when a caller passes a handler that really does something', () => {
        const open = vi.fn();
        render(<SubscriptionCard subscription={snap({ status: 'PastDue' })} role="PrimaryOwner" onManageBilling={open} />);
        fireEvent.click(screen.getByRole('button', { name: 'Pay now' }));
        expect(open).toHaveBeenCalledTimes(1);
    });

    it('the profile page no longer wires the "coming soon" alert to the card', () => {
        const source = readFileSync(join(process.cwd(), 'src', 'features', 'profile', 'ProfilePage.tsx'), 'utf8');
        expect(source).not.toContain('Billing portal coming soon');
        expect(source).not.toMatch(/onManageBilling=/);
    });
});

describe('H5 — what the server really says still shows', () => {
    it('a trial shows its real end date and the days left', () => {
        render(<SubscriptionCard subscription={snap({ status: 'Trialing' })} role="PrimaryOwner" />);
        expect(screen.getByText('Trial')).toBeInTheDocument();
        expect(screen.getByTestId('billing-until')).toHaveTextContent(/Valid until/);
        expect(screen.getByTestId('billing-until')).toHaveTextContent(/\(5 days left\)/);
    });

    it('an Expired status the server sent is still shown as Expired, with the date it ended', () => {
        render(<SubscriptionCard
            subscription={snap({ status: 'Expired', allowsOwnerWrites: false, validUntilUtc: new Date(Date.now() - 3 * DAY).toISOString() })}
            role="PrimaryOwner"
        />);
        expect(screen.getByText('Expired')).toBeInTheDocument();
        expect(screen.getByTestId('billing-until')).toHaveTextContent(/Ended/);
    });

    it('an unreadable date prints no date line, never "Invalid Date"', () => {
        render(<SubscriptionCard subscription={snap({ status: 'Active', validUntilUtc: 'not a date' })} role="PrimaryOwner" />);
        expect(screen.getByText('Active')).toBeInTheDocument();
        expect(screen.queryByTestId('billing-until')).toBeNull();
        expect(document.body.textContent).not.toContain('Invalid Date');
    });
});
