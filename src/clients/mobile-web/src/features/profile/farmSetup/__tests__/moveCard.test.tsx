// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P10; contract §6) - the move of what this phone held before. Never by itself;
 * one farm -> the card; several -> "ही माहिती कोणत्या शेताची आहे?" first; none -> the note and nothing sent; demo ids never offered; a farm already
 * filled -> his items UNTICKED; ids stripped of their prefix so a second run makes the same ids; "आत्ता नको" keeps a small row until he sends or
 * dismisses it.
 */
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));
vi.mock('../../../../i18n/LanguageContext', async importOriginal => ({
    ...(await importOriginal<typeof import('../../../../i18n/LanguageContext')>()),
    useOptionalLanguage: () => ({ language: 'mr' }),
}));

import { MoveCard } from '../MoveCard';
import { readMoveFlag } from '../moveModel';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { DexieFarmSetupRepository } from '../../../../infrastructure/storage/DexieFarmSetupRepository';
import { farmSetupFromDto } from '../../../../infrastructure/storage/farmSetupRow';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { FARM_A, FARM_B, emptyFarmDto, fullFarmDto } from '../../../../infrastructure/storage/__tests__/farmSetupFixtures';
import { VerificationStatus, type FarmerProfile } from '../../../../domain/types/farm.types';

// The screens follow Dexie live queries: under a loaded whole-suite run an update can take longer than the 1 s default (seen 27 Nov), so the
// waits here allow 5 s. A wait that never comes still fails.
configure({ asyncUtilTimeout: 5000 });

const ME = '0a0a0a0a-0000-4000-8000-00000000000a';
const W = '11111111-2222-4333-8444-555555555551';
const M = '11111111-2222-4333-8444-555555555552';
const MACH = '11111111-2222-4333-8444-555555555553';
const cut = { id: 'off_1', startTime: '06:00', endTime: '10:00', repeatRule: 'DAILY' as const, days: ['Mon'] };
const profile = (over: Partial<FarmerProfile> = {}): FarmerProfile => ({
    name: 'T', village: 'V', phone: '9', language: 'mr', verificationStatus: VerificationStatus.PhoneVerified, operators: [],
    waterResources: [{ id: `w_${W}`, name: 'जुनी विहीर', type: 'Well', isAvailable: true }, { id: 'water_main_well', name: 'डेमो विहीर', type: 'Well', isAvailable: true }],
    motors: [{ id: `m_${M}`, name: '5 HP', hp: 5, phase: '3', powerSourceType: 'MSEB', linkedWaterSourceId: `w_${W}`, schedule: { windowStart: '22:00', windowEnd: '06:00', days: ['Daily'], rotationType: 'Weekly' } }],
    machineries: [{ id: `mach_${MACH}`, name: 'जुना ट्रॅक्टर', type: 'Tractor', ownership: 'Owned', defaultOperatorId: 'op1' }],
    electricityTiming: {
        singlePhase: { patternMode: 'FIXED_WEEKLY', alternateWeeklyPattern: false, weekAOffWindows: [cut], weekBOffWindows: [] },
        threePhase: { patternMode: 'FIXED_WEEKLY', alternateWeeklyPattern: false, weekAOffWindows: [], weekBOffWindows: [] },
        savedByFarmerAt: '2026-11-01T00:00:00Z',
    },
    ...over,
} as unknown as FarmerProfile);
const farms = { a: { farmId: FARM_A, name: 'अर्वे मळा' }, b: { farmId: FARM_B, name: 'नदीकाठ' } };
const queue = async () => (await getDatabase().mutationQueue.toArray()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

beforeEach(async () => {
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.farmWaterSources.clear(), db.farmMachines.clear(), db.farmPowerTimes.clear(), db.plotWater.clear(), db.appMeta.clear()]);
    await new DexieFarmSetupRepository(db).replaceFarms([farmSetupFromDto(fullFarmDto(), 'now')!.set, farmSetupFromDto(emptyFarmDto(FARM_B), 'now')!.set]);
});
afterEach(() => cleanup());

