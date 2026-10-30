// @vitest-environment jsdom
/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 2, AC2) — the PRIMARY owner answers a typed-code
 * request and manages a person on the "माझी टीम" screen, over the REAL roster hook. Checks CONTENT:
 * the words the owner reads (the phone tail, how a person came in, the honest all-records line), the
 * exact server call each tap makes, that the screen adopts the row the SERVER returned (never its
 * own guess), and that no control is drawn on the registrant, on yourself, or for a co-owner caller
 * (founder D-22, 26 Oct: only the primary owner decides; no कुटुंब choice, no permission switch).
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { LabourPermission } from '../../data/labourPermissionsClient';

const fetchLabourPermissions = vi.fn();
const setLabourPermission = vi.fn();
vi.mock('../../data/labourPermissionsClient', async (importActual) => ({
    ...(await importActual<typeof import('../../data/labourPermissionsClient')>()),
    fetchLabourPermissions: (...a: unknown[]) => fetchLabourPermissions(...a),
    setLabourPermission: (...a: unknown[]) => setLabourPermission(...a),
}));

const approveMember = vi.fn();
const declineMember = vi.fn();
const suspendMember = vi.fn();
const restoreMember = vi.fn();
const removeMember = vi.fn();
const setMemberAccess = vi.fn();
vi.mock('../../data/membershipAdminClient', async (importActual) => ({
    ...(await importActual<typeof import('../../data/membershipAdminClient')>()),
    approveMember: (...a: unknown[]) => approveMember(...a),
    declineMember: (...a: unknown[]) => declineMember(...a),
    suspendMember: (...a: unknown[]) => suspendMember(...a),
    restoreMember: (...a: unknown[]) => restoreMember(...a),
    removeMember: (...a: unknown[]) => removeMember(...a),
    setMemberAccess: (...a: unknown[]) => setMemberAccess(...a),
}));

vi.mock('../../../labour/data/fieldOperatorClient', () => ({
    fetchFieldOperators: vi.fn().mockResolvedValue([]),
    createFieldOperator: vi.fn(),
    deactivateFieldOperator: vi.fn(),
}));
vi.mock('../../../labour/data/fieldOperatorRosterCache', () => ({ readCachedRoster: () => null, writeCachedRoster: vi.fn() }));

import { TeamPage } from '../TeamPage';
import { useLabourPermissions } from '../../hooks/useLabourPermissions';

const row = (over: Partial<LabourPermission>): LabourPermission => ({
    userId: 'u', role: 'Worker', status: 'Active', canManageLabourRecords: false, hasExplicitGrant: false,
    source: 'NotGranted', isGrantEditable: true, labourGrantExpiresAtUtc: null, permissions: [], ...over,
});

const OWNER = row({ userId: 'me', role: 'PrimaryOwner', displayName: 'Purvesh', isRegistrant: true, canManageLabourRecords: true, isGrantEditable: false, source: 'OwnerTier' });
const REQUEST = row({ userId: 'sunil', status: 'PendingApproval', displayName: 'सुनील', joinedVia: 'SelfJoin', requestedAtUtc: '2026-10-26T08:00:00Z', phoneLast4: '4321' });
const RAMESH = row({ userId: 'ramesh', role: 'Worker', displayName: 'रमेश', joinedVia: 'QrScan', phoneLast4: '7788' });

const Harness: React.FC<{ role?: string; userId?: string }> = ({ role = 'PrimaryOwner', userId = 'me' }) => {
    // As ProfilePage does: the owner-only roster is asked only for an owner-tier caller.
    const roster = useLabourPermissions(role === 'PrimaryOwner' || role === 'SecondaryOwner' ? 'farm-1' : null);
    return <TeamPage farmId="farm-1" farmCode="K7M2QP" callerRole={role} callerUserId={userId} roster={roster} onShowQr={vi.fn()} />;
};

