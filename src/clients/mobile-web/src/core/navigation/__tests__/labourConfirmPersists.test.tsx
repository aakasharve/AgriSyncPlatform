/**
 * APK 1.0.14 founder report (spec: 2026-08-25-prod-cutover-waves):
 * "I can't tap on बरोबर; it doesn't save the name."
 *
 * THE DEFECT. The labour door's बरोबर handed the RAW parse (`AgriLogResponse`)
 * to `handleManualSubmit`, which builds the record from the MANUAL-ENTRY shape.
 * A parse has no `date` and no `provenance`, so:
 *   - the record was written to the phone with no date;
 *   - `create_daily_log` was refused at the queue (`logDate Required`), so
 *     nothing was ever sent to the server;
 *   - the save threw before its route back to Labour, so the screen stayed put;
 *   - with no queued work behind it, the record's worker names were hidden on
 *     every read (the 7-day downloaded-names rule shows names only for unsent
 *     work or a fresh download).
 *
 * WHY THIS RUNS THE REAL CHAIN. The wiring (`mainView` -> `onConfirm`) and the
 * save (`LogFactory` -> `confirmAndSave` -> `enqueueLogsForSync` -> queue
 * validation -> repository read) were each fine on their own; the hole was the
 * hand-off between them. So the payload is taken from the REAL `renderLogView`
 * wiring and run through the same production chain `entireFarmJourney.test.ts`
 * uses: real Dexie (fake-indexeddb), the real queue and the real canonical
 * payload schema.
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { renderLogView } from '../mainView';
import type { AppRouterContext } from '../routeContext';
import AttendanceResult, { type AttendanceResultProps } from '../../../features/labour/components/AttendanceResult';
import { LogFactory } from '../../domain/LogFactory';
import { getDateKey } from '../../domain/services/DateKeyService';
import { LogCommandServiceImpl } from '../../../application/services/LogCommandService';
import { DexieLogsRepository } from '../../../infrastructure/storage/DexieLogsRepository';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { validatePayload } from '../../../infrastructure/sync/PayloadValidator';
import { enqueueLogsForSync } from '../../../features/logs/services/logSyncMutationService';
import type { AgriLogResponse, CropProfile, FarmerProfile, LogScope } from '../../../types';

vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn().mockResolvedValue(undefined) },
}));

const FARM_ID = 'f0000000-0000-4000-8000-000000000001';
const CROP_ID = 'd0000000-0000-4000-8000-000000000001';
const PLOT_A = 'a0000000-0000-4000-8000-00000000000a';
const CYCLE_A = 'e0000000-0000-4000-8000-00000000000a';
const AI_JOB_ID = '11111111-2222-4333-8444-555555555555';

vi.mock('../../../infrastructure/storage/SessionStore', () => ({
    SessionStore: {
        getCurrentFarmId: () => 'f0000000-0000-4000-8000-000000000001',
        setCurrentFarmId: vi.fn(),
        clearCurrentFarmId: vi.fn(),
    },
}));

const NAMES = ['विलास जाधव', 'संतू रोकडे', 'बाळू कदम', 'अक्षय घाडगे'];

/** What the voice parse hands the labour door: four named people, nothing else. */
const parsed = {
    summary: '', dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [], inputs: [],
    machinery: [], activityExpenses: [], missingSegments: [],
    labour: [{
        id: 'l1', type: 'hired', count: 4, workerNames: NAMES,
        sourceText: 'Vilas Jadhav, Santu Rokade, Balu Kadam आणि Akshay Ghadge',
    }],
} as unknown as AgriLogResponse;

const provenance = { source: 'ai' as const, sourceAiJobId: AI_JOB_ID, timestamp: '2026-10-17T05:00:00.000Z' };

const grapes = { id: CROP_ID, name: 'Grapes', plots: [{ id: PLOT_A, name: 'Plot A' }] } as unknown as CropProfile;
const plotScope = { selectedPlotIds: [PLOT_A], selectedCropIds: [CROP_ID], mode: 'single', applyPolicy: 'broadcast' } as unknown as LogScope;
const owner = { activeOperatorId: 'owner' } as unknown as FarmerProfile;

function findByType(node: React.ReactNode, type: unknown): React.ReactElement | null {
    if (!React.isValidElement(node)) {
        if (Array.isArray(node)) {
            for (const child of node) { const hit = findByType(child, type); if (hit) return hit; }
        }
        return null;
    }
    if (node.type === type) return node;
    const children = (node.props as { children?: React.ReactNode }).children;
    return children ? findByType(children, type) : null;
}

