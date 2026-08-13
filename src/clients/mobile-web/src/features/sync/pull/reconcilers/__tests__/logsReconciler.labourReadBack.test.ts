/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LABOUR_PHASE2 Phase 3 — LABOUR READ-BACK, and the guard that decides whose
 * labour wins.
 *
 * spec: 2026-08-12-labour-phase2-server-truth-farm-context
 *
 * Labour was written and never read back. A farmer recorded 8 workers on Phone
 * A; Phone B, freshly installed, saw the log with no labour on it at all
 * (founder decision B4 — read-back is a launch requirement).
 *
 * THE THREE STATES OF `DailyLogDto.labour` ARE THREE DIFFERENT STATEMENTS, and
 * this file exists because two of them are one keystroke apart:
 *
 *   absent / null — the response makes NO STATEMENT (`POST /logs`, verify,
 *                   add-task, and any server build older than Phase 3)
 *   []            — the server STATES this log has no labour
 *   non-empty     — the engagements, as current truth
 *
 * `preserveLocalOnlyFields` is REVISED here, never deleted: deleting it is the
 * Labour V1 data loss, and `logsReconciler.labourPreservation.test.ts` — which
 * uses a DTO with no labour field at all, i.e. the silent case — still pins it
 * unchanged. This file pins what the other two states do.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { reconcileLogs } from '../logsReconciler';
import { resolveLabourHeadcount, sumLabourHeadcount } from '../../../../../domain/logs/labourHeadcount';
import type { AgriLogDatabase, DexieLogRecord } from '../../../../../infrastructure/storage/DexieDatabase';
import type { DailyLog } from '../../../../../types';
import type {
    DailyLogDto,
    LabourEngagementDto,
    SyncPullResponse,
} from '../../../../../infrastructure/api/AgriSyncClient';

const LOG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ENGAGEMENT_A = '11111111-1111-4111-8111-111111111111';
const ENGAGEMENT_B = '22222222-2222-4222-8222-222222222222';

const engagement = (over: Partial<LabourEngagementDto> = {}): LabourEngagementDto => ({
    labourAssignmentId: ENGAGEMENT_A,
    dailyLogId: LOG_ID,
    engagementType: 'Hired',
    workerCount: 8,
    maleCount: null,
    femaleCount: null,
    wagePerPerson: null,
    contractUnit: null,
    contractQuantity: null,
    totalCost: null,
    durationHours: 8,
    timeBasis: 'Assumed',
    shift: null,
    task: 'छाटणी',
    notes: null,
    workerNames: [],
    createdAtUtc: '2026-08-13T04:00:00.000Z',
    linkedActivityId: null,
    attributedOperators: [],
    ...over,
});

const dto = (over: Partial<DailyLogDto> = {}): DailyLogDto => ({
    id: LOG_ID,
    farmId: 'farm-1',
    plotId: 'plot-1',
    cropCycleId: 'cycle-1',
    operatorUserId: 'user-1',
    logDate: '2026-08-13',
    createdAtUtc: '2026-08-13T04:00:00.000Z',
    modifiedAtUtc: '2026-08-13T05:00:00.000Z',
    tasks: [],
    verificationEvents: [],
    ...over,
});

/** A log the farmer created on THIS device, with labour he recorded himself. */
const localLog = (over: Partial<DailyLog> = {}): DailyLog => ({
    id: LOG_ID,
    date: '2026-08-13',
    context: { selection: [{ cropId: 'c1', cropName: 'Grapes', selectedPlotIds: ['plot-1'] }] },
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [],
    irrigation: [],
    labour: [{
        id: 'l1',
        type: 'HIRED',
        labourAssignmentId: ENGAGEMENT_A,
        count: 8,
        totalCost: 3200,
        activity: 'छाटणी',
    }],
    inputs: [],
    machinery: [],
    activityExpenses: [],
    observations: [],
    plannedTasks: [],
    financialSummary: {
        totalLabourCost: 3200,
        totalInputCost: 0,
        totalMachineryCost: 0,
        totalActivityExpenses: 0,
        grandTotal: 3200,
    },
    ...over,
} as unknown as DailyLog);

