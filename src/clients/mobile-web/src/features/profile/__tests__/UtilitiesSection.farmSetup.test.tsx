// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P4) - "पाणी आणि वीज" on the FARM's set once the server has sent it: the open
 * farm's sources and motors (never another farm's), every change through the farm-setup doors (queued, bare GUID ids, no made-up motor timetable), the
 * honest lines in place of "फक्त या फोनवर…" (a waiting change says so; a saved one says nothing), the motor's own plots in place of "लवकरच", read-only
 * for a person who may not change the farm setup, and a refused change kept with his words and "माझा बदल पुन्हा करा". Before the server has sent the
 * farm's set the page stays the phone-only page it was (an old server).
 */
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));
const h = vi.hoisted(() => ({ language: 'mr' as 'mr' | 'en' }));
vi.mock('../../../i18n/LanguageContext', async (importActual) => ({
    ...(await importActual<typeof import('../../../i18n/LanguageContext')>()),
    useOptionalLanguage: () => ({ language: h.language }),
}));

import UtilitiesSection from '../sections/UtilitiesSection';
import { VerificationStatus, type FarmerProfile } from '../../../domain/types/farm.types';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { DexieFarmSetupRepository } from '../../../infrastructure/storage/DexieFarmSetupRepository';
import { farmSetupFromDto } from '../../../infrastructure/storage/farmSetupRow';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { useFarmSetup } from '../farmSetup/useFarmSetup';
import { FARM_A, FARM_B, MOTOR_A1, PLOT_A, SOURCE_A, fullFarmDto } from '../../../infrastructure/storage/__tests__/farmSetupFixtures';

// The screens follow Dexie live queries: under a loaded whole-suite run an update can take longer than the 1 s default (seen 27 Nov), so the
// waits here allow 5 s. A wait that never comes still fails.
configure({ asyncUtilTimeout: 5000 });

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE_B = 'd9bb0000-0000-4000-8000-000000000001';
const DEVANAGARI = /[ऀ-ॿ]/;

const phoneProfile = (): FarmerProfile => ({
    name: 'T', village: 'V', phone: '9', language: 'mr', verificationStatus: VerificationStatus.PhoneVerified, operators: [],
    waterResources: [{ id: 'w_old', name: 'फोनवरची विहीर', type: 'Well', isAvailable: true }], motors: [],
    infrastructure: { waterManagement: 'Centralized', filtrationType: 'None' },
} as FarmerProfile);

const farmB = () => ({
    ...fullFarmDto(), farmId: FARM_B, machines: [], plotWater: [], powerTimes: null,
    waterSources: [{ id: SOURCE_B, revision: 3, name: 'दुसऱ्या शेताचा कालवा', sourceType: 'canal', isAvailable: true, notes: null, motors: [], updatedAtUtc: 't' }],
});

/** The page as ProfilePage draws it: the OPEN farm's set through the hook. */
const Page: React.FC<{ farmId: string; canEdit?: boolean }> = ({ farmId, canEdit = true }) => {
    const farmSetup = useFarmSetup(farmId);
    return <UtilitiesSection profile={phoneProfile()} onUpdate={vi.fn()} farmSetup={farmSetup} canEdit={canEdit}
        plots={[{ id: PLOT_A, name: 'G1' }]} />;
};

const queue = async () => (await getDatabase().mutationQueue.toArray()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

beforeEach(async () => {
    h.language = 'mr';
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.farmWaterSources.clear(), db.farmMachines.clear(), db.farmPowerTimes.clear(), db.plotWater.clear()]);
    await new DexieFarmSetupRepository(db).replaceFarms([farmSetupFromDto(fullFarmDto(), 'now')!.set, farmSetupFromDto(farmB(), 'now')!.set]);
});
afterEach(() => cleanup());

