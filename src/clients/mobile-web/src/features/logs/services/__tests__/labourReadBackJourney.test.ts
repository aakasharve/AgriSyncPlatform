/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: 2026-08-12-labour-phase2-server-truth-farm-context (Phase 3)
 *
 * ACCEPTANCE JOURNEY — THE CLEAN DEVICE.
 *
 * ```text
 * Phone A: 8 workers, 2 of them named, 6 stated hours
 * -> save -> the labour is on the create payload
 * -> the server stores it and attributes 3 people to it
 * -> Phone B: freshly installed, empty Dexie
 * -> /sync/pull
 * -> the log reconstructs with 8 workers, the stated basis, the names and the
 *    attribution, and the app's own screens read 8
 * ```
 *
 * This is founder decision B4 — "labour read-back is a launch requirement,
 * proven by a clean-device journey" — executed rather than asserted.
 *
 * WHY END-TO-END AND NOT A UNIT TEST. The defect it locks spanned the whole
 * chain: labour was written by `buildLabourPayloads`, stored by the server, and
 * read by nobody, so a second phone saw a log with no labour on it at all. A
 * test that mocks any link can prove the link and miss the chain. So this runs
 * the REAL chain a farmer's tap runs — the real `LogFactory`, the real
 * `confirmAndSave` writing to real Dexie (fake-indexeddb), the real
 * `enqueueLogsForSync`, the real `MutationQueue` — then WIPES the database, which
 * is what a clean install actually is, and reconciles a pull into it.
 *
 * WHERE THE SERVER'S ANSWER COMES FROM. `serverEngagementFor` does not invent a
 * fixture: it projects the ACTUAL queued create payload the way
 * `DtoMappingExtensions.ToDto(this LabourAssignment, …)` projects the row that
 * payload produces — `workerCount` copied verbatim, an unstated duration
 * becoming the server's own `LabourTime.ServerAssumed()`, a stated one becoming
 * `Explicit`. That is the closest a client test gets to "and then the server
 * sent it back", and it is the same technique this file's sibling
 * (`entireFarmJourney.test.ts`) uses for "the server accepts it".
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { LogFactory } from '../../../../core/domain/LogFactory';
import { LogCommandServiceImpl } from '../../../../application/services/LogCommandService';
import { DexieLogsRepository } from '../../../../infrastructure/storage/DexieLogsRepository';
import { enqueueLogsForSync } from '../logSyncMutationService';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { reconcileLogs } from '../../../sync/pull/reconcilers/logsReconciler';
import { generateDayWorkSummary } from '../../../analysis/dayWorkSummary';
import { sumLabourHeadcount } from '../../../../domain/logs/labourHeadcount';
import type { PlotLookupEntry } from '../../../sync/pull/reconcilers/profileAndCropsReconciler';
import type {
    AttributedOperatorDto,
    DailyLogDto,
    LabourEngagementDto,
    SyncPullResponse,
} from '../../../../infrastructure/api/AgriSyncClient';
import type {
    CropProfile,
    DailyLog,
    FarmerProfile,
    LabourEvent,
    LedgerDefaults,
    LogScope,
} from '../../../../types';

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn().mockResolvedValue(undefined) },
}));

const FARM_ID = 'f0000000-0000-4000-8000-000000000001';
const CROP_ID = 'd0000000-0000-4000-8000-000000000001';
const PLOT_A = 'a0000000-0000-4000-8000-00000000000a';
const CYCLE_A = 'e0000000-0000-4000-8000-00000000000a';
const OPERATOR_ID = 'u0000000-0000-4000-8000-000000000001';
const DATE = '2026-08-13';

vi.mock('../../../../infrastructure/storage/SessionStore', () => ({
    SessionStore: {
        getCurrentFarmId: () => FARM_ID,
        setCurrentFarmId: vi.fn(),
        clearCurrentFarmId: vi.fn(),
    },
}));

const grapes: CropProfile = {
    id: CROP_ID,
    name: 'Grapes',
    plots: [{ id: PLOT_A, name: 'Plot A' }],
} as unknown as CropProfile;

const ownerProfile = { activeOperatorId: 'owner' } as unknown as FarmerProfile;

const plotScope: LogScope = {
    selectedPlotIds: [PLOT_A],
    selectedCropIds: [CROP_ID],
    mode: 'single',
    applyPolicy: 'SHARED',
} as unknown as LogScope;

/** What the settings screen supplies. Rates only — never hours (Task 8.3). */
const ledgerDefaults: LedgerDefaults = {
    irrigation: { method: 'drip', source: 'Well', defaultDuration: 2 },
    labour: {
        defaultWage: 400,
        defaultHours: 8,
        shifts: [{ id: 'full', name: 'Full Day', defaultRateMale: 400, defaultRateFemale: 300 }],
    },
    machinery: { defaultRentalCost: 1000, defaultFuelCost: 200 },
} as unknown as LedgerDefaults;

