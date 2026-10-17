// @vitest-environment jsdom
/**
 * PR #82 review M2 (spec: 2026-08-25-prod-cutover-waves) — "बरोबर doesn't save the
 * name", on the बदल करा path.
 *
 * The labour door's बदल करा opens this form filled from the voice parse. The
 * hydration's voice overlay rebuilt each labour row FIELD BY FIELD and never named
 * `workerNames`, so every name the farmer gave was dropped before the form could
 * save it: the queued create_daily_log carried a crew of 4 with no names, and the
 * server (which now stores names, PR #83) had none to store.
 *
 * Driven through the REAL form (only leaf UI is stubbed; the CostStrip stub is the
 * save button) and then the REAL save chain on fake-indexeddb: LogFactory ->
 * confirmAndSave -> enqueueLogsForSync -> the queued payload, validated against the
 * canonical schema.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';

import type {
    AgriLogResponse, CropProfile, FarmContext as FarmSelectionContext, FarmerProfile, LedgerDefaults, LogScope,
} from '../../../../../types';

// ── leaf UI only (factories are hoisted — no top-level references inside) ─────
vi.mock('../components/ManualEntryHeader', () => ({ default: () => null }));
vi.mock('../components/UnclearSegmentsList', () => ({ default: () => null }));
vi.mock('../components/LabourReview', () => ({ default: () => null }));
vi.mock('../components/ActivityLedger', () => ({ default: () => null }));
vi.mock('../../ObservationHubSheet', () => ({ default: () => null }));
/** The save button: calls the REAL `handleSaveDay`. */
vi.mock('../components/CostStrip', () => ({
    default: (props: { onSaveDay: () => void }) =>
        React.createElement('button', { type: 'button', 'data-testid': 'save-day', onClick: props.onSaveDay }, 'save'),
}));

// ── side-effect boundaries (network / analytics / sync worker / session) ──────
vi.mock('../../../../../infrastructure/ai/CorrectionEventStore', () => ({
    buildAiCorrectionEvents: vi.fn(() => []),
    persistAiCorrectionEvents: vi.fn(async () => undefined),
    postAiCorrectionBlob: vi.fn(),
}));
vi.mock('../../../../../core/telemetry/eventEmitters', () => ({ emitClosureSubmitted: vi.fn() }));
vi.mock('../../../../voice/vocab/vocabStore', () => ({ loadVocabDB: vi.fn(() => ({})), addApprovedMapping: vi.fn() }));
vi.mock('../../../../../core/session/FarmContext', () => ({
    useFarmContext: () => ({ currentFarmId: 'f0000000-0000-4000-8000-000000000001' }),
}));
vi.mock('../../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../../../../infrastructure/storage/SessionStore', () => ({
    SessionStore: {
        getCurrentFarmId: () => 'f0000000-0000-4000-8000-000000000001',
        setCurrentFarmId: vi.fn(),
        clearCurrentFarmId: vi.fn(),
    },
}));