beforeEach(() => {
    for (const fn of [fetchLabourPermissions, setLabourPermission, approveMember, declineMember, suspendMember, restoreMember, removeMember, setMemberAccess]) fn.mockReset();
    fetchLabourPermissions.mockResolvedValue([OWNER, REQUEST, RAMESH]);
});
afterEach(cleanup);

describe('the farm code', () => {
    it('shows the real permanent code big, with the farm QR door', async () => {
        render(<Harness />);
        expect(screen.getByTestId('farm-code').textContent).toBe('K7M2QP');
        expect(screen.getByText('हा कोड कायम राहतो. QR बदलला तरी कोड तोच.')).toBeTruthy();
        expect(screen.getByTestId('team-show-qr').textContent).toContain('शेताचा QR दाखवा');
        await screen.findByText('सुनील आत येऊ इच्छितात');
    });
});

describe('a waiting request', () => {
    it('reads "X आत येऊ इच्छितात" with his phone tail, how he asked, and the TWO choices (no कुटुंब)', async () => {
        render(<Harness />);
        expect(await screen.findByText('सुनील आत येऊ इच्छितात')).toBeTruthy();
        expect(screen.getByText('1 व्यक्ती आत येऊ इच्छिते')).toBeTruthy();
        const card = screen.getByTestId('join-request-sunil');
        expect(within(card).getByTestId('join-request-phone-sunil').textContent).toBe('मोबाईल …4321');
        expect(within(card).getByText('शेताचा कोड टाकून विचारलं')).toBeTruthy();
        for (const word of ['काम सांगणे', 'काम + हजेरी', 'नको']) expect(within(card).getByText(word)).toBeTruthy();
        expect(card.textContent).not.toMatch(/कुटुंब|सहमालक|मालकासारखं|खर्च नोंदवू शकतो/);
        expect(within(card).queryByTestId('approve-family-sunil')).toBeNull();
        expect(within(card).queryByRole('switch')).toBeNull();
        // The request is not listed as a person yet.
        expect(screen.queryByTestId('team-person-sunil')).toBeNull();
    });

    it('a request with no phone from the server shows no phone line (never an invented number)', async () => {
        fetchLabourPermissions.mockResolvedValue([OWNER, { ...REQUEST, phoneLast4: null }]);
        render(<Harness />);
        await screen.findByText('सुनील आत येऊ इच्छितात');
        expect(screen.queryByTestId('join-request-phone-sunil')).toBeNull();
    });

    it('काम सांगणे approves as Worker in ONE tap and the screen adopts the SERVER row', async () => {
        approveMember.mockResolvedValue(row({ userId: 'sunil', role: 'Worker', displayName: 'सुनील', joinedVia: 'SelfJoin', approvedByOwner: true, phoneLast4: '4321' }));
        render(<Harness />);
        fireEvent.click(await screen.findByTestId('approve-work-sunil'));
        await waitFor(() => expect(approveMember).toHaveBeenCalledWith('farm-1', 'sunil', { role: 'Worker', grantLabour: false }));
        const card = await screen.findByTestId('team-person-sunil');
        expect(within(card).getByText('कामगार')).toBeTruthy();
        expect(within(card).getByTestId('team-person-line').textContent).toBe('काम सांगणे · खर्च नोंदवणे');
        expect(within(card).getByTestId('team-person-phone').textContent).toBe('मोबाईल …4321');
        expect(within(card).getByTestId('team-person-arrival').textContent).toBe('कोड टाकून विचारलं · मालकाने मंजूर केलं');
        expect(screen.queryByTestId('join-request-sunil')).toBeNull();
    });

    it('काम + हजेरी approves as Mukadam with the हजेरी व पक्कं grant', async () => {
        approveMember.mockResolvedValue(row({ userId: 'sunil', role: 'Mukadam', displayName: 'सुनील', canManageLabourRecords: true }));
        render(<Harness />);
        fireEvent.click(await screen.findByTestId('approve-crew-sunil'));
        await waitFor(() => expect(approveMember).toHaveBeenCalledWith('farm-1', 'sunil', { role: 'Mukadam', grantLabour: true }));
        const card = await screen.findByTestId('team-person-sunil');
        expect(within(card).getByTestId('team-person-line').textContent).toBe('काम सांगणे · खर्च नोंदवणे · हजेरी · पक्कं करणे');
    });

    it('नको asks first, sends the owner\'s reason, and the request leaves only after the server answered', async () => {
        let answer!: (v: LabourPermission) => void;
        declineMember.mockImplementation(() => new Promise(r => { answer = r; }));
        render(<Harness />);
        fireEvent.click(await screen.findByTestId('decline-sunil'));
        expect(screen.getByText('ही विनंती नाकारायची?')).toBeTruthy();
        fireEvent.change(screen.getByTestId('decline-step-sunil-reason'), { target: { value: 'ओळखत नाही' } });
        fireEvent.click(screen.getByTestId('decline-step-sunil-confirm'));
        await waitFor(() => expect(declineMember).toHaveBeenCalledWith('farm-1', 'sunil', 'ओळखत नाही'));
        expect(screen.getByTestId('join-request-sunil')).toBeTruthy(); // not yet answered
        answer(row({ userId: 'sunil', status: 'Revoked', displayName: 'सुनील' }));
        await waitFor(() => expect(screen.queryByTestId('join-request-sunil')).toBeNull());
        expect(screen.queryByTestId('team-person-sunil')).toBeNull();
    });

    it('a co-owner answers no request and decides about nobody (only the primary owner does — D-22)', async () => {
        const anita = row({ userId: 'fam', role: 'SecondaryOwner', displayName: 'अनिता', canManageLabourRecords: true, isGrantEditable: false, source: 'OwnerTier' });
        fetchLabourPermissions.mockResolvedValue([OWNER, anita, REQUEST, RAMESH]);
        render(<Harness role="SecondaryOwner" userId="fam" />);
        // The roster is real for him (the server lets the owner tier read it)...
        expect(await screen.findByTestId('team-person-ramesh')).toBeTruthy();
        // ...but no request to answer, no approve, no नको.
        expect(screen.queryByTestId('team-requests')).toBeNull();
        expect(screen.queryByTestId('approve-work-sunil')).toBeNull();
        expect(screen.queryByTestId('decline-sunil')).toBeNull();
        // RE-PINNED (spec plr-d10 I27, founder D-44 §2: the PRIMARY owner chooses who confirms): he used to be
        // able to move a worker's हजेरी व पक्कं switch. The server now refuses him, so no switch, no choice, no
        // pause, no removal — nothing to open on anyone's card.
        expect(screen.queryByTestId('team-change-ramesh')).toBeNull();
        expect(screen.queryByTestId('labour-access-ramesh')).toBeNull();
        expect(screen.queryByTestId('team-preset-work-ramesh')).toBeNull();
        expect(screen.queryByTestId('team-pause-ramesh')).toBeNull();
        expect(approveMember).not.toHaveBeenCalled();
        expect(setLabourPermission).not.toHaveBeenCalled();
    });
});

