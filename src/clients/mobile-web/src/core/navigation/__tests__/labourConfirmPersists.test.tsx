/**
 * APK 1.0.14 founder report (spec: 2026-08-25-prod-cutover-waves):
 * "I can't tap on बरोबर; it doesn't save the name."
 *
 * THE DEFECT. The labour door's बरोबर handed the RAW parse (`AgriLogResponse`)
 * to `handleManualSubmit`, which builds the record from the MANUAL-ENTRY shape.
 * A parse has no `date`, so:
 *   - the record was written to the phone with no date;
 *   - `create_daily_log` was refused at the queue (`logDate Required`), so
 *     nothing was ever sent to the server;
 *   - the save threw before its route back to Labour, so the screen stayed put;
 *   - with no queued work behind it, the record's worker names were hidden on
 *     every read (the 7-day downloaded-names rule shows names only for unsent
 *     work or a fresh download).
 *
 * PR #82 REVIEW, pinned here end to end:
 *   - B003: the record (and its marks) is filed under the day he SPOKE (the
 *     parse's capture timestamp), not the day he pressed बरोबर;
 *   - B004: LABOUR ONLY: what the parse also heard (observations, planned
 *     tasks, its dayOutcome, a disturbance, the transcript) is not saved;
 *   - B005: only the provenance BOUND TO THIS DRAFT is used, never the voice
 *     state's last one (which an edit opened from Reflect would inherit);
 *   - captureScope: the record says it came from the labour door (not sent yet).
 *
 * WHY THIS RUNS THE REAL CHAIN. The payload is taken from the REAL
 * `renderLogView` wiring and run through the same production chain
 * `entireFarmJourney.test.ts` uses: real Dexie (fake-indexeddb), the real
 * queue and the real canonical payload schema.
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { renderLogView } from '../mainView';
import type { AppRouterContext } from '../routeContext';
import AttendanceResult, { type AttendanceResultProps } from '../../../features/labour/components/AttendanceResult';
import ManualEntry from '../../../features/logs/components/ManualEntry';
import { LabourResultHost } from '../mainView';
import { bindDraftProvenance } from '../../../features/voice/draftProvenance';
import { LogFactory } from '../../domain/LogFactory';
import { getDateKey } from '../../domain/services/DateKeyService';
import { LogCommandServiceImpl } from '../../../application/services/LogCommandService';
import { DexieLogsRepository } from '../../../infrastructure/storage/DexieLogsRepository';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { validatePayload } from '../../../infrastructure/sync/PayloadValidator';
import { enqueueLogsForSync } from '../../../features/logs/services/logSyncMutationService';
import type { LogProvenance } from '../../../domain/ai/LogProvenance';
import type { AgriLogResponse, CropProfile, DailyLog, FarmerProfile, LogScope } from '../../../types';

vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn().mockResolvedValue(undefined) },
}));

const FARM_ID = 'f0000000-0000-4000-8000-000000000001';
const CROP_ID = 'd0000000-0000-4000-8000-000000000001';
const PLOT_A = 'a0000000-0000-4000-8000-00000000000a';
const CYCLE_A = 'e0000000-0000-4000-8000-00000000000a';

vi.mock('../../../infrastructure/storage/SessionStore', () => ({
    SessionStore: {
        getCurrentFarmId: () => 'f0000000-0000-4000-8000-000000000001',
        setCurrentFarmId: vi.fn(),
        clearCurrentFarmId: vi.fn(),
    },
}));

const NAMES = ['विलास जाधव', 'संतू रोकडे', 'बाळू कदम', 'अक्षय घाडगे'];

/**
 * THIS draft's parse: spoken at 23:50 IST on 5 Jan 2026 (18:20Z), so whatever
 * day this test runs, the tap day is a different day.
 */
const OWN: LogProvenance = { source: 'ai', sourceAiJobId: '11111111-2222-4333-8444-555555555555', timestamp: '2026-01-05T18:20:00.000Z' };
const CAPTURE_DAY = '2026-01-05';
/** An earlier, unrelated parse still held by the voice state. */
const STALE: LogProvenance = { source: 'ai', sourceAiJobId: '99999999-8888-4777-8666-555555555555', timestamp: '2025-12-01T05:00:00.000Z' };

/** What the voice parse hands the labour door: four named people, plus things the card does not show. */
const parse = (): AgriLogResponse => ({
    summary: 'चार जण आले, पाऊस पडला', dayOutcome: 'DISTURBANCE_RECORDED',
    cropActivities: [], irrigation: [], inputs: [], machinery: [], activityExpenses: [], missingSegments: [],
    fullTranscript: 'Vilas Jadhav, Santu Rokade, Balu Kadam आणि Akshay Ghadge आले, पाऊस पडला, उद्या फवारणी',
    observations: [{ textRaw: 'पाऊस पडला', noteType: 'observation' }],
    plannedTasks: [{ title: 'उद्या फवारणी', category: 'general', sourceText: 'उद्या फवारणी', systemInterpretation: '' }],
    disturbance: { scope: 'PARTIAL', blockedSegments: [], reason: 'rain' },
    labour: [{
        id: 'l1', type: 'hired', count: 4, workerNames: NAMES,
        sourceText: 'Vilas Jadhav, Santu Rokade, Balu Kadam आणि Akshay Ghadge',
    }],
} as unknown as AgriLogResponse);

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

