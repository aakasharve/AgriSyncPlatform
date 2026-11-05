// @vitest-environment jsdom
/**
 * Team page actions are REAL (spec: 2026-08-25-prod-cutover-waves).
 *
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 2, P-4) — the team moved out of the ओळख page into its
 * own screen ("माझी टीम", TeamPage). These are the same named-worker assertions, against the screen
 * the card lives on now (moved from IdentitySection.teamActions.test.tsx).
 *
 * "Add worker" and "Remove" used to edit a phone-local profile list and call no server. They now go
 * through the existing field-operator routes, are offered only to owner/co-owner, show a row only
 * after the server has accepted it, and say so honestly when the phone is offline (there is no
 * queued mutation for field operators, so nothing is "remembered on phone").
 *
 * lane WID (founder D-54 section 10): adding a NAMED worker now needs his phone and home PIN too ("जोडा" stays off
 * until all three are right), so the add steps below fill them; his card is made by the server.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: vi.fn(), t: (k: string) => k }),
    // lane MU-4 fix pass 1 (M8) — the team page now reads the language for its one line about what each phone gets.
    useOptionalLanguage: () => ({ language: 'mr', setLanguage: vi.fn(), t: (k: string) => k }),
}));

const fetchFieldOperators = vi.fn();
const createFieldOperator = vi.fn();
const deactivateFieldOperator = vi.fn();
vi.mock('../../../labour/data/fieldOperatorClient', () => ({
    fetchFieldOperators: (...a: unknown[]) => fetchFieldOperators(...a),
    createFieldOperator: (...a: unknown[]) => createFieldOperator(...a),
    deactivateFieldOperator: (...a: unknown[]) => deactivateFieldOperator(...a),
}));
// lane WID — the farm has no PIN on record (no chip) and the number is on nobody else here.
vi.mock('../../../labour/data/workerIdentityClient', () => ({
    fetchFarmPin: async () => null,
    checkPhone: async () => ({ sameFarmNames: [], verifiedHolderExists: false }),
}));
const writeCachedRoster = vi.fn();
vi.mock('../../../labour/data/fieldOperatorRosterCache', () => ({
    readCachedRoster: () => null,
    writeCachedRoster: (...a: unknown[]) => writeCachedRoster(...a),
}));

import { TeamPage } from '../TeamPage';
import type { UseLabourPermissionsResult } from '../../hooks/useLabourPermissions';
import type { LabourPermission } from '../../data/labourPermissionsClient';

const op = (id: string, displayName: string, isActive = true) => ({ id, displayName, isActive, fullName: undefined });

const roster = (rows: LabourPermission[] | null = []): UseLabourPermissionsResult => ({
    rows, loading: false, loadFailed: false, savingUserId: null, error: null,
    reload: vi.fn(async () => undefined), setPermission: vi.fn(async () => undefined), setAuthorities: vi.fn(async () => undefined), dismissError: vi.fn(), adoptRow: vi.fn(),
});

const linked = (userId: string, displayName: string, role = 'SecondaryOwner'): LabourPermission => ({
    userId, role, status: 'Active', canManageLabourRecords: true, hasExplicitGrant: false,
    source: 'OwnerTier', isGrantEditable: false, labourGrantExpiresAtUtc: null, displayName,
});

function mount(role: string | null, rows: LabourPermission[] = []) {
    return render(
        <TeamPage
            farmId={role === null ? null : 'farm-1'}
            farmCode="K7M2QP"
            callerRole={role}
            callerUserId="me"
            roster={roster(rows)}
        />,
    );
}

// lane WID fix pass 1 (L6): the form asks name, phone and PIN, so the button says what screen 1 says.
const ADD = 'कामगार जोडा';

function openAndType(name: string) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(ADD) }));
    fireEvent.change(screen.getByPlaceholderText('नाव'), { target: { value: name } });
    fireEvent.change(screen.getByTestId('add-worker-phone'), { target: { value: '6000000101' } });
    fireEvent.change(screen.getByTestId('add-worker-pin'), { target: { value: '413304' } });
}

beforeEach(() => {
    fetchFieldOperators.mockReset().mockResolvedValue([op('w1', 'Ganesh')]);
    createFieldOperator.mockReset();
    deactivateFieldOperator.mockReset();
    writeCachedRoster.mockReset();
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
});
afterEach(cleanup);

describe.each([['PrimaryOwner']])('Team page as %s', (role) => {
    it("lists the farm's named workers from the SERVER and offers Add", async () => {
        mount(role);
        expect(await screen.findByText('Ganesh')).toBeTruthy();
        expect(fetchFieldOperators).toHaveBeenCalledWith('farm-1');
        expect(screen.getByRole('button', { name: new RegExp(ADD) })).toBeTruthy();
    });

    it('Add: the row appears only after the server accepted it', async () => {
        let resolve!: (v: unknown) => void;
        createFieldOperator.mockImplementation(() => new Promise((r) => { resolve = r; }));
        mount(role);
        await screen.findByText('Ganesh');

        openAndType('Ramesh');
        fireEvent.click(screen.getByRole('button', { name: 'जोडा' }));

        await waitFor(() => expect(createFieldOperator).toHaveBeenCalledTimes(1));
        const [farmId, name, , clientId] = createFieldOperator.mock.calls[0];
        expect(farmId).toBe('farm-1');
        expect(name).toBe('Ramesh');
        expect(typeof clientId).toBe('string');
        expect(clientId.length).toBeGreaterThan(8);
        // Not yet acknowledged: no row, no success claim.
        expect(screen.queryByText('Ramesh')).toBeNull();
        expect(screen.queryByText(/जोडलं/)).toBeNull();

        resolve(op(clientId, 'Ramesh'));
        expect(await screen.findByText('Ramesh')).toBeTruthy();
        expect(writeCachedRoster).toHaveBeenCalled();
        // lane WID fix pass 1 (L6): the success line carries a real icon, never a typed check-mark glyph.
        const notice = screen.getByTestId('farm-workers-notice');
        expect(notice.textContent).toBe('Ramesh जोडलं');
        expect(within(notice).getByTestId('farm-workers-notice-icon')).toBeTruthy();
    });

    it('Add failing: no row, an honest failure, and the retry reuses the SAME id (idempotent)', async () => {
        createFieldOperator.mockRejectedValueOnce({ response: { status: 500 } });
        mount(role);
        await screen.findByText('Ganesh');
        openAndType('Ramesh');
        fireEvent.click(screen.getByRole('button', { name: 'जोडा' }));

        expect(await screen.findByText('नाव जोडता आलं नाही — पुन्हा प्रयत्न करा')).toBeTruthy();
        expect(screen.queryByText('Ramesh')).toBeNull();

        createFieldOperator.mockImplementation(async (_f: string, n: string, _x: unknown, id: string) => op(id, n));
        fireEvent.click(screen.getByRole('button', { name: 'जोडा' }));
        expect(await screen.findByText('Ramesh')).toBeTruthy();
        expect(createFieldOperator.mock.calls[1][3]).toBe(createFieldOperator.mock.calls[0][3]);
    });

    it('Add while offline: no request, an honest "not now" message, nothing remembered', async () => {
        mount(role);
        await screen.findByText('Ganesh');
        Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
        openAndType('Ramesh');
        fireEvent.click(screen.getByRole('button', { name: 'जोडा' }));

        expect(await screen.findByText(/इंटरनेट नसल्यामुळे आत्ता नाव जोडता आलं नाही/)).toBeTruthy();
        expect(createFieldOperator).not.toHaveBeenCalled();
        expect(screen.queryByText('Ramesh')).toBeNull();
        expect(screen.queryByText(/लक्षात ठेवलं/)).toBeNull();
    });

    it('Add refused by the server (403) says so and shows no row', async () => {
        createFieldOperator.mockRejectedValue({ response: { status: 403 } });
        mount(role);
        await screen.findByText('Ganesh');
        openAndType('Ramesh');
        fireEvent.click(screen.getByRole('button', { name: 'जोडा' }));
        expect(await screen.findByText('हे तुम्हाला करता येत नाही.')).toBeTruthy();
        expect(screen.queryByText('Ramesh')).toBeNull();
    });

    it('Remove: asks first, calls the server, and the row leaves only after the server answered', async () => {
        let resolve!: (v: unknown) => void;
        deactivateFieldOperator.mockImplementation(() => new Promise((r) => { resolve = r; }));
        mount(role);
        await screen.findByText('Ganesh');

        fireEvent.click(screen.getByTestId('remove-w1'));
        expect(screen.getByText(/जुन्या हजेरीच्या नोंदी तशाच राहतील/)).toBeTruthy();
        expect(deactivateFieldOperator).not.toHaveBeenCalled();
        fireEvent.click(within(screen.getByTestId('remove-confirm-w1')).getByRole('button', { name: 'काढा' }));

        await waitFor(() => expect(deactivateFieldOperator).toHaveBeenCalledWith('farm-1', 'w1'));
        expect(screen.getByText('Ganesh')).toBeTruthy(); // not yet acknowledged
        resolve(op('w1', 'Ganesh', false));
        await waitFor(() => expect(screen.queryByText('Ganesh')).toBeNull());
        expect(writeCachedRoster).toHaveBeenCalled();
    });

    it('Remove failing keeps the person on the list and says so', async () => {
        deactivateFieldOperator.mockRejectedValue({ response: { status: 500 } });
        mount(role);
        await screen.findByText('Ganesh');
        fireEvent.click(screen.getByTestId('remove-w1'));
        fireEvent.click(within(screen.getByTestId('remove-confirm-w1')).getByRole('button', { name: 'काढा' }));
        expect(await screen.findByText('काढता आलं नाही — पुन्हा प्रयत्न करा')).toBeTruthy();
        expect(screen.getByText('Ganesh')).toBeTruthy();
    });

    it('a load failure is shown as a failure, never as an empty team, and Add is held', async () => {
        fetchFieldOperators.mockRejectedValue({ response: { status: 500 } });
        mount(role);
        expect(await screen.findByText('माहिती आणता आली नाही')).toBeTruthy();
        expect(screen.queryByText('अजून कुणाचं नाव नाही')).toBeNull();
        openAndType('Ramesh');
        fireEvent.click(screen.getByRole('button', { name: 'जोडा' }));
        expect(createFieldOperator).not.toHaveBeenCalled();
    });

    it('removed (inactive) workers are not listed; a linked app user is not a named worker', async () => {
        fetchFieldOperators.mockResolvedValue([op('w1', 'Ganesh'), op('w2', 'Gone', false)]);
        mount(role, [linked('user-9', 'Sunita')]);
        await screen.findByText('Ganesh');
        expect(screen.queryByText('Gone')).toBeNull();
        // The linked person is on her own person card, never in the named-workers list.
        expect(within(screen.getByTestId('team-person-user-9')).getByText('Sunita')).toBeTruthy();
        // Only the one named worker has a named-worker Remove control.
        expect(screen.queryAllByTestId(/^remove-w/)).toHaveLength(1);
        expect(screen.queryByText(/टीममधून काढा/)).toBeNull();
    });
});

// lane 2b (founder D-26): a सहमालक no longer manages the named workers here — the team screen is the
// primary account holder's; a co-owner reaches named workers through हजेरी when he holds it.
describe.each([['SecondaryOwner'], ['Mukadam'], ['Worker']])('Team page as %s', (role) => {
    it('offers no Add, no Remove, no worker list, and asks the roster nothing', async () => {
        mount(role);
        await new Promise((r) => setTimeout(r, 20));
        expect(screen.queryByRole('button', { name: new RegExp(ADD) })).toBeNull();
        expect(screen.queryByText('Ganesh')).toBeNull();
        expect(screen.queryAllByTestId(/^remove-/)).toHaveLength(0);
        expect(fetchFieldOperators).not.toHaveBeenCalled();
    });
});

describe('Team page before the farm is known', () => {
    it('shows no Add (nothing to send it to) and calls no server', async () => {
        mount(null);
        await new Promise((r) => setTimeout(r, 20));
        expect(screen.queryByRole('button', { name: new RegExp(ADD) })).toBeNull();
        expect(fetchFieldOperators).not.toHaveBeenCalled();
    });
});
