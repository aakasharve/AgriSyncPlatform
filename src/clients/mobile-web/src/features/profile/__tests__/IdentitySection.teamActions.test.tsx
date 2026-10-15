// @vitest-environment jsdom
/**
 * Team page actions are REAL (spec: 2026-08-25-prod-cutover-waves).
 *
 * "Add worker" and "Remove" used to edit a phone-local profile list and call no server. They now go
 * through the existing field-operator routes, are offered only to owner/co-owner, show a row only
 * after the server has accepted it, and say so honestly when the phone is offline (there is no
 * queued mutation for field operators, so nothing is "remembered on phone").
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';

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

const fetchFieldOperators = vi.fn();
const createFieldOperator = vi.fn();
const deactivateFieldOperator = vi.fn();
vi.mock('../../labour/data/fieldOperatorClient', () => ({
    fetchFieldOperators: (...a: unknown[]) => fetchFieldOperators(...a),
    createFieldOperator: (...a: unknown[]) => createFieldOperator(...a),
    deactivateFieldOperator: (...a: unknown[]) => deactivateFieldOperator(...a),
}));
const writeCachedRoster = vi.fn();
vi.mock('../../labour/data/fieldOperatorRosterCache', () => ({
    readCachedRoster: () => null,
    writeCachedRoster: (...a: unknown[]) => writeCachedRoster(...a),
}));

import IdentitySection from '../sections/IdentitySection';
import { FarmerProfile, VerificationStatus } from '../../../types';

const op = (id: string, displayName: string, isActive = true) => ({ id, displayName, isActive, fullName: undefined });

function profile(extra: Partial<FarmerProfile> = {}): FarmerProfile {
    return {
        name: 'Akash', village: 'Pune', phone: '9999999999',
        verificationStatus: VerificationStatus.PhoneVerified,
        operators: [],
        ...extra,
    } as FarmerProfile;
}

function mount(role: string | null, prof: FarmerProfile = profile()) {
    const onUpdateProfile = vi.fn();
    const utils = render(
        <IdentitySection
            profile={prof}
            onUpdateProfile={onUpdateProfile}
            logout={vi.fn()}
            myFarm={role === null ? null : { farmId: 'farm-1', name: 'Farm', role, subscription: null }}
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
    return { ...utils, onUpdateProfile };
}

const ADD = 'कामगाराचं नाव जोडा';

function openAndType(name: string) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(ADD) }));
    fireEvent.change(screen.getByPlaceholderText('नाव'), { target: { value: name } });
}

beforeEach(() => {
    fetchFieldOperators.mockReset().mockResolvedValue([op('w1', 'Ganesh')]);
    createFieldOperator.mockReset();
    deactivateFieldOperator.mockReset();
    writeCachedRoster.mockReset();
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
});
afterEach(cleanup);

describe.each([['PrimaryOwner'], ['SecondaryOwner']])('Team page as %s', (role) => {
    it("lists the farm's named workers from the SERVER and offers Add", async () => {
        mount(role);
        expect(await screen.findByText('Ganesh')).toBeTruthy();
        expect(fetchFieldOperators).toHaveBeenCalledWith('farm-1');
        expect(screen.getByRole('button', { name: new RegExp(ADD) })).toBeTruthy();
    });

    it('Add: the row appears only after the server accepted it; nothing is written to the phone-local profile', async () => {
        let resolve!: (v: unknown) => void;
        createFieldOperator.mockImplementation(() => new Promise((r) => { resolve = r; }));
        const { onUpdateProfile } = mount(role);
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
        expect(onUpdateProfile).not.toHaveBeenCalled();
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

    it('removed (inactive) workers are not listed; a linked app user has no Remove here', async () => {
        fetchFieldOperators.mockResolvedValue([op('w1', 'Ganesh'), op('w2', 'Gone', false)]);
        mount(role, profile({
            operators: [{ id: 'user-9', name: 'Sunita', role: 'SECONDARY_OWNER', capabilities: [], isVerifier: true, isActive: true }] as never,
        }));
        await screen.findByText('Ganesh');
        expect(screen.queryByText('Gone')).toBeNull();
        expect(await screen.findByText('Sunita')).toBeTruthy();
        fireEvent.click(screen.getByText('Sunita'));
        // Only the one named worker has a Remove control; the linked user's card has none.
        expect(screen.queryAllByTestId(/^remove-w/)).toHaveLength(1);
        expect(screen.queryByText(/टीममधून काढा/)).toBeNull();
    });

    it('a phone-local-only "member" from the old mock is no longer presented as a team member', async () => {
        mount(role, profile({
            operators: [{ id: 'op_123', name: 'Phantom', role: 'WORKER', capabilities: [], isVerifier: false, isActive: true, localOnly: true }] as never,
        }));
        await screen.findByText('Ganesh');
        expect(screen.queryByText('Phantom')).toBeNull();
    });
});

describe.each([['Mukadam'], ['Worker']])('Team page as %s', (role) => {
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