describe('the move of what this phone held before (P10)', () => {
    it('an owner of two farms is asked which farm, and nothing is sent before he answers', async () => {
        render(<MoveCard profile={profile()} userId={ME} editableFarms={[farms.a, farms.b]} />);
        expect(await screen.findByTestId('move-which-farm')).toHaveTextContent('ही माहिती कोणत्या शेताची आहे?');
        expect(screen.getByTestId('move-no-farm')).toHaveTextContent('कोणत्याही नाही');
        expect(await queue()).toHaveLength(0);
        fireEvent.click(screen.getByTestId(`move-farm-${FARM_B}`));
        const card = await screen.findByTestId('move-card');
        expect(card).toHaveTextContent('या फोनवर भरलेली पाणी, मोटर, वीज आणि यंत्रांची माहिती नदीकाठ या शेतासाठी सर्व्हरवर पाठवायची का?');
        expect(card).not.toHaveTextContent('डेमो विहीर');
        expect(await queue()).toHaveLength(0);
        await act(async () => { fireEvent.click(screen.getByTestId('move-send')); });
        await waitFor(async () => expect(await queue()).toHaveLength(3));
        const rows = await queue();
        expect(rows.map(r => r.mutationType)).toEqual([SyncMutationName.FarmsetupWaterSourceSave, SyncMutationName.FarmsetupPowerTimesSet, SyncMutationName.FarmsetupMachineSave]);
        expect(rows[0].payload).toEqual({
            farmId: FARM_B, waterSourceId: W, baseRevision: 0, name: 'जुनी विहीर', sourceType: 'well', isAvailable: true,
            motors: [{ motorId: M, name: '5 HP', hp: 5, phase: 3, powerSource: 'mseb' }],
        });
        expect(rows[2].payload).toEqual({ farmId: FARM_B, machineId: MACH, baseRevision: 0, name: 'जुना ट्रॅक्टर', machineType: 'tractor', ownership: 'owned' });
        expect((await readMoveFlag(getDatabase(), ME))).toMatchObject({ state: 'sent', farmId: FARM_B });
    });

    it('may edit on one farm: the card at once; the farm already has a set: his items are listed UNTICKED', async () => {
        render(<MoveCard profile={profile()} userId={ME} editableFarms={[farms.a]} />);
        const card = await screen.findByTestId('move-card');
        await waitFor(() => expect(card).toHaveTextContent('या शेताची माहिती आधीच भरलेली आहे. यातलं काही जोडायचं असेल तर निवडा.'));
        expect(screen.getByTestId(`move-item-source:${W}`)).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByTestId('move-item-power')).toHaveAttribute('aria-pressed', 'false');
        await act(async () => { fireEvent.click(screen.getByTestId('move-send')); });
        expect(await queue()).toHaveLength(0);
    });

    it('may edit on no farm: nothing is sent; his set stays on the phone with the note', async () => {
        render(<MoveCard profile={profile()} userId={ME} editableFarms={[]} />);
        expect(await screen.findByTestId('move-phone-only')).toHaveTextContent('ही माहिती फक्त या फोनवर आहे. शेताची रचना बदलू शकणारी व्यक्तीच ती शेतासाठी पाठवू शकते.');
        expect(screen.queryByTestId('move-send')).not.toBeInTheDocument();
        expect(await queue()).toHaveLength(0);
    });

    it('demo values alone: nothing is offered', async () => {
        const demoOnly = profile({ waterResources: [{ id: 'water_main_well', name: 'डेमो', type: 'Well', isAvailable: true }], motors: [], machineries: [], electricityTiming: undefined });
        const { container } = render(<MoveCard profile={demoOnly} userId={ME} editableFarms={[farms.b]} />);
        await act(async () => { await new Promise(r => setTimeout(r, 20)); });
        expect(container).toBeEmptyDOMElement();
    });

    it('"आत्ता नको" keeps a small row; a second run makes the same ids', async () => {
        const { unmount } = render(<MoveCard profile={profile()} userId={ME} editableFarms={[farms.b]} />);
        fireEvent.click(await screen.findByTestId('move-not-now'));
        expect(await screen.findByTestId('move-old-row')).toHaveTextContent('या फोनवरची जुनी माहिती');
        expect(await queue()).toHaveLength(0);
        fireEvent.click(screen.getByTestId('move-old-open'));
        const send = await screen.findByTestId('move-send');
        await act(async () => { fireEvent.click(send); });
        await waitFor(async () => expect(await queue()).toHaveLength(3));
        unmount();
        await getDatabase().appMeta.clear();
        render(<MoveCard profile={profile()} userId={ME} editableFarms={[farms.b]} />);
        const again = await screen.findByTestId('move-send');
        await act(async () => { fireEvent.click(again); });
        await waitFor(async () => expect((await queue()).filter(r => r.mutationType === SyncMutationName.FarmsetupWaterSourceSave)).toHaveLength(1));
        // the second send replaced the waiting first one (same ids), it did not make a double
        expect((await queue()).filter(r => r.status === 'PENDING').map(r => (r.payload as { waterSourceId?: string }).waterSourceId).filter(Boolean)).toEqual([W]);
    });
});
