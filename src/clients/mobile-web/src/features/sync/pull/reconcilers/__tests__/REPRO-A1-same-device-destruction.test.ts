/**
 * PHASE 0 PROBE A1 — RUNTIME REPRODUCTION, NOT A FIX.
 *
 * Founder direction `docs/superpowers/specs/2026-08-14-FOUNDER-DIRECTION-after-phase-A.md`
 * §2 (Lane A, probe A1) and §6: any claim that would trigger an urgent
 * production repair must be reproduced at runtime first.
 *
 * THE CLAIM UNDER TEST (Phase A §4.1): the first sync-pull after a log is
 * successfully saved AND ACKNOWLEDGED destroys fourteen fields of that log on
 * the farmer's OWN device. No new device. No storage wipe.
 *
 * These tests execute the real `reconcileLogs` against an in-memory Dexie
 * double, following the fixture/mocking convention already established by
 * `logsReconciler.labourPreservation.test.ts` in this same folder.
 *
 * EVERY `it` IS NAMED AFTER THE PROPERTY IT ASSERTS. A failing test here is
 * the defect; a passing test is a refutation of that line of the claim.
 *
 * NOTHING IN PRODUCTION CODE WAS EDITED FOR THIS FILE.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { reconcileLogs } from '../logsReconciler';
import type {
    AgriLogDatabase,
    DexieLogRecord,
} from '../../../../../infrastructure/storage/DexieDatabase';
import type { DailyLog } from '../../../../../types';
import { LogVerificationStatus } from '../../../../../types';
import type {
    DailyLogDto,
    SyncPullResponse,
} from '../../../../../infrastructure/api/AgriSyncClient';
import type { PlotLookupEntry } from '../profileAndCropsReconciler';

const LOG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLOT_ID = 'plot-1';

/**
 * WHAT THE SERVER ACTUALLY KNOWS about this log. `DailyLogDto` carries id,
 * farm, plot, dates, `tasks`, `verificationEvents`, `scope`/`plotIds` and
 * (since Phase 3) `labour`. It has NO field for machinery, expenses, planned
 * tasks, disturbance, transcript, manual total, understanding score, weather,
 * phase, day number, deletion or client meta.
 */
const dto = (over: Partial<DailyLogDto> = {}): DailyLogDto => ({
    id: LOG_ID,
    farmId: 'farm-1',
    plotId: PLOT_ID,
    cropCycleId: 'cycle-1',
    operatorUserId: 'user-1',
    logDate: '2026-08-14',
    createdAtUtc: '2026-08-14T04:00:00.000Z',
    modifiedAtUtc: '2026-08-14T04:00:01.000Z',
    scope: 'Plot',
    plotIds: [PLOT_ID],
    tasks: [],
    verificationEvents: [],
    ...over,
});

/**
 * THE FARMER'S OWN RECORD, as `LogFactory` writes it on this device: a real
 * day's work with hired machinery, a diesel expense, a manual total, an
 * Understanding score and the verbatim transcript he spoke.
 *
 * It is ACKNOWLEDGED — the server took it, so its mutation-queue row is no
 * longer PENDING/SENDING/FAILED and `readPendingLogIds` no longer returns its
 * id. That is modelled by passing an EMPTY pending set to `reconcileLogs`,
 * which is precisely the state the claim says removes the last protection.
 */
