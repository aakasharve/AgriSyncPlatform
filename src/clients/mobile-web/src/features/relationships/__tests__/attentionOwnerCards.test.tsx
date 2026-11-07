// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane MU-1. The owner's two cards on लक्ष द्या: people waiting to join
 * ("X आत येऊ इच्छितात · मंजूर / नको", the team page's own decision flow with its reasons) and the work the server kept for him
 * (what, who, when, why). Both are drawn for the farm's PRIMARY account holder alone; a roster or list that cannot be read says
 * so with a retry - never an empty "nobody" that may be untrue. Marathi mode Marathi only, English mode English only.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { LabourPermission } from '../../profile/data/labourPermissionsClient';

const h = vi.hoisted(() => ({ lang: 'mr' as 'mr' | 'en' }));
vi.mock('../../../i18n/LanguageContext', () => ({
    useOptionalLanguage: () => ({ language: h.lang, setLanguage: () => undefined, t: (k: string) => k }),
    useLanguage: () => ({ language: h.lang, setLanguage: () => undefined, t: (k: string) => k }),
}));

const fetchLabourPermissions = vi.fn();
vi.mock('../../profile/data/labourPermissionsClient', async (importActual) => ({
    ...(await importActual<typeof import('../../profile/data/labourPermissionsClient')>()),
    fetchLabourPermissions: (...a: unknown[]) => fetchLabourPermissions(...a),
}));
const approveMember = vi.fn();
const declineMember = vi.fn();
vi.mock('../../profile/data/membershipAdminClient', async (importActual) => ({
    ...(await importActual<typeof import('../../profile/data/membershipAdminClient')>()),
    approveMember: (...a: unknown[]) => approveMember(...a),
    declineMember: (...a: unknown[]) => declineMember(...a),
}));
const listInvitations = vi.fn();
const approveInvitationClaim = vi.fn();
vi.mock('../../invitations/personalInvitationClient', async (importActual) => ({
    ...(await importActual<typeof import('../../invitations/personalInvitationClient')>()),
    listInvitations: (...a: unknown[]) => listInvitations(...a),
    approveInvitationClaim: (...a: unknown[]) => approveInvitationClaim(...a),
}));
const fetchKeptWork = vi.fn();
vi.mock('../keptWorkClient', () => ({ fetchKeptWork: (...a: unknown[]) => fetchKeptWork(...a) }));

import { FarmContext } from '../../../core/session/FarmContext';
import type { MeContext, MeFarm } from '../../../core/session/MeContextService';
import JoinRequestsAttention from '../JoinRequestsAttention';
import KeptWorkAttention, { keptItemWords } from '../KeptWorkAttention';
import { relationshipCopy } from '../relationshipCopy';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

const DEVANAGARI = /[ऀ-ॿ]/;
const farm = (over: Partial<MeFarm> & { farmId: string }): MeFarm => ({
    name: 'पाटील फार्म', farmCode: 'K7M2QP', ownerAccountId: 'acc', role: 'PrimaryOwner', status: 'Active', joinedVia: 'QrScan',
    plan: 'Free', planValidUntilUtc: null,
    capabilities: { canInvite: true, canVerify: true, canAddCost: true, canSeeBilling: true },
    permissions: [], authorities: [], plotScope: 'AllPlots', plotNames: [], ...over,
});
const meCtx = (farms: MeFarm[]): MeContext => ({
    me: { userId: 'me', displayName: 'Purvesh', phoneMasked: '******1234', phoneVerifiedAtUtc: null, preferredLanguage: 'mr', authMode: 'Otp' },
    farms, share: { referralCode: null, referralsTotal: 0, referralsQualified: 0, benefitsEarned: 0 }, alerts: [], serverTimeUtc: new Date().toISOString(),
});
const inContext = (seat: MeFarm, ui: React.ReactElement) => (
    <FarmContext.Provider value={{
        meContext: meCtx([seat]), isLoading: false, currentFarmId: seat.farmId, currentFarm: seat, farms: [seat],
        switchFarm: vi.fn(), refresh: vi.fn(async () => undefined), loadFailed: false,
    }}>{ui}</FarmContext.Provider>
);

const row = (over: Partial<LabourPermission>): LabourPermission => ({
    userId: 'u', role: 'Worker', status: 'Active', canManageLabourRecords: false, hasExplicitGrant: false,
    source: 'NotGranted', isGrantEditable: true, labourGrantExpiresAtUtc: null, permissions: [], ...over,
});
const OWNER = row({ userId: 'me', role: 'PrimaryOwner', displayName: 'Purvesh', isRegistrant: true });
const REQUEST = row({ userId: 'sunil', status: 'PendingApproval', displayName: 'सुनील', joinedVia: 'SelfJoin', phoneLast4: '4321' });

beforeEach(() => {
    h.lang = 'mr';
    for (const fn of [fetchLabourPermissions, approveMember, declineMember, listInvitations, approveInvitationClaim, fetchKeptWork]) fn.mockReset();
    fetchLabourPermissions.mockResolvedValue([OWNER, REQUEST]);
    listInvitations.mockResolvedValue([]);
    fetchKeptWork.mockResolvedValue([]);
});
afterEach(cleanup);

describe('joining requests on लक्ष द्या', () => {
    it('shows "X आत येऊ इच्छितात" with the same card as the team page, and approving sends the same call', async () => {
        approveMember.mockResolvedValue(row({ userId: 'sunil', role: 'Worker', displayName: 'सुनील', approvedByOwner: true }));
        render(inContext(farm({ farmId: 'f1' }), <JoinRequestsAttention />));
        expect(await screen.findByText('सुनील आत येऊ इच्छितात')).toBeInTheDocument();
        expect(screen.getByTestId('attention-requests')).toHaveTextContent('1 जण आत येऊ इच्छितात');
        fireEvent.click(screen.getByTestId('approve-work-sunil'));
        await waitFor(() => expect(approveMember).toHaveBeenCalledWith('f1', 'sunil', expect.objectContaining({ role: 'Worker' })));
        await waitFor(() => expect(screen.queryByTestId('join-request-sunil')).toBeNull());
    });

    it('नको asks for the reason first and sends it; the request leaves only after the server answered', async () => {
        declineMember.mockResolvedValue(row({ userId: 'sunil', status: 'Revoked' }));
        render(inContext(farm({ farmId: 'f1' }), <JoinRequestsAttention />));
        fireEvent.click(await screen.findByTestId('decline-sunil'));
        fireEvent.change(screen.getByTestId('decline-step-sunil-reason'), { target: { value: 'ओळखत नाही' } });
        fireEvent.click(screen.getByTestId('decline-step-sunil-confirm'));
        await waitFor(() => expect(declineMember).toHaveBeenCalledWith('f1', 'sunil', 'ओळखत नाही'));
        await waitFor(() => expect(screen.queryByTestId('join-request-sunil')).toBeNull());
    });

    it('is drawn for the primary account holder alone: a सहमालक or a worker never even asks for the roster', async () => {
        for (const role of ['SecondaryOwner', 'Mukadam', 'Worker']) {
            render(inContext(farm({ farmId: 'f1', role }), <JoinRequestsAttention />));
            await Promise.resolve();
            expect(screen.queryByTestId('attention-requests')).toBeNull();
            cleanup();
        }
        expect(fetchLabourPermissions).not.toHaveBeenCalled();
    });

    it('a roster that cannot be read says so with a retry - never "nobody is waiting"', async () => {
        fetchLabourPermissions.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([OWNER, REQUEST]);
        render(inContext(farm({ farmId: 'f1' }), <JoinRequestsAttention />));
        const failed = await screen.findByTestId('attention-requests-failed');
        expect(failed).toHaveTextContent('विनंत्या आत्ता आणता आल्या नाहीत.');
        fireEvent.click(screen.getByTestId('attention-requests-retry'));
        expect(await screen.findByText('सुनील आत येऊ इच्छितात')).toBeInTheDocument();
    });

    it('nothing is drawn when nobody is waiting', async () => {
        fetchLabourPermissions.mockResolvedValue([OWNER]);
        render(inContext(farm({ farmId: 'f1' }), <JoinRequestsAttention />));
        await waitFor(() => expect(fetchLabourPermissions).toHaveBeenCalled());
        expect(screen.queryByTestId('attention-requests')).toBeNull();
    });

    it('English mode: the title is English only', async () => {
        h.lang = 'en';
        render(inContext(farm({ farmId: 'f1' }), <JoinRequestsAttention />));
        const section = await screen.findByTestId('attention-requests');
        expect(within(section).getByText('1 person wants to join')).toBeInTheDocument();
    });

    // MU-2 review N-6: the request card itself says the invitation was for someone else.
    it('a claim by another number says, on the card itself, who the invitation was for', async () => {
        fetchLabourPermissions.mockResolvedValue([OWNER, row({ ...REQUEST, personalInvitationId: 'inv-9', label: 'CoOwner', joinedVia: 'PersonalInvitation' })]);
        listInvitations.mockResolvedValue([
            { id: 'inv-9', name: 'रमेश', invitedPhoneLast4: '2345', claimedByAnotherNumber: true, claimedByUserId: 'sunil', status: 'Accepted' },
            { id: 'inv-8', name: 'गणू', invitedPhoneLast4: '1111', claimedByAnotherNumber: false, claimedByUserId: 'x', status: 'Accepted' },
        ]);
        render(inContext(farm({ farmId: 'f1' }), <JoinRequestsAttention />));
        const line = await screen.findByTestId('join-request-for-another-sunil');
        expect(line).toHaveTextContent('हे आमंत्रण रमेश · …2345 साठी होतं');
    });
});

describe('the owner\'s kept-work card', () => {
    const KEPT = [
        { id: 'k1', kind: 'refused', what: SyncMutationName.AddCostEntry, why: 'ShramSafal.Forbidden', whoUserId: 'g', whoName: 'गोपाळ', atUtc: '2026-11-05T09:00:00Z', authorityEndedAtUtc: null },
        { id: 'k2', kind: 'arrived_late', what: 'AttendanceMark', why: 'TakeAttendance', whoUserId: 'g', whoName: 'गोपाळ', atUtc: '2026-11-06T09:00:00Z', authorityEndedAtUtc: '2026-11-05T10:00:00Z' },
        { id: 'k3', kind: 'cap_reached', what: 'RefusedSyncMutation', why: null, whoUserId: 'g', whoName: null, atUtc: '2026-11-06T10:00:00Z', authorityEndedAtUtc: null },
    ];

    it('lists what was kept, who sent it, when and why - for the primary account holder', async () => {
        fetchKeptWork.mockResolvedValue(KEPT);
        render(inContext(farm({ farmId: 'f1' }), <KeptWorkAttention />));
        const card = await screen.findByTestId('kept-work');
        expect(fetchKeptWork).toHaveBeenCalledWith('f1');
        expect(card).toHaveTextContent('तुमच्यासाठी ठेवलेलं काम (3)');
        const refused = within(screen.getByTestId('kept-work-k1'));
        expect(refused.getByTestId('kept-what')).toHaveTextContent('खर्चाची नोंद');
        expect(refused.getByTestId('kept-who-when').textContent).toMatch(/^गोपाळ · /);
        expect(refused.getByTestId('kept-why')).toHaveTextContent('या कामाची जबाबदारी त्यांच्याकडे नव्हती');
        const late = within(screen.getByTestId('kept-work-k2'));
        expect(late.getByTestId('kept-what')).toHaveTextContent('हजेरी');
        expect(late.getByTestId('kept-why').textContent).toMatch(/जबाबदारी संपल्यानंतर पोहोचलं \(हजेरी घेणे, .* ला संपली\)/);
        expect(within(screen.getByTestId('kept-work-k3')).getByTestId('kept-who-when').textContent).toMatch(/^एक सदस्य · /);
        // No money amount, no mutation body: the card carries only what / who / when / why.
        expect(card.textContent).not.toMatch(/₹|\d{4,}/);
    });

    it('draws nothing for anyone but the primary account holder, and never asks the server', async () => {
        fetchKeptWork.mockResolvedValue(KEPT);
        for (const role of ['SecondaryOwner', 'Mukadam', 'Worker']) {
            render(inContext(farm({ farmId: 'f1', role }), <KeptWorkAttention />));
            await Promise.resolve();
            expect(screen.queryByTestId('kept-work')).toBeNull();
            cleanup();
        }
        expect(fetchKeptWork).not.toHaveBeenCalled();
    });

    it('nothing kept draws nothing; a list that cannot be read says so with a retry', async () => {
        render(inContext(farm({ farmId: 'f1' }), <KeptWorkAttention />));
        await waitFor(() => expect(fetchKeptWork).toHaveBeenCalled());
        expect(screen.queryByTestId('kept-work')).toBeNull();
        cleanup();

        fetchKeptWork.mockReset();
        fetchKeptWork.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(KEPT);
        render(inContext(farm({ farmId: 'f1' }), <KeptWorkAttention />));
        expect(await screen.findByTestId('kept-work-failed')).toHaveTextContent('ठेवलेलं काम आत्ता आणता आलं नाही.');
        fireEvent.click(screen.getByTestId('kept-work-retry'));
        expect(await screen.findByTestId('kept-work')).toBeInTheDocument();
    });

    it('English mode is English only', async () => {
        h.lang = 'en';
        fetchKeptWork.mockResolvedValue(KEPT);
        render(inContext(farm({ farmId: 'f1' }), <KeptWorkAttention />));
        const card = await screen.findByTestId('kept-work');
        const text = (card.textContent ?? '').replace(/गोपाळ/g, '');
        expect(text).toContain('Work kept for you (3)');
        expect(text).toContain('A cost entry');
        expect(text).not.toMatch(DEVANAGARI);
    });

    // Fix round 1 (review LOW-3, P4): one list cannot say "nothing here is lost" and, on its cap row, "was not kept".
    it('the intro line promises neither that nothing was lost nor that everything was kept - it agrees with the cap row', () => {
        for (const language of ['mr', 'en'] as const) {
            const copy = relationshipCopy(language);
            const intro = copy.kept.intro;
            expect(intro.length).toBeGreaterThan(10);
            expect(intro).not.toMatch(/गमावल|जपून|ठेवलं|lost|kept/i);
            expect(copy.kept.capReached).toMatch(language === 'mr' ? /ठेवलं गेलं नाही/ : /not kept/);
            expect(DEVANAGARI.test(intro)).toBe(language === 'mr');
        }
    });

    it('an unknown code is worded as ShramSafal\'s rule, never a raw code', () => {
        const copy = relationshipCopy('mr');
        const words = keptItemWords({ ...KEPT[0]!, kind: 'refused', what: 'some_new_mutation', why: 'Some.New.Code' } as never, copy, 'mr');
        expect(words.what).toBe('काम');
        expect(words.why).toContain('श्रमसफलच्या नियमानुसार');
        expect(words.why).not.toContain('Some.New.Code');
    });
});