let store: Map<string, DexieLogRecord>;
let db: AgriLogDatabase;

const seed = (log: DailyLog, over: Partial<DexieLogRecord> = {}) => {
    store.set(LOG_ID, { id: LOG_ID, schemaVersion: 1, date: log.date, isDeleted: 0, log, ...over } as DexieLogRecord);
};

const run = (dtos: DailyLogDto[], pending: Set<string> = new Set()) =>
    reconcileLogs(db, { dailyLogs: dtos } as unknown as SyncPullResponse, new Map(), pending);

const written = () => store.get(LOG_ID)!.log;

beforeEach(() => {
    store = new Map();
    db = {
        logs: {
            get: async (id: string) => store.get(id),
            put: async (record: DexieLogRecord) => { store.set(record.id, record); },
        },
    } as unknown as AgriLogDatabase;
});

describe('reconcileLogs — a CLEAN DEVICE reconstructs the labour', () => {
    it('THE HEADLINE: nothing local, and the log comes down with its labour intact', async () => {
        await run([dto({
            labour: [engagement({
                workerCount: 8,
                maleCount: 5,
                femaleCount: 3,
                durationHours: 6,
                timeBasis: 'Explicit',
                wagePerPerson: 400,
                totalCost: 3200,
                task: 'छाटणी',
                workerNames: ['रमेश', 'सीता'],
                attributedOperators: [{ fieldOperatorId: 'fo-1', displayNameAtAttach: 'बाळू' }],
            })],
        })]);

        const [labour] = written().labour;
        // Right count…
        expect(labour.count).toBe(8);
        expect(resolveLabourHeadcount(labour)).toBe(8);
        // …right basis…
        expect(labour.durationHours).toBe(6);
        expect(labour.timeBasis).toBe('Explicit');
        // …right names…
        expect(labour.workerNames).toEqual(['रमेश', 'सीता']);
        // …right attribution…
        expect(labour.attributedOperators).toEqual([{ fieldOperatorId: 'fo-1', displayNameAtAttach: 'बाळू' }]);
        // …and the id the picker and the correction path both key on.
        expect(labour.labourAssignmentId).toBe(ENGAGEMENT_A);
    });

    it('P7 ACROSS THE PULL: 8 workers with 3 attributed still reports 8', async () => {
        await run([dto({
            labour: [engagement({
                workerCount: 8,
                attributedOperators: [
                    { fieldOperatorId: 'fo-1', displayNameAtAttach: 'बाळू' },
                    { fieldOperatorId: 'fo-2', displayNameAtAttach: 'रमेश' },
                    { fieldOperatorId: 'fo-3', displayNameAtAttach: 'सीता' },
                ],
            })],
        })]);

        expect(written().labour[0].attributedOperators).toHaveLength(3);
        // Through the app's own shared derivation, on the record that actually
        // reached storage — not on the mapper's return value.
        expect(sumLabourHeadcount(written().labour)).toBe(8);
    });

    it('P8 ACROSS THE PULL: an assumed duration never reaches the field readers treat as stated', async () => {
        await run([dto({ labour: [engagement({ durationHours: 8, timeBasis: 'Assumed' })] })]);

        expect(written().labour[0].durationHours).toBeUndefined();
        expect(written().labour[0].timeBasis).toBe('Assumed');
    });

    it('rebuilds several engagements on one log, in the order the server sent them', async () => {
        await run([dto({
            labour: [
                engagement({ labourAssignmentId: ENGAGEMENT_A, workerCount: 8 }),
                engagement({ labourAssignmentId: ENGAGEMENT_B, workerCount: 2, engagementType: 'Contract' }),
            ],
        })]);

        expect(written().labour.map(l => l.labourAssignmentId)).toEqual([ENGAGEMENT_A, ENGAGEMENT_B]);
        // Two gangs on one day is 10 people, and each engagement keeps its own
        // number — the sum is never re-derived from anything else.
        expect(sumLabourHeadcount(written().labour)).toBe(10);
    });
});