const acknowledgedLocalLog = (over: Partial<DailyLog> = {}): DailyLog => ({
    id: LOG_ID,
    date: '2026-08-14',
    context: {
        selection: [{
            cropId: 'crop-1',
            cropName: 'द्राक्ष',
            selectedPlotIds: [PLOT_ID],
            selectedPlotNames: ['ब्लॉक अ'],
        }],
    },
    dayOutcome: 'WORK_RECORDED',

    // ── the fourteen reported casualties ────────────────────────────────────
    phaseAtLogTime: 'CROP_CYCLE',
    dayNumberAtLogTime: 42,
    weatherStamp: {
        id: 'ws-1',
        plotId: PLOT_ID,
        timestampLocal: '2026-08-14T09:30:00+05:30',
        timestampProvider: '2026-08-14T04:00:00.000Z',
        provider: 'tomorrow.io',
        tempC: 31.4,
        humidity: 62,
        windKph: 8.2,
        precipMm: 0,
        cloudCoverPct: 40,
        conditionText: 'Partly cloudy',
        iconCode: '1101',
        rainProbNext6h: 15,
    },
    machinery: [{
        id: 'mach-1',
        type: 'tractor',
        ownership: 'rented',
        hoursUsed: 3,
        rentalCost: 2400,
        fuelCost: 600,
        fuelType: 'diesel',
        fuelQuantity: 6.5,
        operationPerformed: 'नांगरणी',
        notes: 'पाटील यांचा ट्रॅक्टर',
    }],
    activityExpenses: [{
        id: 'exp-1',
        reason: 'डिझेल',
        category: 'fuel',
        vendor: 'शिवाजी पेट्रोल पंप',
        items: [{
            id: 'item-1',
            name: 'Diesel',
            qty: 6.5,
            unit: 'litre',
            unitPrice: 95,
            total: 617.5,
        }],
        totalAmount: 617.5,
    }],
    plannedTasks: [{
        id: 'task-1',
        title: 'उद्या फवारणी',
        plotId: PLOT_ID,
        priority: 'high',
        status: 'pending',
        sourceType: 'ai_extracted',
        createdAt: '2026-08-14T04:00:00.000Z',
        dueDate: '2026-08-15',
    }],
    disturbance: {
        scope: 'PARTIAL',
        group: 'weather',
        reason: 'दुपारी पाऊस आला',
        blockedSegments: ['irrigation'],
        severity: 'MEDIUM',
    },
    fullTranscript: 'आज तीन तास ट्रॅक्टरने नांगरणी केली, सहा लिटर डिझेल लागलं.',
    manualTotalCost: 3617,
    understanding: {
        score: 78,
        outcome: 'SCORED',
        dimensions: [],
    },
    deletion: undefined,
    meta: {
        createdAtISO: '2026-08-14T04:00:00.000Z',
        createdByOperatorId: 'user-1',
        appVersion: '0.9.0',
        deviceId: 'device-abc',
        schemaVersion: 16,
        farmId: 'farm-1',
        provenance: {
            source: 'ai',
            model: 'sarvam-m',
            modelVersion: 'sarvam-m',
            promptVersion: 'v12',
            rawTranscript: 'आज तीन तास ट्रॅक्टरने नांगरणी केली, सहा लिटर डिझेल लागलं.',
        },
    },
    verification: {
        required: true,
        status: LogVerificationStatus.CONFIRMED,
        verifiedByOperatorId: 'user-1',
        verifiedAtISO: '2026-08-14T04:05:00.000Z',
        notes: 'शेतकऱ्याने पुष्टी केली',
    },

    // ── the fields the claim says ARE protected (sanity anchors) ────────────
    labour: [{
        id: 'lab-1',
        type: 'HIRED',
        labourAssignmentId: '11111111-1111-4111-8111-111111111111',
        maleCount: 4,
        femaleCount: 2,
        count: 6,
        totalCost: 1600,
        activity: 'छाटणी',
    }],
    financialSummary: {
        totalLabourCost: 1600,
        totalInputCost: 0,
        totalMachineryCost: 3000,
        totalActivityExpenses: 617.5,
        grandTotal: 5217.5,
    },

    // ── remaining non-optional members ──────────────────────────────────────
    cropActivities: [],
    irrigation: [],
    inputs: [],
    observations: [],
    ...over,
} as unknown as DailyLog);

let store: Map<string, DexieLogRecord>;
let db: AgriLogDatabase;

const plotLookup = new Map<string, PlotLookupEntry>([
    [PLOT_ID, { cropId: 'crop-1', cropName: 'द्राक्ष', plotName: 'ब्लॉक अ' } as PlotLookupEntry],
]);

const seed = (log: DailyLog, over: Partial<DexieLogRecord> = {}) => {
    store.set(log.id, {
        id: log.id,
        schemaVersion: 16,
        log,
        date: log.date,
        isDeleted: 0,
        ...over,
    } as DexieLogRecord);
};

/** ACKNOWLEDGED = empty pending set. That is the whole scenario. */
const pullAfterAcknowledgement = (dtos: DailyLogDto[]) =>
    reconcileLogs(
        db,
        { dailyLogs: dtos } as unknown as SyncPullResponse,
        plotLookup,
        new Set<string>(),
    );