describe('a co-owner\'s responsibility to confirm records (PLR-D10 I27, founder D-44 §2)', () => {
    const ANITA = row({
        userId: 'anita', role: 'SecondaryOwner', displayName: 'अनिता', canManageLabourRecords: true, isGrantEditable: false,
        source: 'OwnerTier', canConfirmRecords: false, isConfirmGrantEditable: true,
    });

    it('the primary owner gives it with the confirming switch, and the card shows the server\'s answer', async () => {
        fetchLabourPermissions.mockResolvedValue([OWNER, ANITA]);
        setLabourPermission.mockResolvedValue({ ...ANITA, hasExplicitGrant: true, canConfirmRecords: true });
        render(<Harness />);
        fireEvent.click(await screen.findByTestId('team-change-anita'));
        // His labour line stays "permanently on" (no labour switch is drawn for him); the new switch is about confirming.
        expect(screen.queryByTestId('labour-access-anita')).toBeNull();
        const toggle = screen.getByTestId('confirm-access-anita');
        expect(toggle.textContent).toContain('नोंदी पक्क्या करण्याची जबाबदारी द्या');
        expect(screen.getByTestId('confirm-access-hint-anita').textContent).toBe('तुम्ही दिलीत तरच हे सहमालक नोंदी पक्क्या करू शकतात.');
        fireEvent.click(toggle);
        await waitFor(() => expect(setLabourPermission).toHaveBeenCalledWith('farm-1', 'anita', true, null));
        await waitFor(() => expect(screen.getByTestId('confirm-access-anita').getAttribute('data-on')).toBe('yes'));
        expect(screen.getByTestId('confirm-access-anita').textContent).toContain('नोंदी पक्क्या करण्याची जबाबदारी आहे');
    });

    it('taking it back sends the desired state OFF', async () => {
        const granted = { ...ANITA, hasExplicitGrant: true, canConfirmRecords: true };
        fetchLabourPermissions.mockResolvedValue([OWNER, granted]);
        setLabourPermission.mockResolvedValue(ANITA);
        render(<Harness />);
        fireEvent.click(await screen.findByTestId('team-change-anita'));
        fireEvent.click(screen.getByTestId('confirm-access-anita'));
        await waitFor(() => expect(setLabourPermission).toHaveBeenCalledWith('farm-1', 'anita', false, null));
        await waitFor(() => expect(screen.getByTestId('confirm-access-anita').getAttribute('data-on')).toBe('no'));
    });

    it('no confirming switch when the server does not offer it (an older server, or a co-owner looking)', async () => {
        fetchLabourPermissions.mockResolvedValue([OWNER, { ...ANITA, isConfirmGrantEditable: undefined }]);
        render(<Harness />);
        fireEvent.click(await screen.findByTestId('team-change-anita'));
        expect(screen.queryByTestId('confirm-access-anita')).toBeNull();
        cleanup();
        fetchLabourPermissions.mockResolvedValue([OWNER, ANITA, RAMESH]);
        render(<Harness role="SecondaryOwner" userId="other" />);
        await screen.findByTestId('team-person-anita');
        expect(screen.queryByTestId('team-change-anita')).toBeNull();
        expect(screen.queryByTestId('confirm-access-anita')).toBeNull();
    });
});

