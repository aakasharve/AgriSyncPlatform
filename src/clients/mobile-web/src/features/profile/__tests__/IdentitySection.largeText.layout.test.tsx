// @vitest-environment jsdom
/**
 * Team / farmer-identity header must not push past the right screen edge at large system text
 * (spec: 2026-08-25-prod-cutover-waves; release 1.0.13 finding F2).
 *
 * HONESTY NOTE: jsdom has no layout engine, so this cannot measure overflow. It pins the CLASS
 * CONTRACT that stops it: the name/phone rows may shrink (min-w-0), a long unbroken name wraps
 * (overflow-wrap:anywhere), the phone row wraps so the verified chip drops to its own line instead
 * of being cut off, and the chip itself never shrinks away. Real proof is the Android emulator run
 * at system font scale 1.0 / 1.5 / 2.0 (check C14), not this test.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: vi.fn(), t: (k: string) => k }),
}));
vi.mock('../../admin/billing/EntitlementBanner', () => ({ default: () => null }));
vi.mock('../../people/components/MembershipsList', () => ({ default: () => null }));
vi.mock('../hooks/useLabourPermissions', () => ({
    useLabourPermissions: () => ({
        rows: null, loading: false, loadFailed: false, savingUserId: null, error: null,
        reload: vi.fn(), setPermission: vi.fn(), dismissError: vi.fn(),
    }),
}));
vi.mock('../../labour/data/fieldOperatorClient', () => ({
    fetchFieldOperators: vi.fn().mockResolvedValue([]),
    createFieldOperator: vi.fn(),
    deactivateFieldOperator: vi.fn(),
}));
vi.mock('../../labour/data/fieldOperatorRosterCache', () => ({
    readCachedRoster: () => null,
    writeCachedRoster: vi.fn(),
}));

import IdentitySection from '../sections/IdentitySection';
import { FarmerProfile, VerificationStatus } from '../../../types';

const LONG_NAME = 'सत्यनारायणराजेंद्रप्रसादचव्हाणपाटीलदेशमुख';
const PHONE = '9999999999';

function mount() {
    const profile = {
        name: LONG_NAME, village: 'Pune', phone: PHONE,
        verificationStatus: VerificationStatus.PhoneVerified, operators: [],
    } as unknown as FarmerProfile;
    return render(
        <IdentitySection
            profile={profile}
            onUpdateProfile={vi.fn()}
            logout={vi.fn()}
            myFarm={{ farmId: 'farm-1', name: 'Farm', role: 'PrimaryOwner', subscription: null }}
            myMemberships={[]}
            farmDetails={null}
            weatherConnected={false}
            connectingWeather={false}
            connectError={null}
            handleConnectWeather={vi.fn()}
            setShowFarmBoundary={vi.fn()}
            handleOpenInviteQr={vi.fn()}
            nonExitableFarmIds={new Set()}
            handleExitMembership={vi.fn(async () => undefined)}
            isWorkerOnAnyFarm={false}
            workerProfile={null}
        />,
    );
}

const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/);

describe('IdentitySection header at large text (class contract; real proof = emulator C14)', () => {
    it('the name heading can shrink and breaks a long unbroken name', () => {
        mount();
        const h2 = screen.getByRole('heading', { level: 2, name: LONG_NAME });
        const c = classes(h2);
        expect(c).toContain('min-w-0');
        expect(c).toContain('max-w-full');
        expect(c).toContain('[overflow-wrap:anywhere]');
    });

    it('the phone row wraps and the verified chip is kept (never shrunk away)', () => {
        mount();
        const phoneRow = screen.getAllByText(PHONE)
            .map(el => el.closest('div'))
            .find(div => div !== null && classes(div).includes('flex-wrap') && classes(div).includes('min-w-0'));
        expect(phoneRow, 'phone row must be a wrapping, shrinkable flex row').toBeTruthy();
        const chip = phoneRow!.querySelector('span');
        expect(chip, 'verified chip must still render next to the phone number').toBeTruthy();
        expect(classes(chip)).toContain('shrink-0');
    });

    it('the avatar column keeps its size instead of squeezing the text column', () => {
        const { container } = mount();
        const avatar = container.querySelector('.w-20.h-20')?.parentElement;
        expect(classes(avatar ?? null)).toContain('shrink-0');
    });
});