const record = () => store.get(LOG_ID)!;
const written = () => record().log;

beforeEach(() => {
    store = new Map();
    db = {
        logs: {
            get: async (id: string) => store.get(id),
            put: async (row: DexieLogRecord) => { store.set(row.id, row); },
        },
    } as unknown as AgriLogDatabase;
});

// ===========================================================================
// SANITY ANCHORS — if THESE fail the fixture is wrong, not the code.
// ===========================================================================
describe('A1 fixture sanity — the fields the code claims to protect', () => {
    it('sanity_labour_survives_the_first_pull_after_acknowledgement', async () => {
        seed(acknowledgedLocalLog());
        await pullAfterAcknowledgement([dto()]);
        expect(written().labour).toHaveLength(1);
        expect(written().labour[0].totalCost).toBe(1600);
    });

    it('sanity_financialSummary_survives_the_first_pull_after_acknowledgement', async () => {
        seed(acknowledgedLocalLog());
        await pullAfterAcknowledgement([dto()]);
        expect(written().financialSummary.grandTotal).toBe(5217.5);
    });

    it('sanity_the_record_was_actually_rewritten_by_this_pull', async () => {
        // Proves the reconciler reached the `db.logs.put`, so a surviving field
        // survived a real write rather than an early `continue`.
        seed(acknowledgedLocalLog());
        await pullAfterAcknowledgement([dto()]);
        expect(record().serverModifiedAtUtc).toBe('2026-08-14T04:00:01.000Z');
    });
});

// ===========================================================================
// TEST 1 — THE HEADLINE. Fourteen fields, one `it` each.
// ===========================================================================
describe('A1 — same-device destruction on the first pull after acknowledgement', () => {
    beforeEach(() => seed(acknowledgedLocalLog()));

    it('machinery_survives_the_first_pull_after_acknowledgement', async () => {
        await pullAfterAcknowledgement([dto()]);
        expect(written().machinery).toHaveLength(1);
        expect(written().machinery[0].rentalCost).toBe(2400);
    });

    it('activityExpenses_survive_the_first_pull_after_acknowledgement', async () => {
        await pullAfterAcknowledgement([dto()]);
        expect(written().activityExpenses).toHaveLength(1);
        expect(written().activityExpenses?.[0].totalAmount).toBe(617.5);
    });

    it('plannedTasks_survive_the_first_pull_after_acknowledgement', async () => {
        await pullAfterAcknowledgement([dto()]);
        expect(written().plannedTasks).toHaveLength(1);
        expect(written().plannedTasks?.[0].title).toBe('उद्या फवारणी');
    });

    it('disturbance_survives_the_first_pull_after_acknowledgement', async () => {
        await pullAfterAcknowledgement([dto()]);
        expect(written().disturbance).toBeDefined();
        expect(written().disturbance?.reason).toBe('दुपारी पाऊस आला');
    });

    it('fullTranscript_survives_the_first_pull_after_acknowledgement', async () => {
        await pullAfterAcknowledgement([dto()]);
        expect(written().fullTranscript)
            .toBe('आज तीन तास ट्रॅक्टरने नांगरणी केली, सहा लिटर डिझेल लागलं.');
    });

    it('manualTotalCost_survives_the_first_pull_after_acknowledgement', async () => {
        await pullAfterAcknowledgement([dto()]);
        expect(written().manualTotalCost).toBe(3617);
    });

    it('understanding_survives_the_first_pull_after_acknowledgement', async () => {
        await pullAfterAcknowledgement([dto()]);
        expect(written().understanding?.score).toBe(78);
    });

    it('weatherStamp_survives_the_first_pull_after_acknowledgement', async () => {
        await pullAfterAcknowledgement([dto()]);
        expect(written().weatherStamp?.tempC).toBe(31.4);
    });

    it('phaseAtLogTime_survives_the_first_pull_after_acknowledgement', async () => {
        await pullAfterAcknowledgement([dto()]);
        expect(written().phaseAtLogTime).toBe('CROP_CYCLE');
    });

    it('dayNumberAtLogTime_survives_the_first_pull_after_acknowledgement', async () => {
        await pullAfterAcknowledgement([dto()]);
        expect(written().dayNumberAtLogTime).toBe(42);
    });

    it('deletion_survives_the_first_pull_after_acknowledgement', async () => {
        // Seeded separately: this one needs a DELETED local log.
        seed(acknowledgedLocalLog({
            deletion: {
                deletedAtISO: '2026-08-14T06:00:00.000Z',
                deletedByOperatorId: 'user-1',
                reason: 'चुकीची नोंद',
            },
        } as Partial<DailyLog>), { isDeleted: 1 });

        await pullAfterAcknowledgement([dto()]);

        expect(written().deletion).toBeDefined();
        expect(written().deletion?.reason).toBe('चुकीची नोंद');
    });

    it('meta_provenance_survives_the_first_pull_after_acknowledgement', async () => {
        await pullAfterAcknowledgement([dto()]);
        expect(written().meta?.provenance).toBeDefined();
        expect(written().meta?.provenance?.source).toBe('ai');
        expect(written().meta?.provenance?.promptVersion).toBe('v12');
    });

    it('meta_appVersion_survives_the_first_pull_after_acknowledgement', async () => {
        await pullAfterAcknowledgement([dto()]);
        expect(written().meta?.appVersion).toBe('0.9.0');
    });

    it('local_verification_survives_the_first_pull_after_acknowledgement', async () => {
        // The server DTO carries NO verification events and no
        // `lastVerificationStatus`, so it makes no statement about
        // verification. The farmer's own CONFIRMED must not be downgraded.
        await pullAfterAcknowledgement([dto()]);
        expect(written().verification?.status).toBe(LogVerificationStatus.CONFIRMED);
        expect(written().verification?.notes).toBe('शेतकऱ्याने पुष्टी केली');
    });
});