describe('a person let in', () => {
    it('pause asks for a reason (said to be shown to him), and the paused card says why and offers restore', async () => {
        suspendMember.mockResolvedValue({ ...RAMESH, status: 'Suspended', permissions: [], statusReason: 'दारू पिऊन आला' });
        restoreMember.mockResolvedValue({ ...RAMESH, status: 'Active' });
        render(<Harness />);
        fireEvent.click(await screen.findByTestId('team-change-ramesh'));
        fireEvent.click(screen.getByText('आणखी'));
        fireEvent.click(screen.getByTestId('team-pause-ramesh'));
        expect(screen.getByText('हे कारण त्या व्यक्तीला दिसेल.')).toBeTruthy();
        fireEvent.change(screen.getByTestId('pause-step-ramesh-reason'), { target: { value: 'दारू पिऊन आला' } });
        fireEvent.click(screen.getByTestId('pause-step-ramesh-confirm'));
        await waitFor(() => expect(suspendMember).toHaveBeenCalledWith('farm-1', 'ramesh', 'दारू पिऊन आला'));
        const paused = await screen.findByTestId('team-person-paused');
        expect(paused.textContent).toContain('काम थांबवलं आहे. जुनी माहिती तशीच आहे.');
        expect(paused.textContent).toContain('कारण: दारू पिऊन आला');
        fireEvent.click(screen.getByTestId('team-restore-ramesh'));
        await waitFor(() => expect(restoreMember).toHaveBeenCalledWith('farm-1', 'ramesh'));
        await waitFor(() => expect(screen.getByTestId('team-person-ramesh').getAttribute('data-status')).toBe('Active'));
    });

    it('remove asks first, then the person leaves the list', async () => {
        removeMember.mockResolvedValue({ ...RAMESH, status: 'Revoked' });
        render(<Harness />);
        fireEvent.click(await screen.findByTestId('team-change-ramesh'));
        fireEvent.click(screen.getByText('आणखी'));
        fireEvent.click(screen.getByTestId('team-remove-ramesh'));
        expect(screen.getByText('खरंच शेतातून काढायचं? जुनी माहिती तशीच राहील.')).toBeTruthy();
        expect(removeMember).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('remove-step-ramesh-confirm'));
        await waitFor(() => expect(removeMember).toHaveBeenCalledWith('farm-1', 'ramesh', ''));
        await waitFor(() => expect(screen.queryByTestId('team-person-ramesh')).toBeNull());
    });

    it('moving a worker to काम + हजेरी changes the role AND switches the हजेरी व पक्कं grant on, in ONE request', async () => {
        setMemberAccess.mockResolvedValue({ ...RAMESH, role: 'Mukadam', canManageLabourRecords: true, hasExplicitGrant: true, source: 'ExplicitGrant' });
        render(<Harness />);
        fireEvent.click(await screen.findByTestId('team-change-ramesh'));
        fireEvent.click(screen.getByTestId('team-preset-crew-ramesh'));
        await waitFor(() => expect(setMemberAccess).toHaveBeenCalledWith('farm-1', 'ramesh',
            { role: 'Mukadam', resetPermissions: true, labourGrant: true }));
        expect(setMemberAccess).toHaveBeenCalledTimes(1);
        expect(setLabourPermission).not.toHaveBeenCalled();
        await waitFor(() => expect(within(screen.getByTestId('team-person-ramesh')).getByTestId('team-person-line').textContent)
            .toBe('काम सांगणे · खर्च नोंदवणे · हजेरी · पक्कं करणे'));
    });

    it('moving an existing co-owner or a मुकादम (with हजेरी) to काम सांगणे asks the server for a PLAIN worker: no stored powers, no grant', async () => {
        const anita = row({ userId: 'anita', role: 'SecondaryOwner', displayName: 'अनिता', canManageLabourRecords: true, isGrantEditable: false, source: 'OwnerTier' });
        const crew = row({ userId: 'crew', role: 'Mukadam', displayName: 'गणेश', canManageLabourRecords: true, hasExplicitGrant: true, source: 'ExplicitGrant' });
        fetchLabourPermissions.mockResolvedValue([OWNER, anita, crew]);
        setMemberAccess.mockImplementation(async (_farm: string, userId: string) =>
            row({ userId, role: 'Worker', displayName: userId === 'anita' ? 'अनिता' : 'गणेश', permissions: [] }));
        render(<Harness />);

        fireEvent.click(await screen.findByTestId('team-change-anita'));
        // A co-owner seat sits on neither choice: both are offered, nothing is pre-selected.
        expect(screen.getByTestId('team-preset-work-anita').getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByTestId('team-preset-crew-anita').getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(screen.getByTestId('team-preset-work-anita'));
        await waitFor(() => expect(setMemberAccess).toHaveBeenCalledWith('farm-1', 'anita',
            { role: 'Worker', resetPermissions: true, labourGrant: false }));
        await waitFor(() => expect(within(screen.getByTestId('team-person-anita')).getByTestId('team-person-line').textContent)
            .toBe('काम सांगणे · खर्च नोंदवणे'));

        fireEvent.click(screen.getByTestId('team-change-crew'));
        fireEvent.click(screen.getByTestId('team-preset-work-crew'));
        await waitFor(() => expect(setMemberAccess).toHaveBeenCalledWith('farm-1', 'crew',
            { role: 'Worker', resetPermissions: true, labourGrant: false }));
        await waitFor(() => expect(within(screen.getByTestId('team-person-crew')).getByTestId('team-person-line').textContent)
            .toBe('काम सांगणे · खर्च नोंदवणे'));
    });

    it('no permission switch is drawn on anyone — money and planning switches wait for their step (P5)', async () => {
        const crew = row({ userId: 'crew', role: 'Mukadam', displayName: 'गणेश', permissions: ['PlanWork'] });
        const paused = row({ userId: 'paused', role: 'Mukadam', status: 'Suspended', displayName: 'शंकर', permissions: [] });
        const p2 = row({ userId: 'p2', role: 'PrimaryOwner', displayName: 'Akash', isGrantEditable: false, permissions: ['AddCost', 'PlanWork'] });
        fetchLabourPermissions.mockResolvedValue([OWNER, crew, paused, p2]);
        render(<Harness />);
        fireEvent.click(await screen.findByTestId('team-change-crew'));
        fireEvent.click(screen.getByTestId('team-change-paused'));
        fireEvent.click(screen.getByTestId('team-change-p2'));
        expect(screen.queryByTestId(/^team-perm-/)).toBeNull();
        expect(document.body.textContent).not.toMatch(/खर्च नोंदवू शकतो|कामं ठरवू शकतो|काम ठरवणे/);
    });

    it('a person card shows his phone tail, how he came in, and the honest all-records line', async () => {
        render(<Harness />);
        const card = await screen.findByTestId('team-person-ramesh');
        expect(within(card).getByTestId('team-person-phone').textContent).toBe('मोबाईल …7788');
        expect(within(card).getByTestId('team-person-arrival').textContent).toBe('QR ने थेट आले');
        expect(screen.getByTestId('team-all-records-note').textContent)
            .toBe('सध्या शेतातल्या प्रत्येकाच्या फोनवर सर्व नोंदी, पैसेसुद्धा, जातात — पुढच्या टप्प्यात हे बंद होईल.');
    });

    it('a reason longer than the server keeps is never cut: the owner is told and the confirm waits', async () => {
        render(<Harness />);
        fireEvent.click(await screen.findByTestId('team-change-ramesh'));
        fireEvent.click(screen.getByText('आणखी'));
        fireEvent.click(screen.getByTestId('team-pause-ramesh'));
        const long = 'क'.repeat(501);
        fireEvent.change(screen.getByTestId('pause-step-ramesh-reason'), { target: { value: long } });
        expect((screen.getByTestId('pause-step-ramesh-reason') as HTMLInputElement).value).toBe(long);
        expect(screen.getByTestId('pause-step-ramesh-reason-error').textContent).toBe('कारण 500 अक्षरांपेक्षा मोठं आहे — थोडं कमी करा.');
        fireEvent.click(screen.getByTestId('pause-step-ramesh-confirm'));
        expect(suspendMember).not.toHaveBeenCalled();
    });

    it('the registrant and yourself get NO change / pause / remove control', async () => {
        fetchLabourPermissions.mockResolvedValue([OWNER, RAMESH]);
        render(<Harness />);
        const me = await screen.findByTestId('team-person-me');
        expect(within(me).getByText('शेत यांच्या नावावर आहे')).toBeTruthy();
        expect(within(me).queryByTestId('team-change-me')).toBeNull();
        expect(screen.queryByTestId('team-pause-me')).toBeNull();
        expect(screen.queryByTestId('team-remove-me')).toBeNull();
    });

    it('a primary-owner seat the roster marks as NOT the registrant gets no request to answer and no choice / pause / removal (SEC-MU2-6)', async () => {
        const meNotRegistrant = { ...OWNER, isRegistrant: false };
        const registrant = row({ userId: 'reg', role: 'PrimaryOwner', displayName: 'Purvesh', isRegistrant: true, isGrantEditable: false, source: 'OwnerTier' });
        fetchLabourPermissions.mockResolvedValue([registrant, meNotRegistrant, REQUEST, RAMESH]);
        render(<Harness />);
        fireEvent.click(await screen.findByTestId('team-change-ramesh'));
        expect(screen.queryByTestId('team-requests')).toBeNull();
        expect(screen.queryByTestId('approve-work-sunil')).toBeNull();
        expect(screen.queryByTestId('team-preset-work-ramesh')).toBeNull();
        expect(screen.queryByTestId('team-more-ramesh')).toBeNull();
        // Only the हजेरी व पक्कं switch stays: its route is still owner tier on the server (step 2b, SEC-MU2-3).
        expect(within(screen.getByTestId('team-change-panel-ramesh')).getByTestId('labour-access-ramesh')).toBeTruthy();
    });

    it('an unclaimed invitation (PendingOtpClaim) gets no request card — the server could not approve it (SEC-MU2-4)', async () => {
        fetchLabourPermissions.mockResolvedValue([OWNER, { ...REQUEST, status: 'PendingOtpClaim' }, RAMESH]);
        render(<Harness />);
        await screen.findByTestId('team-person-ramesh');
        expect(screen.queryByTestId('join-request-sunil')).toBeNull();
        expect(screen.queryByTestId('approve-work-sunil')).toBeNull();
        expect(screen.queryByTestId('team-person-sunil')).toBeNull();
    });

    it('a refusal is said plainly (last owner), nothing moves, and the roster is read again', async () => {
        fetchLabourPermissions.mockResolvedValue([OWNER, row({ userId: 'p2', role: 'PrimaryOwner', displayName: 'Akash' })]);
        removeMember.mockRejectedValue({ response: { status: 409, data: { error: 'membership.last_owner' } } });
        render(<Harness />);
        fireEvent.click(await screen.findByTestId('team-change-p2'));
        fireEvent.click(screen.getByText('आणखी'));
        fireEvent.click(screen.getByTestId('team-remove-p2'));
        fireEvent.click(screen.getByTestId('remove-step-p2-confirm'));
        expect(await screen.findByText('शेतात एक तरी मालक राहिला पाहिजे — हे करता येत नाही.')).toBeTruthy();
        expect(screen.getByTestId('team-person-p2')).toBeTruthy();
        expect(fetchLabourPermissions).toHaveBeenCalledTimes(2);
    });
});

