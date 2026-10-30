// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13), founder decision
 * 2026-09-02 — a voice log saved straight from a parse, with no review tap, must
 * never read on the phone as "the farmer confirmed it".
 *
 * WHY THIS FILE EXISTS (I13-V1-B1). `toDailyLog` rebuilds `verifiedAtISO` /
 * `verifiedByOperatorId` from the LATEST verification event of ANY status, and
 * `computeDayState` gives the day its 30-point "today's record is confirmed"
 * credit for that stamp (`hasConfirmationOnRecord`). Installed APKs carry this
 * exact code. So the server keeps its auto-save capture marker OFF the wire
 * (`DtoMappingExtensions.WireVerificationEvents`): an auto-saved log comes down
 * as `Draft` with NO events. `AutoSavedVoiceLogRealPostgresTests` proves the
 * server sends that shape; this file proves what the phone's REAL reconciler and
 * ring do with it. Together they close the chain end to end.
 *
 * Measured before the server fix (a pulled log carrying only the marker):
 * closurePercent 100 and "confirmed by" the farmer. With the fix: 70, unstamped.
 *
 * `fake-indexeddb/auto` gives a real IndexedDB, so the Dexie writes here are
 * the writes the phone performs.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

import { VersionRegistry } from '../../../../../core/contracts/VersionRegistry';
import { LogVerificationStatus, type DailyLog } from '../../../../../types';
import type { DailyLogDto, SyncPullResponse, VerificationEventDto } from '../../../../../infrastructure/api/dtos';
import {
    getDatabase,
    resetDatabase,
    type AgriLogDatabase,
} from '../../../../../infrastructure/storage/DexieDatabase';
import { computeDayState } from '../../../../../shared/utils/dayState';
import { reconcileLogs } from '../logsReconciler';
import type { PlotLookupEntry } from '../profileAndCropsReconciler';

const PLOT_ID = 'plot-1';
const OWNER_ID = 'owner-1';
const LOG_ID = 'log-auto-saved';
const DAY = '2026-10-26';

const plotLookup = new Map<string, PlotLookupEntry>([
    [PLOT_ID, { cropId: 'crop-1', cropName: 'Grapes', plotName: 'North Field' }],
]);

/** The log exactly as the server now sends an auto-saved voice log down. */
function autoSavedLogAsTheServerSendsIt(overrides: Partial<DailyLogDto> = {}): DailyLogDto {
    return {
        id: LOG_ID,
        farmId: 'farm-1',
        plotId: PLOT_ID,
        cropCycleId: 'cycle-1',
        operatorUserId: OWNER_ID,
        logDate: DAY,
        createdAtUtc: '2026-10-26T04:00:00.000Z',
        modifiedAtUtc: '2026-10-26T04:00:00.000Z',
        lastVerificationStatus: 'Draft',
        tasks: [{ id: 'task-1', activityType: 'irrigation', occurredAtUtc: '2026-10-26T04:00:00.000Z' }],
        verificationEvents: [],
        ...overrides,
    };
}

function pullPayloadWith(...dailyLogs: DailyLogDto[]): SyncPullResponse {
    return {
        serverTimeUtc: '2026-10-26T06:00:00.000Z',
        nextCursorUtc: '2026-10-26T06:00:00.000Z',
        farms: [],
        plots: [],
        cropCycles: [],
        dailyLogs,
        attachments: [],
        costEntries: [],
        financeCorrections: [],
        dayLedgers: [],
        priceConfigs: [],
        plannedActivities: [],
        auditEvents: [],
    };
}

function ownerEvent(id: string, status: string, occurredAtUtc: string, reason?: string): VerificationEventDto {
    return { id, logId: LOG_ID, status, verifiedByUserId: OWNER_ID, reason, occurredAtUtc };
}

async function pullAndRead(db: AgriLogDatabase, dto: DailyLogDto): Promise<DailyLog> {
    await reconcileLogs(db, pullPayloadWith(dto), plotLookup, new Set<string>());
    const row = await db.logs.get(dto.id);
    expect(row, 'the pulled log must land on the phone').toBeDefined();
    return row!.log;
}

