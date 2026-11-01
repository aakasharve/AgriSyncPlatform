// @vitest-environment jsdom
/**
 * lane 2b (MU farm-relationships design §2, §6, §11.1) — the primary owner's responsibility
 * switches on a team card: they render in BOTH languages, save the WHOLE desired set through the
 * one owner route, adopt the server's row, and a refusal is said on screen (never a switch that
 * silently springs back). No switch for see money / see wages / plan / assign (P5).
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { LabourPermission } from '../../data/labourPermissionsClient';

const fetchLabourPermissions = vi.fn();
vi.mock('../../data/labourPermissionsClient', async (importActual) => ({
    ...(await importActual<typeof import('../../data/labourPermissionsClient')>()),
    fetchLabourPermissions: (...a: unknown[]) => fetchLabourPermissions(...a),
}));

const setMemberAuthorities = vi.fn();
vi.mock('../../data/membershipAdminClient', async (importActual) => ({
    ...(await importActual<typeof import('../../data/membershipAdminClient')>()),
    setMemberAuthorities: (...a: unknown[]) => setMemberAuthorities(...a),
}));

vi.mock('../../../labour/data/fieldOperatorClient', () => ({
    fetchFieldOperators: vi.fn().mockResolvedValue([]),
    createFieldOperator: vi.fn(),
    deactivateFieldOperator: vi.fn(),
}));
vi.mock('../../../labour/data/fieldOperatorRosterCache', () => ({ readCachedRoster: () => null, writeCachedRoster: vi.fn() }));

let language = 'mr';
vi.mock('../../../../i18n/LanguageContext', async (importActual) => ({
    ...(await importActual<typeof import('../../../../i18n/LanguageContext')>()),
    useOptionalLanguage: () => ({ language }),
}));

import { TeamPage } from '../TeamPage';
import { useLabourPermissions } from '../../hooks/useLabourPermissions';

const row = (over: Partial<LabourPermission>): LabourPermission => ({
    userId: 'u', role: 'Worker', status: 'Active', canManageLabourRecords: false, hasExplicitGrant: false,
    source: 'NotGranted', isGrantEditable: true, labourGrantExpiresAtUtc: null, permissions: [], ...over,
});

const OWNER = row({ userId: 'me', role: 'PrimaryOwner', displayName: 'Purvesh', isRegistrant: true, isGrantEditable: false, source: 'OwnerTier' });
const FAMILY = row({
    userId: 'fam', role: 'SecondaryOwner', displayName: 'सुनीता', canEditAuthorities: true,
    authorities: [{ name: 'TakeAttendance', expiresAtUtc: null }, { name: 'PlanWork', expiresAtUtc: null }],
});

const Harness: React.FC<{ role?: string }> = ({ role = 'PrimaryOwner' }) => {
    const roster = useLabourPermissions('farm-1');
    return <TeamPage farmId="farm-1" farmCode="K7M2QP" callerRole={role} callerUserId="me" roster={roster} onShowQr={vi.fn()} />;
};

async function openCard(userId: string) {
    fireEvent.click(await screen.findByTestId(`team-change-${userId}`));
    return screen.getByTestId(`authority-switches-${userId}`);
}

beforeEach(() => {
    language = 'mr';
    fetchLabourPermissions.mockReset();
    setMemberAuthorities.mockReset();
    fetchLabourPermissions.mockResolvedValue([OWNER, FAMILY]);
});
afterEach(cleanup);

describe('the primary owner\'s responsibility switches', () => {
    it('render one switch per ENFORCED responsibility, from the server\'s list, in Marathi', async () => {
        render(<Harness />);
        const block = await openCard('fam');
        // lane MU-3 — see money / see wages are enforced on every download and money read now: real switches.
        for (const name of ['TakeAttendance', 'ConfirmRecords', 'SeeMoney', 'SeeWages', 'ReviewMoney', 'EditFarmSetup', 'LabRecords', 'ScheduleTemplates']) {
            expect(within(block).getByTestId(`authority-${name}-fam`)).toBeTruthy();
        }
        for (const name of ['PlanWork', 'AssignWork']) {
            expect(within(block).queryByTestId(`authority-${name}-fam`)).toBeNull();
        }
        expect(within(block).getByTestId('authority-TakeAttendance-fam').getAttribute('data-on')).toBe('yes');
        expect(within(block).getByTestId('authority-ConfirmRecords-fam').getAttribute('data-on')).toBe('no');
        expect(within(block).getByText('हजेरी घेणे')).toBeTruthy();
        expect(within(block).getByText('जबाबदाऱ्या')).toBeTruthy();
        expect(block.textContent).not.toMatch(/permission|grant|role|policy|claim|access/i);
        // The older two switches are not drawn beside them.
        expect(screen.queryByTestId('labour-access-fam')).toBeNull();
        expect(screen.queryByTestId('confirm-access-fam')).toBeNull();
    });

    it('ONE control per power: the old काम सांगणे / काम + हजेरी chooser is not drawn beside the switches (fix 1)', async () => {
        render(<Harness />);
        await openCard('fam');
        expect(screen.queryByTestId('team-preset-work-fam')).toBeNull();
        expect(screen.queryByTestId('team-preset-crew-fam')).toBeNull();
    });

    it('the farm-setup switch names only what the server checks: plot and boundary (fix 1)', async () => {
        render(<Harness />);
        const block = await openCard('fam');
        expect(within(block).getByText('शेताची रचना बदलणे (प्लॉट, हद्द)')).toBeTruthy();
        expect(block.textContent).not.toMatch(/मोटर|पाणी/);
    });

    it('render in English in English mode, and only English', async () => {
        language = 'en';
        render(<Harness />);
        const block = await openCard('fam');
        expect(within(block).getByText('Responsibilities')).toBeTruthy();
        expect(within(block).getByText('Take attendance')).toBeTruthy();
        expect(within(block).getByText('Confirm records (approve / query)')).toBeTruthy();
        expect(within(block).getByText('Change farm setup (plots, boundary)')).toBeTruthy();
        expect(block.textContent).not.toMatch(/[ऀ-ॿ]/);
    });

    it('save the WHOLE set (the switch moves, the rest travels as the server sent it) and adopt the server row', async () => {
        setMemberAuthorities.mockResolvedValue({
            ...FAMILY,
            authorities: [...FAMILY.authorities!, { name: 'ConfirmRecords', expiresAtUtc: null }],
        });
        render(<Harness />);
        const block = await openCard('fam');
        fireEvent.click(within(block).getByTestId('authority-ConfirmRecords-fam'));
        fireEvent.click(within(block).getByTestId('authority-ConfirmRecords-permanent-fam'));
        await waitFor(() => expect(setMemberAuthorities).toHaveBeenCalledWith('farm-1', 'fam', [
            { name: 'TakeAttendance', expiresAtUtc: null },
            { name: 'PlanWork', expiresAtUtc: null },
            { name: 'ConfirmRecords', expiresAtUtc: null },
        ]));
        await waitFor(() => expect(screen.getByTestId('authority-ConfirmRecords-fam').getAttribute('data-on')).toBe('yes'));
    });

    it('reviewing money brings seeing money along with the same end; a date runs THROUGH that day', async () => {
        setMemberAuthorities.mockResolvedValue(FAMILY);
        render(<Harness />);
        const block = await openCard('fam');
        fireEvent.click(within(block).getByTestId('authority-ReviewMoney-fam'));
        fireEvent.change(within(block).getByTestId('authority-ReviewMoney-date-fam'), { target: { value: '2026-11-04' } });
        await waitFor(() => expect(setMemberAuthorities).toHaveBeenCalled());
        const sent = setMemberAuthorities.mock.calls[0][2] as { name: string; expiresAtUtc: string | null }[];
        const review = sent.find(a => a.name === 'ReviewMoney')!;
        const money = sent.find(a => a.name === 'SeeMoney')!;
        expect(review.expiresAtUtc).toBe(new Date(2026, 10, 5).toISOString());
        expect(money.expiresAtUtc).toBe(review.expiresAtUtc);
    });

    it('lane MU-3 — turning see money OFF takes see wages and review money with it (they mean nothing without it)', async () => {
        fetchLabourPermissions.mockResolvedValue([OWNER, {
            ...FAMILY,
            authorities: [
                { name: 'SeeMoney', expiresAtUtc: null },
                { name: 'SeeWages', expiresAtUtc: null },
                { name: 'ReviewMoney', expiresAtUtc: null },
                { name: 'TakeAttendance', expiresAtUtc: null },
            ],
        }]);
        setMemberAuthorities.mockResolvedValue(FAMILY);
        render(<Harness />);
        const block = await openCard('fam');
        expect(within(block).getByText('शेताचा पैशांचा हिशोब पाहणे')).toBeTruthy();
        fireEvent.click(within(block).getByTestId('authority-SeeMoney-fam'));
        await waitFor(() => expect(setMemberAuthorities).toHaveBeenCalledWith('farm-1', 'fam', [
            { name: 'TakeAttendance', expiresAtUtc: null },
        ]));
    });

    it('turning one OFF sends the set without it', async () => {
        setMemberAuthorities.mockResolvedValue(FAMILY);
        render(<Harness />);
        const block = await openCard('fam');
        fireEvent.click(within(block).getByTestId('authority-TakeAttendance-fam'));
        await waitFor(() => expect(setMemberAuthorities).toHaveBeenCalledWith('farm-1', 'fam', [
            { name: 'PlanWork', expiresAtUtc: null },
        ]));
    });

    it('a refusal is SAID on the screen and the switches go back to the server\'s truth', async () => {
        setMemberAuthorities.mockRejectedValue(Object.assign(new Error('403'), { response: { status: 403 } }));
        render(<Harness />);
        const block = await openCard('fam');
        fireEvent.click(within(block).getByTestId('authority-TakeAttendance-fam'));
        expect(await screen.findByTestId('team-error')).toBeTruthy();
        expect(screen.getByTestId('team-error').textContent).toContain('हा बदल करता आला नाही');
        await waitFor(() => expect(fetchLabourPermissions).toHaveBeenCalledTimes(2));
    });

    it('a co-owner is shown no roster, no switch and no farm QR (people and permissions are the primary owner\'s — D-26)', async () => {
        render(<Harness role="SecondaryOwner" />);
        expect(await screen.findByTestId('team-view-only')).toBeTruthy();
        expect(screen.queryByTestId('team-people')).toBeNull();
        expect(screen.queryByTestId('authority-switches-fam')).toBeNull();
        expect(screen.queryByTestId('team-show-qr')).toBeNull();
    });

    it('an older server (no authorities on the row) keeps the older switches', async () => {
        fetchLabourPermissions.mockResolvedValue([OWNER, { ...FAMILY, authorities: undefined, canEditAuthorities: undefined }]);
        render(<Harness />);
        fireEvent.click(await screen.findByTestId('team-change-fam'));
        expect(screen.queryByTestId('authority-switches-fam')).toBeNull();
        expect(screen.getByTestId('labour-access-fam')).toBeTruthy();
    });
});
