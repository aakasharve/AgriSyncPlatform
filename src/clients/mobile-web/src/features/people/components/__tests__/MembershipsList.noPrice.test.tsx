// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g (founder 27 Nov: "Do not mention anything about pricing in the
 * app anywhere right now"). The real-browser drive found a "TRIAL" chip beside "मालक · Owner" on माझी ओळख → तुमच्या शेती, and the
 * add-a-farm wizard's first screen saying "तुम्हाला 21 दिवसांचे ट्रायल मिळेल…". Behind the default-off switch VITE_BILLING_VISIBLE
 * neither is drawn.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const billing = vi.hoisted(() => ({ on: false }));
vi.mock('../../../../app/featureFlags', async (orig) => ({ ...(await orig<typeof import('../../../../app/featureFlags')>()), isBillingVisible: () => billing.on }));
import { cleanup, render, screen } from '@testing-library/react';
import MembershipsList from '../MembershipsList';
import FirstFarmWizard from '../../../onboarding/components/FirstFarmWizard';
import type { MyFarmDto } from '../../../onboarding/qr/inviteApi';

afterEach(() => { cleanup(); billing.on = false; });

const DAY = 24 * 60 * 60 * 1000;
const farm = (statusCode: number, allowsOwnerWrites: boolean): MyFarmDto => ({
    farmId: 'f1', name: 'फ-ए शेत', farmCode: 'G54J5H', role: 'PrimaryOwner', status: 'Active',
    subscription: { statusCode, status: statusCode === 1 ? 'Trialing' : 'Expired', planCode: 'pro_monthly', validUntilUtc: new Date(Date.now() + 21 * DAY).toISOString(), allowsOwnerWrites },
} as unknown as MyFarmDto);

describe('no plan words on the farm rows (switch OFF, every pilot phone)', () => {
    it('a farm on a trial shows no "Trial" chip; an ended one shows no "Paid" chip', () => {
        const { container, unmount } = render(<MembershipsList farms={[farm(1, true)]} onExit={async () => {}} />);
        expect(container.textContent).not.toMatch(/Trial|ट्रायल/i);
        unmount();
        const ended = render(<MembershipsList farms={[farm(3, false)]} onExit={async () => {}} />);
        expect(ended.container.textContent).not.toMatch(/Paid|Trial/i);
        expect(screen.getByText('फ-ए शेत')).toBeInTheDocument();
    });
    it('switch ON: the chips show as before', () => {
        billing.on = true;
        render(<MembershipsList farms={[farm(1, true)]} onExit={async () => {}} />);
        expect(screen.getByText('Trial')).toBeInTheDocument();
    });
});

describe('add-a-farm wizard first screen (switch OFF)', () => {
    it('says nothing about a trial or a subscription', () => {
        const { container } = render(<FirstFarmWizard isOpen onComplete={() => {}} />);
        expect(container.textContent).not.toMatch(/ट्रायल|सब्स्क्रिप्शन|trial|subscription|card needed/i);
    });
    it('switch ON: the old line shows', () => {
        billing.on = true;
        render(<FirstFarmWizard isOpen onComplete={() => {}} />);
        expect(screen.getByText(/21-day trial, no card needed\./)).toBeInTheDocument();
    });
});
