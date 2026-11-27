// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P6) - "यंत्रं" on the FARM's machines once the server has sent the farm's set,
 * on top of repair FIX-1's form (types, optional details by type): a change keeps the machine's id and sends the revision the phone last received; a
 * new machine gets a bare GUID and base 0; only the details of the chosen type travel, an unknown one LEFT OUT; the honest lines; read-only for a
 * person who may not change the farm setup; and another farm's machines are never shown.
 */
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));
const h = vi.hoisted(() => ({ language: 'mr' as 'mr' | 'en' }));
vi.mock('../../../i18n/LanguageContext', async (importActual) => ({
    ...(await importActual<typeof import('../../../i18n/LanguageContext')>()),
    useOptionalLanguage: () => ({ language: h.language }),
}));

import MachinesSection from '../sections/MachinesSection';
import { VerificationStatus, type FarmerProfile } from '../../../domain/types/farm.types';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { DexieFarmSetupRepository } from '../../../infrastructure/storage/DexieFarmSetupRepository';
import { farmSetupFromDto } from '../../../infrastructure/storage/farmSetupRow';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { validatePayload } from '../../../infrastructure/sync/PayloadValidator';
import { useFarmSetup } from '../farmSetup/useFarmSetup';
import { FARM_A, FARM_B, MACHINE_A, emptyFarmDto, fullFarmDto } from '../../../infrastructure/storage/__tests__/farmSetupFixtures';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEVANAGARI = /[ऀ-ॿ]/;
const profile = {
    name: 'T', village: 'V', phone: '9', language: 'mr', verificationStatus: VerificationStatus.PhoneVerified, operators: [], waterResources: [], motors: [],
    machineries: [{ id: 'mach_old', name: 'फोनवरचा ट्रॅक्टर', type: 'Tractor', ownership: 'Owned' }],
} as unknown as FarmerProfile;

const Page: React.FC<{ farmId: string; canEdit?: boolean }> = ({ farmId, canEdit = true }) => {
    const farmSetup = useFarmSetup(farmId);
    return <MachinesSection profile={profile} onUpdate={vi.fn()} farmSetup={farmSetup} canEdit={canEdit} />;
};

const queue = async () => (await getDatabase().mutationQueue.toArray()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

beforeEach(async () => {
    h.language = 'mr';
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.farmWaterSources.clear(), db.farmMachines.clear(), db.farmPowerTimes.clear(), db.plotWater.clear()]);
    await new DexieFarmSetupRepository(db).replaceFarms([farmSetupFromDto(fullFarmDto(), 'now')!.set, farmSetupFromDto(emptyFarmDto(FARM_B), 'now')!.set]);
});
afterEach(() => cleanup());

describe('यंत्रं on the farm set (P6)', () => {
    it('edit keeps the id and sends the cached revision', async () => {
        render(<Page farmId={FARM_A} />);
        fireEvent.click(await screen.findByTestId(`machine-edit-${MACHINE_A}`));
        fireEvent.change(screen.getByTestId('machine-name'), { target: { value: 'महिंद्रा 575 DI' } });
        fireEvent.change(screen.getByTestId('machine-hp'), { target: { value: '47.505' } });
        await act(async () => { fireEvent.click(screen.getByTestId('machine-save')); });
        await waitFor(async () => expect(await queue()).toHaveLength(1));
        const [row] = await queue();
        expect(row.mutationType).toBe(SyncMutationName.FarmsetupMachineSave);
        expect(row.payload).toEqual({ farmId: FARM_A, machineId: MACHINE_A, baseRevision: 1, name: 'महिंद्रा 575 DI', machineType: 'tractor', ownership: 'owned', hp: 47.5 });
        expect(validatePayload(row.mutationType, row.payload).ok).toBe(true);
        await waitFor(() => expect(within(screen.getByTestId(`machine-${MACHINE_A}`)).getByTestId('setup-waiting')).toBeInTheDocument());
    });

    it('a new machine gets a bare GUID and base 0; only its type\'s details travel', async () => {
        render(<Page farmId={FARM_B} />);
        fireEvent.click(await screen.findByTestId('machine-add'));
        fireEvent.change(screen.getByTestId('machine-name'), { target: { value: 'ब्लोअर' } });
        fireEvent.click(screen.getByTestId('machine-type-Blower'));
        fireEvent.click(screen.getByTestId('machine-own-Rented'));
        fireEvent.change(screen.getByTestId('machine-company'), { target: { value: 'मित्रा' } });
        fireEvent.change(screen.getByTestId('machine-nozzles'), { target: { value: '4' } });
        fireEvent.change(screen.getByTestId('machine-tank'), { target: { value: '600' } });
        await act(async () => { fireEvent.click(screen.getByTestId('machine-save')); });
        await waitFor(async () => expect(await queue()).toHaveLength(1));
        const p = (await queue())[0].payload as Record<string, unknown>;
        expect(p.machineId).toMatch(GUID);
        expect(p).toEqual({ farmId: FARM_B, machineId: p.machineId, baseRevision: 0, name: 'ब्लोअर', machineType: 'blower', ownership: 'rented', company: 'मित्रा', nozzleCount: 4, tankLitres: 600 });
    });

    it('two farms, two machine lists; the phone profile\'s machines are not the farm\'s', async () => {
        const { rerender } = render(<Page farmId={FARM_A} />);
        expect(await screen.findByText('महिंद्रा 575')).toBeInTheDocument();
        expect(screen.queryByText('फोनवरचा ट्रॅक्टर')).not.toBeInTheDocument();
        expect(screen.queryByTestId('setup-this-phone-only')).not.toBeInTheDocument();
        rerender(<Page farmId={FARM_B} />);
        expect(await screen.findByTestId('machines-empty')).toBeInTheDocument();
        expect(screen.queryByText('महिंद्रा 575')).not.toBeInTheDocument();
    });

    it('removing a machine sends its revision', async () => {
        render(<Page farmId={FARM_A} />);
        const remove = await screen.findByTestId(`machine-remove-${MACHINE_A}`);
        await act(async () => { fireEvent.click(remove); });
        await waitFor(async () => expect(await queue()).toHaveLength(1));
        expect((await queue())[0].payload).toEqual({ farmId: FARM_A, machineId: MACHINE_A, baseRevision: 1 });
    });

    it('a reader sees no add, change or remove, and is told who can; English mode is English only', async () => {
        h.language = 'en';
        render(<Page farmId={FARM_A} canEdit={false} />);
        await screen.findByTestId(`machine-${MACHINE_A}`);
        expect(screen.queryByTestId('machine-add')).not.toBeInTheDocument();
        expect(screen.queryByTestId(`machine-edit-${MACHINE_A}`)).not.toBeInTheDocument();
        expect(screen.queryByTestId(`machine-remove-${MACHINE_A}`)).not.toBeInTheDocument();
        expect(screen.getByTestId('setup-read-only')).toHaveTextContent('The owner or a person with permission can change this.');
        const words = (screen.getByTestId('hub-machines').textContent ?? '').replace('महिंद्रा 575', '');
        expect(words).not.toMatch(DEVANAGARI);
    });
});