describe('पाणी आणि वीज on the farm set (P4)', () => {
    it('two farms on one phone show two different water lists', async () => {
        const { rerender } = render(<Page farmId={FARM_A} />);
        expect(await screen.findByText('मुख्य विहीर')).toBeInTheDocument();
        expect(screen.queryByText('दुसऱ्या शेताचा कालवा')).not.toBeInTheDocument();
        expect(screen.queryByText('फोनवरची विहीर')).not.toBeInTheDocument();
        expect(screen.queryByTestId('setup-this-phone-only')).not.toBeInTheDocument();
        rerender(<Page farmId={FARM_B} />);
        expect(await screen.findByText('दुसऱ्या शेताचा कालवा')).toBeInTheDocument();
        expect(screen.queryByText('मुख्य विहीर')).not.toBeInTheDocument();
    });

    it('before the server sent the farm set, the phone-only page stays as it was', async () => {
        render(<Page farmId="3d030000-0000-4000-8000-0000000000c9" />);
        expect(await screen.findByTestId('setup-this-phone-only')).toHaveTextContent('फक्त या फोनवर साठवलं जातं');
        expect(screen.getByText('फोनवरची विहीर')).toBeInTheDocument();
    });

    it('while the farm set is still being read, nothing that could be tapped is drawn', () => {
        render(<UtilitiesSection profile={phoneProfile()} onUpdate={vi.fn()} farmSetup={null} canEdit />);
        expect(screen.queryByTestId('source-add')).not.toBeInTheDocument();
        expect(screen.queryByText('फोनवरची विहीर')).not.toBeInTheDocument();
    });

    it('a new source goes through the farm-setup door: bare ids, no made-up motor timetable, and it says it waits', async () => {
        render(<Page farmId={FARM_A} />);
        await screen.findByText('मुख्य विहीर');
        fireEvent.click(screen.getByTestId('source-add'));
        fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'नवी बोअर' } });
        fireEvent.click(screen.getByTestId('source-type-Borewell'));
        fireEvent.click(screen.getByTestId('source-next'));
        fireEvent.change(screen.getByTestId('motor-name-1'), { target: { value: 'सोलर पंप' } });
        fireEvent.change(screen.getByTestId('motor-hp-1'), { target: { value: '7.555' } });
        fireEvent.click(screen.getByTestId('motor-phase-1-1'));
        fireEvent.click(screen.getByTestId('motor-power-1-Solar'));
        await act(async () => { fireEvent.click(screen.getByTestId('source-save')); });
        await waitFor(async () => expect(await queue()).toHaveLength(1));
        const [row] = await queue();
        expect(row.mutationType).toBe(SyncMutationName.FarmsetupWaterSourceSave);
        const p = row.payload as Record<string, unknown>;
        expect(Object.keys(p).sort()).toEqual(['baseRevision', 'farmId', 'isAvailable', 'motors', 'name', 'sourceType', 'waterSourceId']);
        expect(p).toMatchObject({ farmId: FARM_A, baseRevision: 0, name: 'नवी बोअर', sourceType: 'borewell', isAvailable: true });
        expect(p.waterSourceId).toMatch(GUID);
        const [m] = p.motors as Record<string, unknown>[];
        expect(m).toEqual({ motorId: expect.stringMatching(GUID), name: 'सोलर पंप', hp: 7.55, phase: 1, powerSource: 'solar' });
        const card = await screen.findByTestId(`source-${p.waterSourceId as string}`);
        expect(within(card).getByTestId('setup-waiting')).toHaveTextContent('अजून सर्व्हरवर गेलं नाही — नेट आल्यावर जाईल.');
        // the saved source says nothing
        expect(within(screen.getByTestId(`source-${SOURCE_A}`)).queryByTestId('setup-waiting')).not.toBeInTheDocument();
    });

    it('removing one motor saves the source with the rest of its motors; the motor card names the plots it waters', async () => {
        render(<Page farmId={FARM_A} />);
        fireEvent.click(await screen.findByTestId(`source-toggle-${SOURCE_A}`));
        expect(within(screen.getByTestId(`motor-${MOTOR_A1}`)).getByTestId(`motor-plots-${MOTOR_A1}`)).toHaveTextContent('G1');
        expect(screen.queryByTestId('soon')).not.toBeInTheDocument();
        await act(async () => { fireEvent.click(screen.getByTestId(`motor-remove-${MOTOR_A1}`)); });
        await waitFor(async () => expect(await queue()).toHaveLength(1));
        const p = (await queue())[0].payload as { baseRevision: number; motors: { motorId: string }[] };
        expect(p.baseRevision).toBe(1);
        expect(p.motors.map(x => x.motorId)).toEqual(['d9aa0000-0000-4000-8000-000000000012']);
    });

    it('a person who may not change the farm setup reads: no add, change or remove, and the line says who can', async () => {
        render(<Page farmId={FARM_A} canEdit={false} />);
        fireEvent.click(await screen.findByTestId(`source-toggle-${SOURCE_A}`));
        expect(screen.getByTestId('setup-read-only')).toHaveTextContent('ही माहिती मालक किंवा परवानगी असलेली व्यक्ती बदलू शकते.');
        expect(screen.queryByTestId('source-add')).not.toBeInTheDocument();
        expect(screen.queryByTestId(`source-edit-${SOURCE_A}`)).not.toBeInTheDocument();
        expect(screen.queryByTestId(`source-remove-${SOURCE_A}`)).not.toBeInTheDocument();
        expect(screen.queryByTestId(`motor-remove-${MOTOR_A1}`)).not.toBeInTheDocument();
    });

    it('a stale refusal keeps his words beside the server item; "माझा बदल पुन्हा करा" opens the form with what he typed', async () => {
        render(<Page farmId={FARM_A} />);
        fireEvent.click(await screen.findByTestId(`source-toggle-${SOURCE_A}`));
        fireEvent.click(screen.getByTestId(`source-edit-${SOURCE_A}`));
        fireEvent.change(screen.getByTestId('source-name'), { target: { value: 'माझं नाव' } });
        fireEvent.click(screen.getByTestId('source-next'));
        await act(async () => { fireEvent.click(screen.getByTestId('source-save')); });
        await waitFor(async () => expect(await queue()).toHaveLength(1));
        const [row] = await queue();
        await act(async () => { await mutationQueue.markRejectedUserReview(row.id!, 'This was changed from another phone first. Nothing was saved.', 'ShramSafal.FarmSetup.Conflict'); });
        const card = await screen.findByTestId(`source-${SOURCE_A}`);
        await waitFor(() => expect(within(card).getByTestId('setup-refused')).toHaveTextContent('हे दुसऱ्या फोनवरून आधीच बदललं आहे. तुमचा बदल जतन झाला नाही.'));
        expect(within(card).getByText('मुख्य विहीर')).toBeInTheDocument();
        expect(within(card).getByTestId('setup-see-new')).toHaveTextContent('नवीन माहिती पहा');
        await act(async () => { fireEvent.click(within(card).getByTestId('setup-redo')); });
        expect(await screen.findByTestId('source-name')).toHaveValue('माझं नाव');
        expect((await getDatabase().mutationQueue.get(row.id!))!.status).toBe('REJECTED_DROPPED');
    });

    it('English mode is English only on the farm set page (names he typed are the exception)', async () => {
        h.language = 'en';
        await new DexieFarmSetupRepository(getDatabase()).replaceFarms([farmSetupFromDto({ ...fullFarmDto(), waterSources: [{ ...(fullFarmDto().waterSources as Record<string, unknown>[])[0], name: 'Main well', motors: [{ ...((fullFarmDto().waterSources as Record<string, unknown>[])[0].motors as Record<string, unknown>[])[0], name: 'Pump' }] }] }, 'now')!.set]);
        render(<Page farmId={FARM_A} canEdit={false} />);
        fireEvent.click(await screen.findByTestId(`source-toggle-${SOURCE_A}`));
        const page = screen.getByTestId('hub-water-power');
        expect(page.textContent).not.toMatch(DEVANAGARI);
        expect(screen.getByTestId('setup-read-only')).toHaveTextContent('The owner or a person with permission can change this.');
    });
});