describe('an auto-saved voice log on the phone — captured is not reviewed', () => {
    let db: AgriLogDatabase;

    beforeEach(async () => {
        await getDatabase().delete();
        await resetDatabase();
        db = getDatabase();
    });

    it('lands as a draft with no "confirmed by" stamp and earns no confirmation credit', async () => {
        const log = await pullAndRead(db, autoSavedLogAsTheServerSendsIt());

        expect(log.verification?.status).toBe(LogVerificationStatus.DRAFT);
        expect(log.verification?.verifiedAtISO).toBeUndefined();
        expect(log.verification?.verifiedByOperatorId).toBeUndefined();

        const day = computeDayState({ logs: [log], crops: [], date: DAY });
        // 70 = the recorded-work half only; the 30-point confirmation half is NOT earned.
        expect(day.closurePercent).toBe(70);
    });

    it('control: his own confirm (the pakka-aahe tap) is what earns the credit, in his name', async () => {
        const log = await pullAndRead(db, autoSavedLogAsTheServerSendsIt({
            lastVerificationStatus: 'Verified',
            modifiedAtUtc: '2026-10-26T05:00:00.002Z',
            verificationEvents: [
                ownerEvent('ev-confirm', 'confirmed', '2026-10-26T05:00:00.001Z', 'confirmed-en-route'),
                ownerEvent('ev-verify', 'verified', '2026-10-26T05:00:00.002Z'),
            ],
        }));

        expect(log.verification?.status).toBe(LogVerificationStatus.VERIFIED);
        expect(log.verification?.verifiedByOperatorId).toBe(OWNER_ID);
        expect(log.verification?.verifiedAtISO).toBe('2026-10-26T05:00:00.002Z');

        const day = computeDayState({ logs: [log], crops: [], date: DAY });
        expect(day.closurePercent).toBe(100);
    });

    // I13 fidelity MAJOR — the phone's own marker is what keeps his auto-save off "waiting on you"
    // (appContentOversightInputs). The server sends no marker, so the pull must not erase the phone's.
    it('keeps the phone\'s own auto-save marker across a pull, and the log stays an honest draft', async () => {
        await db.logs.put({
            id: LOG_ID,
            schemaVersion: VersionRegistry.DB_SCHEMA_VERSION,
            log: phoneCopyOfHisAutoSave(),
            date: DAY,
            isDeleted: 0,
        });

        const log = await pullAndRead(db, autoSavedLogAsTheServerSendsIt());

        expect(log.autoSavedFromVoice).toBe(true);
        expect(log.meta?.createdByOperatorId).toBe(OWNER_ID);
        expect(log.verification?.status).toBe(LogVerificationStatus.DRAFT);
        expect(log.verification?.verifiedAtISO).toBeUndefined();
    });

    it('control: a log this phone did not auto-save gains no marker from a pull', async () => {
        const log = await pullAndRead(db, autoSavedLogAsTheServerSendsIt());

        expect(log.autoSavedFromVoice).toBeUndefined();
        expect(log.typedEntry).toBeUndefined();
    });

    // PLR-D10 L6b — "he typed it to Sathi" is not on the wire either: the pull must not turn it into a recording.
    it('keeps the phone\'s typed mark across a pull ("लिहिलेलं" stays)', async () => {
        await db.logs.put({
            id: LOG_ID,
            schemaVersion: VersionRegistry.DB_SCHEMA_VERSION,
            log: { ...phoneCopyOfHisAutoSave(), typedEntry: true },
            date: DAY,
            isDeleted: 0,
        });

        const log = await pullAndRead(db, autoSavedLogAsTheServerSendsIt());

        expect(log.typedEntry).toBe(true);
        expect(log.autoSavedFromVoice).toBe(true);
    });
});

/** His log as `markAutoSavedFromVoice` left it on this phone, before the server answered. */
function phoneCopyOfHisAutoSave(): DailyLog {
    return {
        id: LOG_ID,
        date: DAY,
        context: { selection: [] },
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        meta: { createdAtISO: '2026-10-26T04:00:00.000Z', createdByOperatorId: OWNER_ID },
        verification: { status: LogVerificationStatus.DRAFT, required: true },
        autoSavedFromVoice: true,
        financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
    };
}