/** The labour door exactly as the founder had it: idle, manual, labour intent, a parse waiting. */
function labourDoorCtx(handleManualSubmit: (d: unknown) => unknown): AppRouterContext {
    return {
        currentRoute: 'main', mainView: 'log', status: 'idle', mode: 'manual', logIntent: 'labour',
        recordingSegment: null, crops: [grapes], logScope: plotScope,
        setLogScope: vi.fn(), setMode: vi.fn(), setStatus: vi.fn(), setCurrentRoute: vi.fn(), setMainView: vi.fn(),
        hasActiveLogContext: true, isContextReady: true, error: null, errorTranscript: null,
        handleAudioReady: vi.fn(), handleTextReady: vi.fn(), handleManualSubmit,
        currentLogContext: { selection: [] }, ledgerDefaults: {}, farmerProfile: {},
        draftLog: parsed, setDraftLog: vi.fn(), provenance,
        voiceStreamingPhase: 'idle', liveCaption: '', continuityLevel: null, savedPendingCaptureId: null,
        getTodayCounts: vi.fn(() => ({})), getContextColorIndicator: vi.fn(() => null),
        plannedTasks: [], handleUpdateTask: vi.fn(), history: [], todayLogs: [], operatorNameById: {},
        getLogContextSnapshot: vi.fn(), handleEditLog: vi.fn(), costSnapshot: { today: 0, cropSoFar: 0 },
        yesterdayCost: 0, setRecordingSegment: vi.fn(), lastSavedLogSummary: null, lastSavedLogIds: [],
        mockHistory: [], handleReset: vi.fn(), todayDayState: { pendingCount: 0, closurePercent: 0 },
        weatherData: null,
    } as unknown as AppRouterContext;
}

/** Press बरोबर through the real wiring; return what reached the save path. */
function pressConfirm(): Record<string, unknown> {
    const submit = vi.fn();
    const node = renderLogView(labourDoorCtx(submit));
    const result = findByType(node, AttendanceResult) as React.ReactElement<AttendanceResultProps> | null;
    expect(result, 'the labour door must land on AttendanceResult').not.toBeNull();
    result!.props.onConfirm(result!.props.draft);
    expect(submit).toHaveBeenCalledTimes(1);
    return submit.mock.calls[0][0] as Record<string, unknown>;
}

async function seedReferenceData() {
    const db = getDatabase();
    await db.farms.bulkPut([{ id: FARM_ID, payload: { id: FARM_ID }, updatedAt: '2026-08-01T00:00:00.000Z' }] as never);
    await db.plots.bulkPut([{
        id: PLOT_A, payload: { id: PLOT_A, farmId: FARM_ID, name: 'Plot A' }, modifiedAtUtc: '2026-08-01T00:00:00.000Z',
    }] as never);
    await db.cropCycles.bulkPut([{
        id: CYCLE_A, plotId: PLOT_A,
        payload: { id: CYCLE_A, plotId: PLOT_A, farmId: FARM_ID, cropName: 'Grapes', startDate: '2026-01-01', modifiedAtUtc: '2026-08-01T00:00:00.000Z' },
        modifiedAtUtc: '2026-08-01T00:00:00.000Z',
    }] as never);
}

describe('बरोबर on the labour door saves the day, and the names with it (APK 1.0.14 report)', () => {
    beforeEach(async () => {
        const db = getDatabase();
        await db.mutationQueue.clear();
        await db.logs.clear();
        await db.farms.clear();
        await db.plots.clear();
        await db.cropCycles.clear();
        localStorage.clear();
        await seedReferenceData();
    });

    it('hands the save path the two fields ManualEntry adds: today\'s date and the parse\'s own provenance', () => {
        const payload = pressConfirm();
        expect(payload.date).toBe(getDateKey());
        expect(payload.provenance).toEqual(provenance);
        // The names the farmer saw are what is handed on — nothing dropped, nothing added.
        expect((payload.labour as Array<{ workerNames?: string[] }>)[0].workerNames).toEqual(NAMES);
    });

    it('the record is QUEUED for the server with a valid create_daily_log, and the names stay readable', async () => {
        const payload = pressConfirm();

        // The production chain handleManualSubmit runs for a new log.
        const logs = LogFactory.createFromManualEntry(payload as never, plotScope, [grapes], owner);
        await new LogCommandServiceImpl(DexieLogsRepository.getInstance()).confirmAndSave(logs);
        const outcome = await enqueueLogsForSync(logs);
        await new Promise(resolve => setTimeout(resolve, 0)); // fire-and-forget money capture

        expect(outcome.queuedLogIds).toEqual([logs[0].id]);
        expect(outcome.skippedLogIds).toEqual([]);

        const rows = await getDatabase().mutationQueue
            .where('mutationType').equals(SyncMutationName.CreateDailyLog).toArray();
        expect(rows).toHaveLength(1);
        const wire = rows[0].payload as { logDate?: string; sourceAiJobId?: string; labour?: unknown[] };
        expect(validatePayload(SyncMutationName.CreateDailyLog, wire)).toEqual({ ok: true });
        expect(wire.logDate).toBe(getDateKey());
        // The parse job travels, so the server can link the confirm to what was heard.
        expect(wire.sourceAiJobId).toBe(AI_JOB_ID);
        expect(wire.labour).toHaveLength(1);

        // Re-read through the production repository: with the work queued, the
        // names are the farmer's own unsent record and are shown.
        const [stored] = await DexieLogsRepository.getInstance().getAll();
        expect(stored.date).toBe(getDateKey());
        expect(stored.labour[0].workerNames).toEqual(NAMES);
    });
});