/**
 * 8 workers, 2 of them named, 6 hours the farmer actually stated. One
 * engagement — one real-world gang.
 */
const eightWorkers = (): LabourEvent[] => ([{
    id: 'lab-1',
    type: 'HIRED',
    count: 8,
    maleCount: 5,
    femaleCount: 3,
    totalCost: 3200,
    wagePerPerson: 400,
    durationHours: 6,
    activity: 'छाटणी',
    notes: 'सकाळी लवकर सुरू',
} as LabourEvent]);

async function seedReferenceData() {
    const db = getDatabase();
    await db.farms.bulkPut([{
        id: FARM_ID,
        payload: { id: FARM_ID },
        updatedAt: '2026-08-01T00:00:00.000Z',
    }] as never);
    await db.plots.bulkPut([{
        id: PLOT_A,
        payload: { id: PLOT_A, farmId: FARM_ID, name: 'Plot A' },
        modifiedAtUtc: '2026-08-01T00:00:00.000Z',
    }] as never);
    await db.cropCycles.bulkPut([{
        id: CYCLE_A,
        plotId: PLOT_A,
        payload: {
            id: CYCLE_A,
            plotId: PLOT_A,
            farmId: FARM_ID,
            cropName: 'Grapes',
            modifiedAtUtc: '2026-08-01T00:00:00.000Z',
        },
        modifiedAtUtc: '2026-08-01T00:00:00.000Z',
    }] as never);
}

interface QueuedLabourItem {
    labourAssignmentId: string;
    engagementType: string;
    workerCount?: number;
    maleCount?: number;
    femaleCount?: number;
    wagePerPerson?: number;
    contractUnit?: string;
    contractQuantity?: number;
    totalCost?: number;
    durationHours?: number;
    shift?: string;
    task?: string;
    notes?: string;
}

/** What Phone A actually put on the wire. */
async function queuedLabour(): Promise<QueuedLabourItem[]> {
    const rows = await getDatabase().mutationQueue
        .where('mutationType').equals(SyncMutationName.CreateDailyLog).toArray();
    return rows.flatMap(row => (row.payload as { labour?: QueuedLabourItem[] }).labour ?? []);
}

/**
 * The server's projection of the row that payload creates. Every value is
 * copied; the only two derivations are the ones `CreateDailyLogHandler` and
 * `DtoMappingExtensions` actually perform:
 *
 *   - a stated positive duration becomes `LabourTime.Explicit(h)`; anything else
 *     becomes `LabourTime.ServerAssumed()`, which carries the server's own
 *     default hours with the basis that says so;
 *   - `workerNames` come off the assignment, and `attributedOperators` are the
 *     live `field_operator_work_rows` — an overlay, never a headcount.
 */
const SERVER_ASSUMED_HOURS = 8;

function serverEngagementFor(
    item: QueuedLabourItem,
    logId: string,
    attributedOperators: AttributedOperatorDto[] = [],
    workerNames: string[] = [],
): LabourEngagementDto {
    const explicit = typeof item.durationHours === 'number' && item.durationHours > 0;
    return {
        labourAssignmentId: item.labourAssignmentId,
        dailyLogId: logId,
        engagementType: item.engagementType === 'hired_daily' ? 'Hired' : 'Contract',
        workerCount: item.workerCount ?? null,
        maleCount: item.maleCount ?? null,
        femaleCount: item.femaleCount ?? null,
        wagePerPerson: item.wagePerPerson ?? null,
        contractUnit: item.contractUnit ?? null,
        contractQuantity: item.contractQuantity ?? null,
        totalCost: item.totalCost ?? null,
        durationHours: explicit ? item.durationHours! : SERVER_ASSUMED_HOURS,
        timeBasis: explicit ? 'Explicit' : 'Assumed',
        shift: item.shift ?? null,
        task: item.task ?? null,
        notes: item.notes ?? null,
        workerNames,
        createdAtUtc: `${DATE}T04:30:00.000Z`,
        linkedActivityId: null,
        attributedOperators,
    };
}

function serverLogDto(logId: string, labour: LabourEngagementDto[]): DailyLogDto {
    return {
        id: logId,
        farmId: FARM_ID,
        scope: 'Plot',
        plotIds: [PLOT_A],
        plotId: PLOT_A,
        cropCycleId: CYCLE_A,
        operatorUserId: OPERATOR_ID,
        logDate: DATE,
        createdAtUtc: `${DATE}T04:00:00.000Z`,
        modifiedAtUtc: `${DATE}T05:00:00.000Z`,
        tasks: [],
        verificationEvents: [],
        labour,
    } as unknown as DailyLogDto;
}

