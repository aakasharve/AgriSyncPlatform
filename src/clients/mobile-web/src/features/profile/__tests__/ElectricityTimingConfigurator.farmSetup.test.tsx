// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P5) - "वीज कधी असते?" on the FARM's timetable once the server has sent the
 * farm's set: the open farm's timetable (another farm's is never shown), saved WHOLE through `farmsetup.power_times.set` on the base revision the
 * phone last received (0 for a farm with none), the timetable's keys exactly the contract's; a waiting save says so (never "जतन झाली" while it is
 * only queued); a person who may not change the farm setup reads the times and cannot change them.
 */
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configure, act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined) } }));

import ElectricityTimingConfigurator from '../components/ElectricityTimingConfigurator';
import { VerificationStatus, type FarmerProfile } from '../../../domain/types/farm.types';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { DexieFarmSetupRepository } from '../../../infrastructure/storage/DexieFarmSetupRepository';
import { farmSetupFromDto } from '../../../infrastructure/storage/farmSetupRow';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { validatePayload } from '../../../infrastructure/sync/PayloadValidator';
import { useFarmSetup } from '../farmSetup/useFarmSetup';
import { FARM_A, FARM_B, emptyFarmDto, fullFarmDto } from '../../../infrastructure/storage/__tests__/farmSetupFixtures';

// The screens follow Dexie live queries: under a loaded whole-suite run an update can take longer than the 1 s default (seen 27 Nov), so the
// waits here allow 5 s. A wait that never comes still fails.
configure({ asyncUtilTimeout: 5000 });

const profile = { name: 'T', village: 'V', phone: '9', language: 'mr', verificationStatus: VerificationStatus.PhoneVerified, operators: [], waterResources: [], motors: [] } as unknown as FarmerProfile;

const Power: React.FC<{ farmId: string; canEdit?: boolean }> = ({ farmId, canEdit = true }) => {
    const farmSetup = useFarmSetup(farmId);
    const server = farmSetup?.received ? farmSetup : null;
    if (!farmSetup) return null;
    return <ElectricityTimingConfigurator profile={profile} onUpdate={vi.fn()} farmSetup={server} canEdit={canEdit} />;
};

const queue = async () => (await getDatabase().mutationQueue.toArray()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

beforeEach(async () => {
    await resetDatabase();
    const db = getDatabase();
    await Promise.all([db.mutationQueue.clear(), db.farmWaterSources.clear(), db.farmMachines.clear(), db.farmPowerTimes.clear(), db.plotWater.clear()]);
    await new DexieFarmSetupRepository(db).replaceFarms([farmSetupFromDto(fullFarmDto(), 'now')!.set, farmSetupFromDto(emptyFarmDto(FARM_B), 'now')!.set]);
});
afterEach(() => cleanup());

describe('वीज कधी असते on the farm set (P5)', () => {
    it('the timetable saved on farm A is not shown on farm B', async () => {
        const { rerender } = render(<Power farmId={FARM_A} />);
        expect(await screen.findByTestId('start-singlePhase-A')).toHaveValue('06:00');
        expect(screen.getByTestId('end-singlePhase-A')).toHaveValue('14:00');
        rerender(<Power farmId={FARM_B} />);
        expect(await screen.findByTestId('nocut-singlePhase-A')).toBeInTheDocument();
        expect(screen.queryByTestId('start-singlePhase-A')).not.toBeInTheDocument();
    });

    it('a save on a farm with no timetable goes whole on base revision 0, the contract keys exactly, and says it waits', async () => {
        render(<Power farmId={FARM_B} />);
        fireEvent.click(await screen.findByTestId('alternate-threePhase'));
        await act(async () => { fireEvent.click(screen.getByTestId('power-save')); });
        await waitFor(async () => expect(await queue()).toHaveLength(1));
        const [row] = await queue();
        expect(row.mutationType).toBe(SyncMutationName.FarmsetupPowerTimesSet);
        const p = row.payload as { farmId: string; baseRevision: number; timetable: Record<string, Record<string, unknown>> };
        expect(Object.keys(p).sort()).toEqual(['baseRevision', 'farmId', 'timetable']);
        expect(p).toMatchObject({ farmId: FARM_B, baseRevision: 0 });
        expect(Object.keys(p.timetable).sort()).toEqual(['singlePhase', 'threePhase']);
        expect(p.timetable.threePhase).toEqual({ patternMode: 'ROTATIONAL', alternateWeeklyPattern: true, weekAOffWindows: [], weekBOffWindows: [] });
        expect(validatePayload(row.mutationType, row.payload).ok).toBe(true);
        expect(await screen.findByTestId('setup-waiting')).toHaveTextContent('अजून सर्व्हरवर गेलं नाही — नेट आल्यावर जाईल.');
        expect(screen.queryByText('वीज वेळ जतन झाली ✓')).not.toBeInTheDocument();
    });

    it('an edit of the farm timetable sends the revision the phone last received', async () => {
        render(<Power farmId={FARM_A} />);
        fireEvent.change(await screen.findByTestId('end-singlePhase-A'), { target: { value: '15:00' } });
        await act(async () => { fireEvent.click(screen.getByTestId('power-save')); });
        await waitFor(async () => expect(await queue()).toHaveLength(1));
        const p = (await queue())[0].payload as { baseRevision: number; timetable: { singlePhase: { weekAOffWindows: { endTime: string }[] } } };
        expect(p.baseRevision).toBe(1);
        expect(p.timetable.singlePhase.weekAOffWindows[0].endTime).toBe('15:00');
    });

    it('a person who may not change the farm setup reads the times and cannot change them', async () => {
        render(<Power farmId={FARM_A} canEdit={false} />);
        expect(await screen.findByTestId('on-singlePhase-A')).toBeInTheDocument();
        expect(screen.queryByTestId('start-singlePhase-A')).not.toBeInTheDocument();
        expect(screen.queryByTestId('power-save')).not.toBeInTheDocument();
        expect(screen.queryByTestId('alternate-singlePhase')).not.toBeInTheDocument();
        expect(screen.queryByTestId('nocut-singlePhase-A')).not.toBeInTheDocument();
    });
});