describe('reconcileLogs — the server states CURRENT TRUTH, and it wins', () => {
    it('a correction propagates: the phone said 8, the server says 6, the phone now says 6', async () => {
        // The exact contradiction this feature exists to end — and note that
        // `UpdateLog` posts a correction and never writes Dexie, so before the
        // read-back a phone that corrected its OWN log kept showing 8 forever.
        seed(localLog());

        await run([dto({ labour: [engagement({ workerCount: 6 })] })]);

        expect(written().labour).toHaveLength(1);
        expect(written().labour[0].count).toBe(6);
    });

    it('a PARTIAL removal propagates: two engagements come back as one', async () => {
        seed(localLog({
            labour: [
                { id: 'l1', type: 'HIRED', labourAssignmentId: ENGAGEMENT_A, count: 8 },
                { id: 'l2', type: 'HIRED', labourAssignmentId: ENGAGEMENT_B, count: 2 },
            ],
        } as Partial<DailyLog>));

        await run([dto({ labour: [engagement({ labourAssignmentId: ENGAGEMENT_A, workerCount: 8 })] })]);

        expect(written().labour).toHaveLength(1);
        expect(written().labour[0].labourAssignmentId).toBe(ENGAGEMENT_A);
    });

    it('a newly attributed person arrives without disturbing the reported quantity', async () => {
        seed(localLog());

        await run([dto({
            labour: [engagement({
                workerCount: 8,
                attributedOperators: [{ fieldOperatorId: 'fo-1', displayNameAtAttach: 'बाळू' }],
            })],
        })]);

        expect(written().labour[0].attributedOperators).toHaveLength(1);
        expect(written().labour[0].count).toBe(8);
    });
});

describe('reconcileLogs — silence must never be read as "no labour"', () => {
    it('a response with NO labour field leaves local labour untouched (the V1 loss)', async () => {
        // `POST /logs`, verify and add-task all return a DailyLogDto without
        // ever loading the engagements. So does any server older than Phase 3.
        seed(localLog());

        await run([dto()]);

        expect(written().labour).toHaveLength(1);
        expect(written().labour[0].count).toBe(8);
    });

    it('a response carrying labour: null is the same silence, not an empty statement', async () => {
        // The C# member defaults to null, so a non-projecting endpoint puts a
        // literal JSON null on the wire while an older server omits the key.
        seed(localLog());

        await run([dto({ labour: null })]);

        expect(written().labour).toHaveLength(1);
        expect(written().labour[0].count).toBe(8);
    });

    it('silence does not wipe labour on REPEATED pulls either', async () => {
        seed(localLog());

        await run([dto()]);
        await run([dto({ modifiedAtUtc: '2026-08-13T09:00:00.000Z' })]);

        expect(written().labour).toHaveLength(1);
    });
});