/** The labour door exactly as the founder had it: idle, manual, labour intent, a draft waiting. */
function labourDoorCtx(draftLog: AgriLogResponse, handleManualSubmit: (d: unknown) => unknown, extra: Record<string, unknown> = {}): AppRouterContext {
    return {
        currentRoute: 'main', mainView: 'log', status: 'idle', mode: 'manual', logIntent: 'labour',
        recordingSegment: null, crops: [grapes], logScope: plotScope,
        setLogScope: vi.fn(), setMode: vi.fn(), setStatus: vi.fn(), setCurrentRoute: vi.fn(), setMainView: vi.fn(),
        hasActiveLogContext: true, isContextReady: true, error: null, errorTranscript: null,
        handleAudioReady: vi.fn(), handleTextReady: vi.fn(), handleManualSubmit,
        currentLogContext: { selection: [] }, ledgerDefaults: {}, farmerProfile: {},
        // The voice state's provenance is the STALE one in every test: the
        // labour door must never read it.
        draftLog, setDraftLog: vi.fn(), provenance: STALE,
        voiceStreamingPhase: 'idle', liveCaption: '', continuityLevel: null, savedPendingCaptureId: null,
        getTodayCounts: vi.fn(() => ({})), getContextColorIndicator: vi.fn(() => null),
        plannedTasks: [], handleUpdateTask: vi.fn(), history: [], todayLogs: [], operatorNameById: {},
        getLogContextSnapshot: vi.fn(), handleEditLog: vi.fn(), costSnapshot: { today: 0, cropSoFar: 0 },
        yesterdayCost: 0, setRecordingSegment: vi.fn(), lastSavedLogSummary: null, lastSavedLogIds: [],
        mockHistory: [], handleReset: vi.fn(), todayDayState: { pendingCount: 0, closurePercent: 0 },
        weatherData: null,
        ...extra,
    } as unknown as AppRouterContext;
}

/** Press बरोबर through the real wiring; return what reached the save path and the screen's props. */
function pressConfirm(draftLog: AgriLogResponse): { payload: Record<string, unknown>; props: AttendanceResultProps } {
    const submit = vi.fn();
    const node = renderLogView(labourDoorCtx(draftLog, submit));
    const result = findByType(node, AttendanceResult) as React.ReactElement<AttendanceResultProps> | null;
    expect(result, 'the labour door must land on AttendanceResult').not.toBeNull();
    result!.props.onConfirm(result!.props.draft);
    expect(submit).toHaveBeenCalledTimes(1);
    return { payload: submit.mock.calls[0][0] as Record<string, unknown>, props: result!.props };
}

/** A parse draft, bound to its own provenance the way useVoiceRecorder binds it. */
const parsedDraft = () => bindDraftProvenance(parse(), OWN);

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

describe('बरोबर on the labour door (APK 1.0.14 report + PR #82 review)', () => {
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

    it('B004 + captureScope: hands the save path labour only, dated, scoped, attributed', () => {
        const { payload } = pressConfirm(parsedDraft());
        expect(Object.keys(payload).sort()).toEqual(['captureScope', 'date', 'labour', 'provenance']);
        expect(payload.captureScope).toBe('labour');
        expect((payload.labour as Array<{ workerNames?: string[] }>)[0].workerNames).toEqual(NAMES);
    });

    it('B003: the record and its marks are for the day he SPOKE, not the day he pressed', () => {
        const { payload, props } = pressConfirm(parsedDraft());
        expect(payload.date).toBe(CAPTURE_DAY);
        expect(props.workDate).toBe(CAPTURE_DAY);
    });

    it('B005: only THIS draft\'s provenance is used, never the voice state\'s last one', () => {
        expect(pressConfirm(parsedDraft()).payload.provenance).toEqual(OWN);
        // A draft no parse produced (an edit opened from Reflect): no provenance at all,
        // even though the voice state still holds STALE. Filed today, nothing borrowed.
        const reflectEdit = pressConfirm(parse());
        expect(reflectEdit.payload).not.toHaveProperty('provenance');
        expect(reflectEdit.payload.date).toBe(getDateKey());
    });

    it('end to end: QUEUED as a valid create_daily_log for the capture day, labour only, names readable', async () => {
        const { payload } = pressConfirm(parsedDraft());

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
        const wire = rows[0].payload as Record<string, unknown> & { labour?: unknown[] };
        expect(validatePayload(SyncMutationName.CreateDailyLog, wire)).toEqual({ ok: true });
        expect(wire.logDate).toBe(CAPTURE_DAY);
        expect(wire.sourceAiJobId).toBe(OWN.sourceAiJobId);
        expect(wire.labour).toHaveLength(1);
        // Not on the wire until the contract carries it (PR #83).
        expect(wire).not.toHaveProperty('captureScope');

        // Re-read through the production repository.
        const [stored] = await DexieLogsRepository.getInstance().getAll();
        expect(stored.date).toBe(CAPTURE_DAY);
        expect(stored.captureScope).toBe('labour');
        expect(stored.labour[0].workerNames).toEqual(NAMES); // queued work: the farmer's own names are shown
        // B004 end to end: nothing the card did not show reached the record.
        expect(stored.observations ?? []).toEqual([]);
        expect(stored.plannedTasks ?? []).toEqual([]);
        expect(stored.disturbance).toBeUndefined();
        expect(stored.fullTranscript).toBeUndefined();
        expect(stored.dayOutcome).toBe('WORK_RECORDED'); // derived from the labour, not the parser's DISTURBANCE_RECORDED
    });
});

