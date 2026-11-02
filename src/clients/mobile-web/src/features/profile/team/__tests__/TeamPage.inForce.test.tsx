// @vitest-environment jsdom
/**
 * spec: plr-d10 lane MU-4 fix pass 1 (M7, P5: no control that does nothing) — the PRIMARY owner's card says what each seat
 * effectively gets, from the server's own words (`effectivePlotScope`, `plotScopeChoices`, `authoritiesNotInForce`):
 *   - "शेताची रचना बदलणे" on a seat that does not cover every plot is shown as not in force, with its rule line — a still
 *     row, never a switch;
 *   - a कामगार's plot row reads "स्वतःचं काम" with the rule line; its sheet offers only the choices that change something
 *     (स्वतःचं काम / निवडलेले प्लॉट — never सर्व प्लॉट, which would read exactly the same);
 *   - see money / see wages on an own-records seat are shown not in force, with their rule line;
 *   - an older server (none of the three fields) keeps today's card: three choices, every switch live.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { LabourPermission } from '../../data/labourPermissionsClient';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';

const fetchLabourPermissions = vi.fn();
vi.mock('../../data/labourPermissionsClient', async (importActual) => ({
    ...(await importActual<typeof import('../../data/labourPermissionsClient')>()),
    fetchLabourPermissions: (...a: unknown[]) => fetchLabourPermissions(...a),
    setLabourPermission: vi.fn(),
}));
vi.mock('../../data/membershipAdminClient', async (importActual) => ({
    ...(await importActual<typeof import('../../data/membershipAdminClient')>()),
    approveMember: vi.fn(),
    setMemberPlotScope: vi.fn(),
}));
vi.mock('../../../labour/data/fieldOperatorClient', () => ({
    fetchFieldOperators: vi.fn().mockResolvedValue([]),
    createFieldOperator: vi.fn(),
    deactivateFieldOperator: vi.fn(),
}));
vi.mock('../../../labour/data/fieldOperatorRosterCache', () => ({ readCachedRoster: () => null, writeCachedRoster: vi.fn() }));

import { TeamPage } from '../TeamPage';
import { useLabourPermissions } from '../../hooks/useLabourPermissions';

const FARM = 'farm-1';
const P2 = 'plot-2';

const row = (over: Partial<LabourPermission>): LabourPermission => ({
    userId: 'u', role: 'Worker', status: 'Active', canManageLabourRecords: false, hasExplicitGrant: false,
    source: 'NotGranted', isGrantEditable: true, labourGrantExpiresAtUtc: null, permissions: [], plotScope: 'AllPlots',
    canEditAuthorities: true, ...over,
});

const OWNER = row({ userId: 'me', role: 'PrimaryOwner', displayName: 'Purvesh', isRegistrant: true, canManageLabourRecords: true, isGrantEditable: false, source: 'OwnerTier', canEditAuthorities: false });
const RAMESH = row({
    userId: 'ramesh', role: 'Mukadam', displayName: 'रमेश', plotScope: 'ChosenPlots', plotIds: [P2],
    authorities: [{ name: 'EditFarmSetup', expiresAtUtc: null }, { name: 'SeeMoney', expiresAtUtc: null }],
    effectivePlotScope: 'ChosenPlots', plotScopeChoices: ['AllPlots', 'ChosenPlots', 'OwnWork'], authoritiesNotInForce: ['EditFarmSetup'],
});
const RAVI = row({
    userId: 'ravi', role: 'Worker', displayName: 'रवी', plotScope: 'AllPlots',
    authorities: [{ name: 'SeeMoney', expiresAtUtc: null }, { name: 'SeeWages', expiresAtUtc: null }],
    effectivePlotScope: 'OwnWork', plotScopeChoices: ['OwnWork', 'ChosenPlots'], authoritiesNotInForce: ['SeeMoney', 'SeeWages'],
});

const Harness: React.FC = () => {
    const roster = useLabourPermissions(FARM);
    return <TeamPage farmId={FARM} farmCode="K7M2QP" callerRole="PrimaryOwner" callerUserId="me" roster={roster} onShowQr={vi.fn()} />;
};

beforeEach(async () => {
    fetchLabourPermissions.mockReset();
    const db = getDatabase();
    await db.plots.clear();
    await db.plots.put({ id: P2, farmId: FARM, payload: { id: P2, farmId: FARM, name: 'प्लॉट दोन' }, updatedAt: '2026-11-02T00:00:00Z' });
});
afterEach(cleanup);

describe('what is not in force is said, never offered as a live switch', () => {
    it('farm setup on a chosen-plots seat: a still row with its rule line; see money stays a live switch', async () => {
        fetchLabourPermissions.mockResolvedValue([OWNER, RAMESH]);
        render(<Harness />);
        fireEvent.click(await screen.findByTestId('team-change-ramesh'));
        const setup = screen.getByTestId('authority-EditFarmSetup-ramesh');
        expect(setup.tagName).not.toBe('BUTTON');
        expect(setup.getAttribute('data-on')).toBe('not-in-force');
        expect(setup.textContent).toContain('लागू नाही');
        expect(screen.getByTestId('authority-EditFarmSetup-rule-ramesh').textContent).toBe('सर्व प्लॉट असतील तरच शेताची रचना बदलता येते.');
        const money = screen.getByTestId('authority-SeeMoney-ramesh');
        expect(money.tagName).toBe('BUTTON');
        expect(money.getAttribute('data-on')).toBe('yes');
    });

    it('a कामगार: the plot row reads स्वतःचं काम with its rule line, the sheet offers only the choices that change something, and money switches are not in force', async () => {
        fetchLabourPermissions.mockResolvedValue([OWNER, RAVI]);
        render(<Harness />);
        expect((await screen.findByTestId('plot-scope-summary-ravi')).textContent).toBe('स्वतःचं काम');
        expect(screen.getByTestId('plot-scope-rule-ravi').textContent)
            .toBe('कामगार म्हणून फक्त स्वतःचं काम दिसतं. प्लॉट निवडले तर फक्त त्या प्लॉटवर नोंद करता येईल.');
        fireEvent.click(screen.getByTestId('plot-scope-row-ravi'));
        const sheet = screen.getByTestId('plot-scope-sheet-ravi');
        expect(within(sheet).queryByTestId('plot-scope-choice-AllPlots-ravi')).toBeNull();
        expect(within(sheet).getByTestId('plot-scope-choice-OwnWork-ravi').getAttribute('aria-pressed')).toBe('true');
        expect(within(sheet).getByTestId('plot-scope-choice-ChosenPlots-ravi')).toBeTruthy();

        fireEvent.click(screen.getByTestId('team-change-ravi'));
        for (const name of ['SeeMoney', 'SeeWages']) {
            expect(screen.getByTestId(`authority-${name}-ravi`).getAttribute('data-on')).toBe('not-in-force');
            expect(screen.getByTestId(`authority-${name}-rule-ravi`).textContent).toContain('फक्त स्वतःच्या नोंदी दिसतात');
        }
    });

    it('an older server (none of the new words): three choices and every switch live, as today', async () => {
        const older: LabourPermission = { ...RAMESH };
        delete older.effectivePlotScope;
        delete older.plotScopeChoices;
        delete older.authoritiesNotInForce;
        fetchLabourPermissions.mockResolvedValue([OWNER, older]);
        render(<Harness />);
        fireEvent.click(await screen.findByTestId('plot-scope-row-ramesh'));
        for (const choice of ['AllPlots', 'ChosenPlots', 'OwnWork']) {
            expect(screen.getByTestId(`plot-scope-choice-${choice}-ramesh`)).toBeTruthy();
        }
        expect(screen.queryByTestId('plot-scope-rule-ramesh')).toBeNull();
        fireEvent.click(screen.getByTestId('team-change-ramesh'));
        expect(screen.getByTestId('authority-EditFarmSetup-ramesh').tagName).toBe('BUTTON');
    });
});