const plotLookup = () => new Map<string, PlotLookupEntry>([
    [PLOT_A, { cropId: CROP_ID, cropName: 'Grapes', plotName: 'Plot A' }],
]);

/** Phone A: the farmer records the work and it is queued for the server. */
async function recordOnPhoneA(labour: LabourEvent[] = eightWorkers()): Promise<DailyLog[]> {
    const logs = LogFactory.createFromManualEntry(
        { date: DATE, labour },
        plotScope,
        [grapes],
        ownerProfile,
    );

    const service = new LogCommandServiceImpl(DexieLogsRepository.getInstance());
    await service.confirmAndSave(logs);
    await enqueueLogsForSync(logs);
    // `captureMoneyEventsFromLog` is fire-and-forget.
    await new Promise(resolve => setTimeout(resolve, 0));

    return logs;
}

/**
 * Phone B. Not a mock and not a second store: the SAME database, emptied — which
 * is what a fresh install has, and what the founder means by a clean device.
 */
async function wipeToCleanDevice() {
    const db = getDatabase();
    await db.logs.clear();
    await db.mutationQueue.clear();
}

async function pull(dtos: DailyLogDto[]) {
    await reconcileLogs(
        getDatabase(),
        { dailyLogs: dtos } as unknown as SyncPullResponse,
        plotLookup(),
        new Set<string>(),
    );
}

describe('CLEAN DEVICE — the labour a farmer recorded comes back', () => {
    beforeEach(async () => {
        const db = getDatabase();
        await db.mutationQueue.clear();
        await db.logs.clear();
        await db.farms.clear();
        await db.plots.clear();
        await db.cropCycles.clear();
        localStorage.clear();
        await seedReferenceData();
        vi.clearAllMocks();
    });

    it('THE HEADLINE: a freshly installed phone reconstructs the whole engagement', async () => {
        const [savedLog] = await recordOnPhoneA();
        const [item] = await queuedLabour();

        // Three people were attributed to this engagement on the server, and two
        // workers were named by the farmer.
        const attributed: AttributedOperatorDto[] = [
            { fieldOperatorId: 'fo-1', displayNameAtAttach: 'बाळू' },
            { fieldOperatorId: 'fo-2', displayNameAtAttach: 'रमेश' },
            { fieldOperatorId: 'fo-3', displayNameAtAttach: 'सीता' },
        ];
        const engagement = serverEngagementFor(item, savedLog.id, attributed, ['रमेश', 'सीता']);

        await wipeToCleanDevice();
        expect(await DexieLogsRepository.getInstance().getAll()).toHaveLength(0);

        await pull([serverLogDto(savedLog.id, [engagement])]);

        // A real read back out of Dexie through the production repository.
        const [reloaded] = await DexieLogsRepository.getInstance().getAll();
        expect(reloaded.labour).toHaveLength(1);

        const [labour] = reloaded.labour;
        expect(labour.count).toBe(8);                                    // right count
        expect(labour.durationHours).toBe(6);                            // right hours
        expect(labour.timeBasis).toBe('Explicit');                       // right basis
        expect(labour.workerNames).toEqual(['रमेश', 'सीता']);             // right names
        expect(labour.attributedOperators?.map(o => o.displayNameAtAttach))
            .toEqual(['बाळू', 'रमेश', 'सीता']);                            // right attribution
        expect(labour.activity).toBe('छाटणी');
        expect(labour.totalCost).toBe(3200);
        expect(labour.notes).toBe('सकाळी लवकर सुरू');
    });

    it('P7 AFTER A ROUND TRIP: 8 workers with 3 attributed reads 8 ON THE SCREEN', async () => {
        const [savedLog] = await recordOnPhoneA();
        const [item] = await queuedLabour();
        const engagement = serverEngagementFor(item, savedLog.id, [
            { fieldOperatorId: 'fo-1', displayNameAtAttach: 'बाळू' },
            { fieldOperatorId: 'fo-2', displayNameAtAttach: 'रमेश' },
            { fieldOperatorId: 'fo-3', displayNameAtAttach: 'सीता' },
        ]);

        await wipeToCleanDevice();
        await pull([serverLogDto(savedLog.id, [engagement])]);

        const [reloaded] = await DexieLogsRepository.getInstance().getAll();
        expect(reloaded.labour[0].attributedOperators).toHaveLength(3);

        // Not the mapper's output and not a hand count: the number the farmer
        // actually sees, through the app's own summary derivation.
        const summary = generateDayWorkSummary(reloaded, ledgerDefaults);
        expect(summary.labour.headcount).toBe(8);
        expect(sumLabourHeadcount(reloaded.labour)).toBe(8);
    });

    it('the engagement id survives the round trip, so correction and attribution stay reachable', async () => {
        const [savedLog] = await recordOnPhoneA();
        const [item] = await queuedLabour();

        await wipeToCleanDevice();
        await pull([serverLogDto(savedLog.id, [serverEngagementFor(item, savedLog.id)])]);

        const [reloaded] = await DexieLogsRepository.getInstance().getAll();
        // The id Phone A minted, which is the server primary key, which is what
        // `ReviewSheet` resolves its picker through and `UpdateLog` keys its
        // correction `before` map on. No mapping layer anywhere.
        expect(reloaded.labour[0].labourAssignmentId).toBe(item.labourAssignmentId);
        expect(reloaded.labour[0].labourAssignmentId).toBe(savedLog.labour[0].labourAssignmentId);
    });

    it('an UNSTATED duration comes back as Assumed and stays unstated — no 8h appears', async () => {
        const [savedLog] = await recordOnPhoneA([{
            id: 'lab-1',
            type: 'HIRED',
            count: 8,
            activity: 'छाटणी',
        } as LabourEvent]);
        const [item] = await queuedLabour();

        // The phone sent no duration, so the server recorded its own assumed 8.
        expect(item.durationHours).toBeUndefined();
        const engagement = serverEngagementFor(item, savedLog.id);
        expect(engagement.timeBasis).toBe('Assumed');
        expect(engagement.durationHours).toBe(SERVER_ASSUMED_HOURS);

        await wipeToCleanDevice();
        await pull([serverLogDto(savedLog.id, [engagement])]);

        const [reloaded] = await DexieLogsRepository.getInstance().getAll();
        // The server's default must not come back wearing the costume of a
        // measurement — that constant is what Task 8.4 deleted from two screens.
        expect(reloaded.labour[0].durationHours).toBeUndefined();
        expect(reloaded.labour[0].timeBasis).toBe('Assumed');
        expect(reloaded.labour[0].count).toBe(8);
    });

    it('THE ORIGINAL DEFECT, PROVEN GONE: a pull with no labour statement leaves Phone B empty-handed', async () => {
        // This is what shipped before Phase 3 — the server had the labour and no
        // response could express it, so a clean device rebuilt the log with
        // nothing on it. Kept as the control: the read-back above is a real
        // change in behaviour, not a test that would pass either way.
        const [savedLog] = await recordOnPhoneA();

        await wipeToCleanDevice();
        const silent = serverLogDto(savedLog.id, []) as DailyLogDto;
        delete (silent as { labour?: unknown }).labour;
        await pull([silent]);

        const [reloaded] = await DexieLogsRepository.getInstance().getAll();
        expect(reloaded.labour).toEqual([]);
    });
});