describe('reconcileLogs — the server states [] (the trap)', () => {
    it('THE REFUSAL: [] does not delete labour the server was never given', async () => {
        // Structured labour only started travelling on `create_daily_log` with
        // Labour V1 Task 8.1. A manual labour log from before that — or a voice
        // log whose best-effort derivation side-car rolled back — sits on the
        // server with zero labour rows PERMANENTLY: no backfill job, no
        // re-derive endpoint, and the idempotency early-return hands back the
        // existing log on every retry. The farmer's phone is the only copy.
        seed(localLog());

        await run([dto({ labour: [] })]);

        expect(written().labour).toHaveLength(1);
        expect(written().labour[0].count).toBe(8);
        expect(written().labour[0].labourAssignmentId).toBe(ENGAGEMENT_A);
    });

    it('and it still refuses on the second and third pull, not just the first', async () => {
        seed(localLog());

        await run([dto({ labour: [] })]);
        await run([dto({ labour: [], modifiedAtUtc: '2026-08-13T09:00:00.000Z' })]);
        await run([dto({ labour: [], modifiedAtUtc: '2026-08-13T10:00:00.000Z' })]);

        expect(written().labour).toHaveLength(1);
    });

    it('[] IS adopted when there is nothing to lose — a log that genuinely has no labour', async () => {
        seed(localLog({ labour: [] } as Partial<DailyLog>));

        await run([dto({ labour: [] })]);

        expect(written().labour).toEqual([]);
    });

    it('[] on a NEW log stays empty — no local record, nothing to preserve', async () => {
        await run([dto({ labour: [] })]);

        expect(written().labour).toEqual([]);
    });

    it('a legacy local record with no labour array at all does not break the write', async () => {
        seed(localLog({ labour: undefined } as Partial<DailyLog>));

        await run([dto({ labour: [] })]);

        expect(written().labour).toEqual([]);
    });

    it('the refusal is scoped to labour — everything else on that same response still lands', async () => {
        // Otherwise this would be a different bug: one that ignores the server.
        seed(localLog({ cropActivities: [{ id: 'stale', title: 'Stale' }] } as Partial<DailyLog>));

        await run([dto({
            labour: [],
            tasks: [{ id: 't1', activityType: 'Pruning', occurredAtUtc: '2026-08-13T06:00:00.000Z' }],
        })]);

        expect(written().cropActivities.map(a => a.title)).toEqual(['Pruning']);
        expect(store.get(LOG_ID)!.serverModifiedAtUtc).toBe('2026-08-13T05:00:00.000Z');
        expect(written().labour).toHaveLength(1);
    });
});

describe('reconcileLogs — the guards that already existed still hold', () => {
    it('a log with pending local mutations is skipped whole, labour and all', async () => {
        // This is also why "is a labour mutation in flight?" cannot be the
        // discriminator for the [] case: such a log never reaches the merge.
        seed(localLog());

        await run([dto({ labour: [engagement({ workerCount: 99 })] })], new Set([LOG_ID]));

        expect(written().labour[0].count).toBe(8);
        expect(store.get(LOG_ID)!.serverModifiedAtUtc).toBeUndefined();
    });

    it('a stale response is skipped by the freshness guard before labour is even considered', async () => {
        seed(localLog(), { serverModifiedAtUtc: '2026-08-13T09:00:00.000Z' });

        await run([dto({ labour: [engagement({ workerCount: 99 })], modifiedAtUtc: '2026-08-13T05:00:00.000Z' })]);

        expect(written().labour[0].count).toBe(8);
    });

    it('the local cost totals, which the wire still cannot express, are still preserved', async () => {
        seed(localLog());

        await run([dto({ labour: [engagement({ workerCount: 6 })] })]);

        expect(written().financialSummary.totalLabourCost).toBe(3200);
        expect(written().financialSummary.grandTotal).toBe(3200);
    });

    it('a log with no labour anywhere is byte-identical to what it was before Phase 3', async () => {
        // The single-plot, no-labour case is the overwhelming majority of the
        // corpus; it must be untouched by this change.
        await run([dto({
            labour: [],
            tasks: [{ id: 't1', activityType: 'Pruning', occurredAtUtc: '2026-08-13T06:00:00.000Z' }],
        })]);
        const withEmptyStatement = written();

        store.clear();
        await run([dto({
            tasks: [{ id: 't1', activityType: 'Pruning', occurredAtUtc: '2026-08-13T06:00:00.000Z' }],
        })]);
        const withNoStatement = written();

        expect(withEmptyStatement).toEqual(withNoStatement);
        expect(withNoStatement.labour).toEqual([]);
        expect(withNoStatement.context.selection[0].selectedPlotIds).toEqual(['plot-1']);
    });
});