// ===========================================================================
// TEST 2 — §4.3 soft-deleted log must not resurrect.
// ===========================================================================
describe('A1/§4.3 — a soft-deleted log must not resurrect on the next pull', () => {
    it('soft_deleted_log_stays_deleted_across_a_pull', async () => {
        seed(acknowledgedLocalLog({
            deletion: {
                deletedAtISO: '2026-08-14T06:00:00.000Z',
                deletedByOperatorId: 'user-1',
                reason: 'चुकीची नोंद',
            },
        } as Partial<DailyLog>), { isDeleted: 1 });

        await pullAfterAcknowledgement([dto()]);

        // Both the index flag the list queries filter on AND the domain marker.
        expect(record().isDeleted).toBe(1);
        expect(written().deletion).toBeDefined();
    });
});

// ===========================================================================
// TESTS 3-6 — FABRICATED CONSTANTS ON THE RETURN PATH (`toDailyLog`).
//
// Each seeds the farmer's real record, then pulls the SAME log back with the
// task the server actually stored, and asserts the reconstruction does not
// invent a value the farmer never said.
// ===========================================================================
describe('A1 — fabricated constants on the reconstruction path', () => {
    it('flood_irrigation_from_canal_does_not_come_back_as_Drip_from_Field', async () => {
        seed(acknowledgedLocalLog({
            irrigation: [{
                id: 'irr-1',
                method: 'Flood',
                source: 'Canal',
                durationHours: 2,
            }],
        } as Partial<DailyLog>));

        await pullAfterAcknowledgement([dto({
            tasks: [{
                id: 'irr-1',
                activityType: 'Flood Irrigation',
                occurredAtUtc: '2026-08-14T05:00:00.000Z',
            }],
        })]);

        expect(written().irrigation).toHaveLength(1);
        expect(written().irrigation[0].method).not.toBe('Drip');
        expect(written().irrigation[0].source).not.toBe('Field');
        expect(written().irrigation[0].method).toBe('Flood');
        expect(written().irrigation[0].source).toBe('Canal');
    });

    it('curative_spray_for_a_named_disease_does_not_come_back_as_Preventive_pesticide', async () => {
        seed(acknowledgedLocalLog({
            inputs: [{
                id: 'inp-1',
                method: 'Spray',
                mix: [{ id: 'mix-1', productName: 'Bavistin', unit: 'gm', quantity: 500 }],
                reason: 'Disease',
                type: 'fungicide',
                productName: 'Bavistin',
                notes: 'भुरी रोगासाठी',
            }],
        } as unknown as Partial<DailyLog>));

        await pullAfterAcknowledgement([dto({
            tasks: [{
                id: 'inp-1',
                activityType: 'Fungicide Spray',
                notes: 'भुरी रोगासाठी',
                occurredAtUtc: '2026-08-14T05:00:00.000Z',
            }],
        })]);

        expect(written().inputs).toHaveLength(1);
        expect(written().inputs[0].reason).not.toBe('Preventive');
        expect(written().inputs[0].type).not.toBe('pesticide');
        expect(written().inputs[0].reason).toBe('Disease');
        expect(written().inputs[0].type).toBe('fungicide');
    });

    it('machinery_comes_back_in_the_machinery_bucket_not_as_a_cropActivity', async () => {
        seed(acknowledgedLocalLog());

        await pullAfterAcknowledgement([dto({
            tasks: [{
                id: 'mach-1',
                activityType: 'Tractor Ploughing',
                occurredAtUtc: '2026-08-14T05:00:00.000Z',
            }],
        })]);

        expect(written().machinery.map(m => m.id)).toContain('mach-1');
    });

    it('a_machinery_task_is_not_filed_as_a_cropActivity', async () => {
        // Measured separately from the assertion above: when two assertions
        // share one `it`, the second is never executed once the first throws,
        // and an unexecuted assertion is not evidence.
        seed(acknowledgedLocalLog());

        await pullAfterAcknowledgement([dto({
            tasks: [{
                id: 'mach-1',
                activityType: 'Tractor Ploughing',
                occurredAtUtc: '2026-08-14T05:00:00.000Z',
            }],
        })]);

        expect(written().cropActivities.map(a => a.id)).not.toContain('mach-1');
    });

    it('a_disturbance_day_does_not_come_back_as_dayOutcome_WORK_RECORDED', async () => {
        seed(acknowledgedLocalLog({ dayOutcome: 'DISTURBANCE_RECORDED' } as Partial<DailyLog>));

        await pullAfterAcknowledgement([dto()]);

        expect(written().dayOutcome).not.toBe('WORK_RECORDED');
        expect(written().dayOutcome).toBe('DISTURBANCE_RECORDED');
    });

    it('observations_do_not_come_back_stamped_normal_severity_and_manual_source', async () => {
        seed(acknowledgedLocalLog({
            observations: [{
                id: 'obs-1',
                plotId: PLOT_ID,
                cropId: 'crop-1',
                dateKey: '2026-08-14',
                timestamp: '2026-08-14T05:00:00.000Z',
                textRaw: 'पानावर डाग दिसले',
                noteType: 'issue',
                severity: 'urgent',
                source: 'voice',
            }],
        } as unknown as Partial<DailyLog>));

        await pullAfterAcknowledgement([dto({
            tasks: [{
                id: 'obs-1',
                activityType: 'Observation',
                notes: 'पानावर डाग दिसले',
                occurredAtUtc: '2026-08-14T05:00:00.000Z',
            }],
        })]);

        expect(written().observations?.[0].severity).not.toBe('normal');
        expect(written().observations?.[0].source).not.toBe('manual');
    });

    it('cropActivities_do_not_come_back_stamped_status_completed_when_the_server_never_said_so', async () => {
        // The server's `LogTaskDto` carries `executionStatus`; the reconstruction
        // ignores it and writes the literal 'completed' for every unbucketed task.
        await pullAfterAcknowledgement([dto({
            tasks: [{
                id: 'act-1',
                activityType: 'Pruning',
                executionStatus: 'SKIPPED',
                occurredAtUtc: '2026-08-14T05:00:00.000Z',
            }],
        })]);

        expect(written().cropActivities[0].status).not.toBe('completed');
    });

    it('financialSummary_on_a_clean_device_is_not_asserted_as_all_zeros', async () => {
        // No local record at all — the clean-device / scenario-A path. The
        // server sent no totals, so the honest answer is "not stated", never
        // five zeros presented as the farmer's costs.
        await pullAfterAcknowledgement([dto()]);

        expect(written().financialSummary).not.toEqual({
            totalLabourCost: 0,
            totalInputCost: 0,
            totalMachineryCost: 0,
            totalActivityExpenses: 0,
            grandTotal: 0,
        });
    });
});