describe('THE SAME PHONE — the record stops contradicting itself', () => {
    beforeEach(async () => {
        const db = getDatabase();
        await db.mutationQueue.clear();
        await db.logs.clear();
        await db.farms.clear();
        await db.plots.clear();
        await db.cropCycles.clear();
        localStorage.clear();
        await seedReferenceData();
        vi.clearAllMocks();
    });

    it('the farmer corrected 8 to 6 — and now his own phone says 6 too', async () => {
        const [savedLog] = await recordOnPhoneA();
        const [item] = await queuedLabour();

        // `UpdateLog` POSTs the correction and never writes Dexie, so the local
        // record still says 8 at this point. Before the read-back it said 8
        // forever.
        expect((await DexieLogsRepository.getInstance().getAll())[0].labour[0].count).toBe(8);

        // The queue is emptied — the create was applied, nothing is in flight —
        // which is what makes the pull eligible to overwrite at all.
        await getDatabase().mutationQueue.clear();
        const corrected = { ...serverEngagementFor(item, savedLog.id), workerCount: 6 };
        await pull([serverLogDto(savedLog.id, [corrected])]);

        const [reloaded] = await DexieLogsRepository.getInstance().getAll();
        expect(reloaded.labour[0].count).toBe(6);
        expect(generateDayWorkSummary(reloaded, ledgerDefaults).labour.headcount).toBe(6);
    });

    it('THE V1 LOSS, STILL PREVENTED: a server that never got the labour cannot delete it', async () => {
        // Every log recorded before structured labour started travelling (Task
        // 8.1) is on the server with zero labour rows, permanently. Its `[]` is
        // truthful about the server and catastrophic if adopted.
        const [savedLog] = await recordOnPhoneA();
        await getDatabase().mutationQueue.clear();

        await pull([serverLogDto(savedLog.id, [])]);

        const [reloaded] = await DexieLogsRepository.getInstance().getAll();
        expect(reloaded.labour).toHaveLength(1);
        expect(reloaded.labour[0].count).toBe(8);
        expect(generateDayWorkSummary(reloaded, ledgerDefaults).labour.headcount).toBe(8);
    });
});