import ManualEntry from '../ManualEntry';
import { formWorkerNames } from '../hooks/useManualEntryHydration';
import { toAttendanceOnlyDraft } from '../../../attendanceDraft';
import { LogFactory } from '../../../../../core/domain/LogFactory';
import { LogCommandServiceImpl } from '../../../../../application/services/LogCommandService';
import { DexieLogsRepository } from '../../../../../infrastructure/storage/DexieLogsRepository';
import { getDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../../infrastructure/sync/SyncMutationCatalog';
import { validatePayload } from '../../../../../infrastructure/sync/PayloadValidator';
import { enqueueLogsForSync } from '../../../services/logSyncMutationService';

const FARM_ID = 'f0000000-0000-4000-8000-000000000001';
const CROP_ID = 'd0000000-0000-4000-8000-000000000001';
const PLOT_A = 'a0000000-0000-4000-8000-00000000000a';
const CYCLE_A = 'e0000000-0000-4000-8000-00000000000a';
const JOB = '11111111-2222-4333-8444-555555555555';
const NAMES = ['विलास जाधव', 'संतू रोकडे', 'बाळू कदम', 'अक्षय घाडगे'];

const CROPS = [{
    id: CROP_ID, name: 'Grapes', color: 'bg-emerald-500',
    plots: [{ id: PLOT_A, name: 'Plot A', baseline: {}, schedule: {}, infrastructure: {} }],
}] as unknown as CropProfile[];
const CONTEXT = {
    selection: [{ cropId: CROP_ID, cropName: 'Grapes', selectedPlotIds: [PLOT_A], selectedPlotNames: ['Plot A'] }],
} as unknown as FarmSelectionContext;
const SCOPE = { selectedPlotIds: [PLOT_A], selectedCropIds: [CROP_ID], mode: 'single', applyPolicy: 'broadcast' } as unknown as LogScope;
const PROFILE = { name: 'Purvesh', operators: [], activeOperatorId: 'owner' } as unknown as FarmerProfile;
const DEFAULTS = {
    irrigation: { method: 'drip', source: 'Well', defaultDuration: 2 },
    labour: { defaultWage: 300, defaultHours: 8, shifts: [] },
    machinery: { defaultRentalCost: 1000, defaultFuelCost: 200 },
} as LedgerDefaults;

/** The labour door's parse, as dictation arrives: padded names and a blank one. */
const PARSE = {
    summary: '', dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [], inputs: [],
    machinery: [], activityExpenses: [], missingSegments: [],
    labour: [{
        id: 'l1', type: 'hired', count: 4,
        workerNames: [' विलास जाधव ', 'संतू रोकडे', '   ', 'बाळू कदम', 'अक्षय घाडगे '],
        sourceText: 'Vilas Jadhav, Santu Rokade, Balu Kadam आणि Akshay Ghadge',
    }],
} as unknown as AgriLogResponse;

async function seedReferenceData() {
    const db = getDatabase();
    await db.farms.bulkPut([{ id: FARM_ID, payload: { id: FARM_ID }, updatedAt: '2026-08-01T00:00:00.000Z' }] as never);
    await db.plots.bulkPut([{
        id: PLOT_A, payload: { id: PLOT_A, farmId: FARM_ID, name: 'Plot A' }, modifiedAtUtc: '2026-08-01T00:00:00.000Z',
    }] as never);
    await db.cropCycles.bulkPut([{
        id: CYCLE_A, plotId: PLOT_A,
        payload: { id: CYCLE_A, plotId: PLOT_A, farmId: FARM_ID, cropName: 'Grapes', startDate: '2025-06-01', modifiedAtUtc: '2026-08-01T00:00:00.000Z' },
        modifiedAtUtc: '2026-08-01T00:00:00.000Z',
    }] as never);
}

/** Open the बदल करा form exactly as mainView does on the labour door, and press save. */
function saveFromTheLabourDoorEditForm(): Record<string, unknown> {
    const onSubmit = vi.fn();
    render(
        <ManualEntry
            context={CONTEXT}
            crops={CROPS}
            defaults={DEFAULTS}
            profile={PROFILE}
            onSubmit={onSubmit}
            initialData={toAttendanceOnlyDraft(PARSE)}
            attendanceOnly
            provenance={{ source: 'ai', sourceAiJobId: JOB, timestamp: '2026-10-17T05:00:00.000Z' }}
            captureScope="labour"
            onDataConsumed={vi.fn()}
            todayLogs={[]}
        />,
    );
    fireEvent.click(screen.getByTestId('save-day'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    return onSubmit.mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(async () => {
    window.alert = vi.fn();
    window.confirm = vi.fn(() => true);
    const db = getDatabase();
    await db.mutationQueue.clear();
    await db.logs.clear();
    await db.farms.clear();
    await db.plots.clear();
    await db.cropCycles.clear();
    localStorage.clear();
    await seedReferenceData();
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('बदल करा on the labour door keeps the names (M2)', () => {
    it('the form hands the save path the names the parse heard (trimmed, blank shed)', () => {
        const submitted = saveFromTheLabourDoorEditForm();
        const labour = submitted.labour as Array<{ workerNames?: string[]; count?: number }>;
        expect(labour).toHaveLength(1);
        expect(labour[0].workerNames).toEqual(NAMES);
        expect(labour[0].count).toBe(4); // P7: the names never change the count
    });

    it('end to end: the queued create_daily_log carries the names and the labour scope', async () => {
        const submitted = saveFromTheLabourDoorEditForm();

        // The production chain handleManualSubmit runs for a new log.
        const logs = LogFactory.createFromManualEntry(submitted as never, SCOPE, CROPS, PROFILE);
        await new LogCommandServiceImpl(DexieLogsRepository.getInstance()).confirmAndSave(logs);
        const outcome = await enqueueLogsForSync(logs);
        await new Promise(resolve => setTimeout(resolve, 0)); // fire-and-forget money capture
        expect(outcome.queuedLogIds).toEqual([logs[0].id]);

        const rows = await getDatabase().mutationQueue
            .where('mutationType').equals(SyncMutationName.CreateDailyLog).toArray();
        expect(rows).toHaveLength(1);
        const wire = rows[0].payload as Record<string, unknown> & {
            labour?: Array<{ workerNames?: string[]; workerCount?: number }>;
        };
        expect(validatePayload(SyncMutationName.CreateDailyLog, wire)).toEqual({ ok: true });
        expect(wire.labour![0].workerNames).toEqual(NAMES);
        expect(wire.labour![0].workerCount).toBe(4);
        expect(wire.captureScope).toBe('labour');
        expect(wire.sourceAiJobId).toBe(JOB);
    });
});

describe('formWorkerNames — the payload builder\'s trim/blank rule, in the form', () => {
    it('trims, sheds blanks and non-strings, keeps duplicates and order', () => {
        expect(formWorkerNames([' बाळू ', '', '  ', 'बाळू', 7, 'गणेश'])).toEqual(['बाळू', 'बाळू', 'गणेश']);
    });
    it('nobody named -> undefined (the key is not carried)', () => {
        expect(formWorkerNames(undefined)).toBeUndefined();
        expect(formWorkerNames([])).toBeUndefined();
        expect(formWorkerNames(['  ', ''])).toBeUndefined();
    });
});