// ─── PR #82 re-review follow-ups (R1, R2) ──────────────────────────────────
type ManualEntryElementProps = { provenance?: LogProvenance | null; captureScope?: string; recordedDateKey?: string; attendanceOnly?: boolean };

function confirmCard(draftLog: AgriLogResponse, extra: Record<string, unknown> = {}): AttendanceResultProps {
    const node = renderLogView(labourDoorCtx(draftLog, vi.fn(), extra));
    const result = findByType(node, AttendanceResult) as React.ReactElement<AttendanceResultProps> | null;
    expect(result).not.toBeNull();
    return result!.props;
}

/** An accepted log of 6 people on the CAPTURE day, on another farm than the context's. */
const CAPTURE_DAY_FARM = 'f0000000-0000-4000-8000-0000000000c1';
const captureDayLog = {
    id: 'log-capture-day', date: CAPTURE_DAY, context: { selection: [] },
    cropActivities: [], irrigation: [], inputs: [], machinery: [],
    labour: [{ id: 'x1', type: 'HIRED', count: 6 }],
    verification: { status: 'APPROVED' },
    meta: { farmId: CAPTURE_DAY_FARM },
} as unknown as DailyLog;

describe("R1: the confirm card compares against the CAPTURE day's record", () => {
    it('the anchor (headcount-disagreement source) and its farm come from the day he spoke', () => {
        const props = confirmCard(parsedDraft(), { history: [captureDayLog] });
        expect(props.anchor).toEqual({ state: 'anchored', headcount: 6, logId: 'log-capture-day' });
        expect(props.farmId).toBe(CAPTURE_DAY_FARM);
    });
});

describe('R2: the बदल करा edit form on the labour door', () => {
    it("takes THIS draft's own provenance, the capture day, and captureScope 'labour'", () => {
        const edit = findByType(confirmCard(parsedDraft()).renderEditSurface(), ManualEntry) as React.ReactElement<ManualEntryElementProps> | null;
        expect(edit).not.toBeNull();
        expect(edit!.props.attendanceOnly).toBe(true);
        expect(edit!.props.provenance).toEqual(OWN);
        expect(edit!.props.recordedDateKey).toBe(CAPTURE_DAY);
        expect(edit!.props.captureScope).toBe('labour');
    });

    it("a draft no parse produced (opened from Reflect) gets NO provenance, never the voice state's stale one", () => {
        const edit = findByType(confirmCard(parse()).renderEditSurface(), ManualEntry) as React.ReactElement<ManualEntryElementProps> | null;
        expect(edit!.props.provenance).toBeUndefined();
        expect(edit!.props.captureScope).toBe('labour');
    });

    it("the labour door's fall-through form (no labour heard) is labour-scoped too", () => {
        const node = renderLogView(labourDoorCtx({ ...parse(), labour: [] }, vi.fn()));
        const host = findByType(node, LabourResultHost) as React.ReactElement<{ renderManualEntry: () => React.ReactNode }> | null;
        const form = findByType(host!.props.renderManualEntry(), ManualEntry) as React.ReactElement<ManualEntryElementProps> | null;
        expect(form!.props.captureScope).toBe('labour');
    });

    it('the ordinary log door is unchanged: shared provenance, no scope, no date override', () => {
        const node = renderLogView(labourDoorCtx(parse(), vi.fn(), { logIntent: null }));
        const form = findByType(node, ManualEntry) as React.ReactElement<ManualEntryElementProps> | null;
        expect(form).not.toBeNull();
        expect(form!.props.provenance).toEqual(STALE); // the ctx value, exactly as before
        expect(form!.props.captureScope).toBeUndefined();
        expect(form!.props.recordedDateKey).toBeUndefined();
    });
});