describe('not the owner tier', () => {
    it('a mukadam sees the farm code but no roster, no requests and no QR door; the roster is never asked', async () => {
        render(<Harness role="Mukadam" userId="m1" />);
        expect(screen.getByTestId('farm-code').textContent).toBe('K7M2QP');
        expect(screen.queryByTestId('team-show-qr')).toBeNull();
        expect(screen.queryByTestId('team-requests')).toBeNull();
        expect(screen.queryByTestId('team-people')).toBeNull();
        await new Promise(r => setTimeout(r, 20));
        expect(fetchLabourPermissions).not.toHaveBeenCalled();
    });
});

describe('a मुकादम looks at his crew (view only)', () => {
    it('lists the people this phone knows with their role, never himself or a phone-only entry, and says only the owner adds', () => {
        const roster = {
            rows: null, loading: false, loadFailed: false, savingUserId: null, error: null,
            reload: vi.fn(async () => undefined), setPermission: vi.fn(async () => undefined), dismissError: vi.fn(), adoptRow: vi.fn(),
        };
        render(
            <TeamPage farmId="farm-1" farmCode="K7M2QP" callerRole="Mukadam" callerUserId="m1" roster={roster}
                operators={[
                    { id: 'm1', name: 'मी', role: 'MUKADAM' },
                    { id: 'w1', name: 'रमेश', role: 'WORKER' },
                    { id: 'o1', name: 'Purvesh', role: 'PRIMARY_OWNER' },
                    { id: 'op_9', name: 'Phantom', role: 'WORKER', localOnly: true },
                ] as never} />,
        );
        const list = screen.getByTestId('team-view-only');
        expect(within(list).getByText('रमेश')).toBeTruthy();
        expect(within(list).getByText('कामगार')).toBeTruthy();
        expect(within(list).getByText('Purvesh')).toBeTruthy();
        expect(within(list).getByText('मालक')).toBeTruthy();
        expect(within(list).queryByText('मी')).toBeNull();
        expect(within(list).queryByText('Phantom')).toBeNull();
        expect(within(list).getByText('नवीन व्यक्ती फक्त मालक जोडू शकतो.')).toBeTruthy();
        expect(screen.queryByTestId(/^team-change-/)).toBeNull();
    });
});
