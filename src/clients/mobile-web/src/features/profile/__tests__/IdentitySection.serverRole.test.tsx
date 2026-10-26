// @vitest-environment jsdom
/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — honest identity labels.
 *   - the chip beside the name is the role the SERVER holds for the CURRENT farm, never a fixed
 *     "मुख्य मालक" (a worker used to be shown as the main owner);
 *   - no server answer → no chip at all;
 *   - a seat that is not Active (a typed-code request) → no chip: its role is a placeholder (F3);
 *   - "Verified Farmer" is gone.
 * Mocks follow IdentitySection.teamActions.test.tsx.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

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
import type { MyFarmDto } from '../../onboarding/qr/inviteApi';

afterEach(cleanup);

const membership = (farmId: string, role: string): MyFarmDto =>
    ({ farmId, name: `farm ${farmId}`, role, farmCode: null, subscription: null });

function mount(opts: {
    myFarm: { farmId: string; role: string } | null;
    memberships?: MyFarmDto[];
    currentFarmId?: string | null;
    verificationStatus?: VerificationStatus;
}) {
    const profile = {
        name: 'Ramesh', village: 'Pune', phone: '9999999999',
        verificationStatus: opts.verificationStatus ?? VerificationStatus.PhoneVerified,
        operators: [],
    } as unknown as FarmerProfile;
    return render(
        <IdentitySection
            profile={profile}
            onUpdateProfile={vi.fn()}
            logout={vi.fn()}
            myFarm={opts.myFarm ? { ...opts.myFarm, name: 'Farm', subscription: null } : null}
            myMemberships={opts.memberships ?? []}
            currentFarmId={opts.currentFarmId}
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

describe('IdentitySection shows the server role, never a fixed "main owner"', () => {
    it('a worker is shown as a worker', () => {
        mount({ myFarm: { farmId: 'f-1', role: 'Worker' } });
        expect(screen.getByTestId('identity-role-chip')).toHaveTextContent('कामगार');
        expect(document.body.textContent).not.toContain('मुख्य मालक');
        expect(document.body.textContent).not.toContain('profile.primaryOwner');
    });

    it('the CURRENT farm\'s role wins over the farm the page loaded first', () => {
        mount({
            myFarm: { farmId: 'f-1', role: 'PrimaryOwner' },
            memberships: [membership('f-1', 'PrimaryOwner'), membership('f-2', 'Mukadam')],
            currentFarmId: 'f-2',
        });
        expect(screen.getByTestId('identity-role-chip')).toHaveTextContent('मुकादम');
    });

    it('an owner is shown as the owner (server-sent PrimaryOwner → मालक)', () => {
        mount({ myFarm: { farmId: 'f-1', role: 'PrimaryOwner' }, memberships: [membership('f-1', 'PrimaryOwner')], currentFarmId: 'f-1' });
        expect(screen.getByTestId('identity-role-chip')).toHaveTextContent('मालक');
    });

    it('no server answer yet → no role chip at all (nothing invented)', () => {
        mount({ myFarm: null });
        expect(screen.queryByTestId('identity-role-chip')).toBeNull();
        expect(document.body.textContent).not.toContain('profile.primaryOwner');
    });

    it('a request still waiting for the owner shows NO role — its "Worker" is a placeholder nobody granted (F3)', () => {
        mount({
            myFarm: { farmId: 'f-1', role: 'PrimaryOwner' },
            memberships: [{ ...membership('f-2', 'Worker'), status: 'PendingApproval' }],
            currentFarmId: 'f-2',
        });
        expect(screen.queryByTestId('identity-role-chip')).toBeNull();
    });

    it('an Active seat with a status still shows its role', () => {
        mount({
            myFarm: null,
            memberships: [{ ...membership('f-2', 'Mukadam'), status: 'Active' }],
            currentFarmId: 'f-2',
        });
        expect(screen.getByTestId('identity-role-chip')).toHaveTextContent('मुकादम');
    });
});

describe('IdentitySection has no "Verified Farmer"', () => {
    it.each([
        [VerificationStatus.GovernmentVerified],
        [VerificationStatus.PhoneVerified],
        [VerificationStatus.Unverified],
    ])('status %s', (status) => {
        mount({ myFarm: { farmId: 'f-1', role: 'Worker' }, verificationStatus: status });
        expect(document.body.textContent).not.toContain('Verified Farmer');
        expect(document.body.textContent).not.toContain('पडताळणी झालेला शेतकरी');
    });
});
