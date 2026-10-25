// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (I3 — X2)
//
// The farm setup (water, motors, power timetable, machines) used to vanish when the app
// closed: nothing wrote an edit to the phone. These pin the save — and the two things it
// must not do: save people added on this phone, or write back what it just read.

import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFarmerSetupPersistence } from '../useFarmerSetupPersistence';
import type { AppDataSource } from '../../../application/ports/AppDataSource';
import type { FarmerProfile } from '../../../types';

const base = (over: Partial<FarmerProfile> = {}): FarmerProfile => ({
    name: 'Sunita',
    village: 'Pandharpur',
    phone: '9000000000',
    language: 'mr',
    verificationStatus: 'Unverified' as FarmerProfile['verificationStatus'],
    operators: [{ id: 'srv-1', name: 'Ramesh', role: 'WORKER', capabilities: [], isVerifier: false, isActive: true }],
    waterResources: [],
    motors: [],
    infrastructure: { waterManagement: 'Decentralized', filtrationType: 'Screen' },
    ...over,
} as FarmerProfile);

function fakeSource(stored: FarmerProfile) {
    const save = vi.fn(async () => undefined);
    const dataSource = { profile: { get: vi.fn(async () => stored), save } } as unknown as AppDataSource;
    return { dataSource, save };
}

type Props = { farmerProfile: FarmerProfile; dataLoaded: boolean; isDemoMode: boolean };

describe('saving the farm setup on the phone', () => {
    it('saves nothing before the first load has finished', async () => {
        const { dataSource, save } = fakeSource(base());
        const { rerender } = renderHook((p: Props) => useFarmerSetupPersistence({ ...p, dataSource }), {
            initialProps: { farmerProfile: base(), dataLoaded: false, isDemoMode: false },
        });
        rerender({ farmerProfile: base({ village: 'Changed' }), dataLoaded: false, isDemoMode: false });
        await new Promise((r) => setTimeout(r, 20));
        expect(save).not.toHaveBeenCalled();
    });

    it('does not write back the profile it just read, but saves the next edit', async () => {
        const stored = base();
        const { dataSource, save } = fakeSource(stored);
        const { result, rerender } = renderHook((p: Props) => useFarmerSetupPersistence({ ...p, dataSource }), {
            initialProps: { farmerProfile: base(), dataLoaded: false, isDemoMode: false },
        });
        result.current.noteStoredProfile(stored);
        rerender({ farmerProfile: stored, dataLoaded: true, isDemoMode: false });
        await new Promise((r) => setTimeout(r, 20));
        expect(save).not.toHaveBeenCalled();

        const edited = base({
            electricityTiming: { singlePhase: [], threePhase: [] } as unknown as FarmerProfile['electricityTiming'],
            waterResources: [{ id: 'w1', name: 'विहीर' } as unknown as FarmerProfile['waterResources'][number]],
        });
        rerender({ farmerProfile: edited, dataLoaded: true, isDemoMode: false });
        await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
        const saved = (save.mock.calls[0] as unknown as [FarmerProfile])[0];
        expect(saved.waterResources).toEqual(edited.waterResources);
        expect(saved.electricityTiming).toEqual(edited.electricityTiming);
    });

    it('keeps the STORED people list — a person added only on this phone is not saved', async () => {
        const stored = base();
        const { dataSource, save } = fakeSource(stored);
        const { result, rerender } = renderHook((p: Props) => useFarmerSetupPersistence({ ...p, dataSource }), {
            initialProps: { farmerProfile: stored, dataLoaded: false, isDemoMode: false },
        });
        result.current.noteStoredProfile(stored);
        rerender({ farmerProfile: stored, dataLoaded: true, isDemoMode: false });

        const withLocalPerson = base({
            village: 'Wakhari',
            operators: [
                ...stored.operators,
                { id: 'op_local', name: 'Local', role: 'WORKER', capabilities: [], isVerifier: false, isActive: true, localOnly: true } as FarmerProfile['operators'][number],
            ],
        });
        rerender({ farmerProfile: withLocalPerson, dataLoaded: true, isDemoMode: false });
        await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
        const saved = (save.mock.calls[0] as unknown as [FarmerProfile])[0];
        expect(saved.village).toBe('Wakhari');
        expect(saved.operators.map((o) => o.id)).toEqual(['srv-1']);
    });

    it('never saves in demo mode', async () => {
        const { dataSource, save } = fakeSource(base());
        const { rerender } = renderHook((p: Props) => useFarmerSetupPersistence({ ...p, dataSource }), {
            initialProps: { farmerProfile: base(), dataLoaded: true, isDemoMode: true },
        });
        rerender({ farmerProfile: base({ village: 'Demo edit' }), dataLoaded: true, isDemoMode: true });
        await new Promise((r) => setTimeout(r, 20));
        expect(save).not.toHaveBeenCalled();
    });
});
