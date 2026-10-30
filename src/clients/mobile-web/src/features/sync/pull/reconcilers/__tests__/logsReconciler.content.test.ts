/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1) — WHERE A PULLED LOG'S DETAILS COME FROM.
 *
 *   1. The server STATES them (`DailyLogDto.content`) → taken EXACTLY, on any phone; a statement wins over a local
 *      copy (that is how an edit reaches Phone B) — including an empty one (an edit that removed everything).
 *   2. The server is silent, and this phone holds its OWN record → kept.
 *   3. Neither → each task line becomes the item it names, carrying only its name and note: no method, source,
 *      reason, type, unit, severity or status the line does not say (doctrine P4). Marked `legacyPartial`.
 *
 * Every case runs the real `reconcileLogs` against the in-memory Dexie double the sibling reconciler tests use.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { reconcileLogs } from '../logsReconciler';
import type { AgriLogDatabase, DexieLogRecord } from '../../../../../infrastructure/storage/DexieDatabase';
import type { DailyLog } from '../../../../../types';
import type { DailyLogDto, SyncPullResponse } from '../../../../../infrastructure/api/AgriSyncClient';
import type { PlotLookupEntry } from '../profileAndCropsReconciler';

const LOG_ID = 'f1f1f1f1-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLOT = 'plot-1';

const dto = (over: Partial<DailyLogDto> = {}): DailyLogDto => ({
    id: LOG_ID,
    farmId: 'farm-1',
    plotId: PLOT,
    cropCycleId: 'cycle-1',
    operatorUserId: 'user-1',
    logDate: '2026-10-30',
    createdAtUtc: '2026-10-30T05:00:00.000Z',
    modifiedAtUtc: '2026-10-30T05:00:01.000Z',
    scope: 'Plot',
    plotIds: [PLOT],
    tasks: [],
    verificationEvents: [],
    ...over,
} as DailyLogDto);

/** A real parse's items (the typed Marathi entry of 2026-10-30) plus every other bucket. */
const DOCUMENT = {
    schema: 1,
    capturedAtUtc: '2026-10-30T05:00:00.000Z',
    fullTranscript: 'आज ऊस S1 मध्ये इथरेल अडीचशे मिली पाचशे लिटर पाण्यात मिसळून फवारणी केली.',
    cropActivities: [{ id: 'c1', title: 'खुरपणी', workTypes: ['Weeding'], sourceText: 'पाच बायकांनी खुरपणी केली', provenanceVerified: true }],
    irrigation: [{ id: 'i1', method: 'Flood', source: 'Canal', durationHours: 2, waterVolumeLitres: 5000, role: 'irrigation',
        numbers: { waterVolumeLitres: { certainty: 'approximate', quantity: 5000, unit: 'L', spokenText: 'अंदाजे पाच हजार लिटर' } } }],
    inputs: [{ id: 'p1', method: 'Spray', productName: 'इथरेल', type: 'other', quantity: 250, unit: 'मिली', carrierVolume: 500, carrierUnit: 'लिटर',
        mix: [{ id: 'm1', productName: 'इथरेल', dose: 250, unit: 'मिली' }], sourceText: 'इथरेल अडीचशे मिली', provenanceVerified: false }],
    observations: [{ id: 'o1', plotId: PLOT, dateKey: '2026-10-30', timestamp: '2026-10-30T05:00:00.000Z', textRaw: 'पानावर डाग', noteType: 'issue', severity: 'urgent', source: 'voice' }],
    machinery: [{ id: 'k1', type: 'tractor', ownership: 'rented', hoursUsed: 3, rentalCost: 2400 }],
    activityExpenses: [{ id: 'e1', reason: 'डिझेल', items: [], totalAmount: 617.5 }],
    plannedTasks: [{ id: 't1', title: 'उद्या फवारणी', plotId: PLOT, priority: 'high', status: 'pending', sourceType: 'ai_extracted', createdAt: '2026-10-30T05:00:00.000Z' }],
    disturbance: { scope: 'PARTIAL', group: 'weather', reason: 'दुपारी पाऊस', severity: 'MEDIUM' },
};

const stated = (document: Record<string, unknown>, version = 1) =>
    ({ content: { version, schema: 1, document }, contentVersion: version }) as Partial<DailyLogDto>;

/** A log THIS phone made (every local factory stamps `meta.appVersion`). */
const ownLog = (over: Partial<DailyLog> = {}): DailyLog => ({
    id: LOG_ID,
    date: '2026-10-30',
    context: { selection: [{ cropId: 'crop-1', cropName: 'ऊस', selectedPlotIds: [PLOT], selectedPlotNames: ['S1'] }] },
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [{ id: 'own-c', title: 'छाटणी', quantity: 2, unit: 'acre', sourceText: 'दोन एकर छाटणी' }],
    irrigation: [{ id: 'own-i', method: 'Flood', source: 'Canal', durationHours: 2 }],
    labour: [],
    inputs: [],
    machinery: [],
    activityExpenses: [],
    observations: [],
    plannedTasks: [],
    meta: { createdAtISO: '2026-10-30T05:00:00.000Z', appVersion: '1.0.18' },
    financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, totalActivityExpenses: 0, grandTotal: 0 },
    ...over,
} as unknown as DailyLog);

const plotLookup = new Map<string, PlotLookupEntry>([[PLOT, { cropId: 'crop-1', cropName: 'ऊस', plotName: 'S1' } as PlotLookupEntry]]);
let store: Map<string, DexieLogRecord>;
let db: AgriLogDatabase;
const seed = (log: DailyLog) => store.set(log.id, { id: log.id, schemaVersion: 16, log, date: log.date, isDeleted: 0 } as DexieLogRecord);
const run = (dtos: DailyLogDto[], pending = new Set<string>()) =>
    reconcileLogs(db, { dailyLogs: dtos } as unknown as SyncPullResponse, plotLookup, pending);
const written = () => store.get(LOG_ID)!.log;

beforeEach(() => {
    store = new Map();
    db = {
        logs: {
            get: async (id: string) => store.get(id),
            put: async (row: DexieLogRecord) => { store.set(row.id, row); },
        },
    } as unknown as AgriLogDatabase;
});

describe('1. the server STATES the details — taken exactly', () => {
    it('a clean device (an owner\'s phone, a reinstall) gets every bucket, his words and the verified flags exactly', async () => {
        await run([dto({ tasks: [{ id: 'x', activityType: 'Irrigation', occurredAtUtc: '2026-10-30T05:00:00.000Z' }], ...stated(DOCUMENT) })]);

        const log = written();
        for (const bucket of ['cropActivities', 'irrigation', 'inputs', 'observations', 'machinery', 'activityExpenses', 'plannedTasks'] as const) {
            expect(log[bucket], bucket).toEqual(DOCUMENT[bucket]);
        }
        expect(log.disturbance).toEqual(DOCUMENT.disturbance);
        expect(log.fullTranscript).toBe(DOCUMENT.fullTranscript);
        expect(log.contentVersion).toBe(1);
        expect(log.legacyPartial).toBe(false);
        // Nothing invented beside it: the task line is not read when the details are stated.
        expect(log.irrigation).toHaveLength(1);
        expect(log.inputs[0].provenanceVerified).toBe(false);
    });

    it('a statement wins over this phone\'s own copy — how an edit made on Phone A reaches Phone B', async () => {
        seed(ownLog());
        await run([dto(stated({ schema: 1, irrigation: [{ id: 'own-i', method: 'Drip', source: 'Well', durationHours: 3 }] }, 2))]);

        expect(written().irrigation).toEqual([{ id: 'own-i', method: 'Drip', source: 'Well', durationHours: 3 }]);
        expect(written().cropActivities, 'the statement names no crop work: an edit removed it').toEqual([]);
        expect(written().contentVersion).toBe(2);
    });

    it('an EMPTY statement is a statement: an edit that removed every item removes them here too', async () => {
        seed(ownLog());
        await run([dto(stated({ schema: 1 }, 3))]);

        expect(written().cropActivities).toEqual([]);
        expect(written().irrigation).toEqual([]);
        expect(written().legacyPartial).toBe(false);
    });

    it('a log with a pending local edit is left alone whole (the queued revision guards it)', async () => {
        seed(ownLog({ irrigation: [{ id: 'own-i', method: 'Drip', source: 'Well', durationHours: 4 }] } as Partial<DailyLog>));
        await run([dto(stated(DOCUMENT, 2))], new Set([LOG_ID]));

        expect(written().irrigation).toEqual([{ id: 'own-i', method: 'Drip', source: 'Well', durationHours: 4 }]);
    });
});

describe('2. the server is SILENT — this phone\'s own record is kept', () => {
    it('task lines alone never overwrite the details this phone recorded', async () => {
        seed(ownLog());
        await run([dto({ tasks: [
            { id: 't-a', activityType: 'Pruning', occurredAtUtc: '2026-10-30T05:00:00.000Z' },
            { id: 't-b', activityType: 'Irrigation', notes: 'Method: Flood • Source: Canal • Duration: 2 hrs', occurredAtUtc: '2026-10-30T05:00:00.000Z' },
        ] })]);

        expect(written().cropActivities).toEqual(ownLog().cropActivities);
        expect(written().irrigation).toEqual(ownLog().irrigation);
        expect(written().legacyPartial).toBeUndefined();
    });

    it('details this phone already took from the server are kept when a later response says nothing', async () => {
        await run([dto(stated(DOCUMENT))]);
        await run([dto({ modifiedAtUtc: '2026-10-30T06:00:00.000Z', content: null })]);

        expect(written().inputs).toEqual(DOCUMENT.inputs);
        expect(written().legacyPartial).toBe(false);
    });
});

describe('3. only TASK LINES exist — what they say, and nothing made up (REPRO-A1)', () => {
    const lines = [
        { id: 'l-irr', activityType: 'Irrigation', notes: 'Method: Flood • Source: Canal • Duration: 2 hrs', occurredAtUtc: '2026-10-30T05:00:00.000Z' },
        { id: 'l-spray', activityType: 'Spray Bavistin', notes: 'Qty: 500 gm', occurredAtUtc: '2026-10-30T05:00:00.000Z' },
        { id: 'l-fert', activityType: 'Fertilizer Urea', occurredAtUtc: '2026-10-30T05:00:00.000Z' },
        { id: 'l-obs', activityType: 'Observation', notes: 'पानावर डाग', occurredAtUtc: '2026-10-30T05:00:00.000Z' },
        { id: 'l-rem', activityType: 'Reminder', notes: 'उद्या फवारणी', occurredAtUtc: '2026-10-30T05:00:00.000Z' },
        { id: 'l-mach', activityType: 'Machinery tractor', notes: 'Hours: 3', occurredAtUtc: '2026-10-30T05:00:00.000Z' },
        { id: 'l-crop', activityType: 'Pruning', executionStatus: 'Completed', occurredAtUtc: '2026-10-30T05:00:00.000Z' },
        { id: 'l-skip', activityType: 'Weeding', executionStatus: 'Skipped', occurredAtUtc: '2026-10-30T05:00:00.000Z' },
    ];

    it('each line becomes the item its label names, with its note shown as written', async () => {
        await run([dto({ tasks: lines })]);
        const log = written();

        expect(log.irrigation).toEqual([{ id: 'l-irr', notes: 'Method: Flood • Source: Canal • Duration: 2 hrs' }]);
        // The product is the X of "Spray X" / "Fertilizer X" — the name the phone put after its label.
        expect(log.inputs.map(i => i.productName)).toEqual(['Bavistin', 'Urea']);
        expect(log.inputs.map(i => i.mix.map(m => m.productName))).toEqual([['Bavistin'], ['Urea']]);
        expect(log.machinery).toEqual([{ id: 'l-mach', type: 'tractor', ownership: 'unknown', notes: 'Hours: 3' }]);
        expect(log.observations?.map(o => [o.id, o.noteType, o.textRaw])).toEqual([
            ['l-obs', 'observation', 'पानावर डाग'],
            ['l-rem', 'reminder', 'उद्या फवारणी'],
        ]);
        expect(log.cropActivities.map(a => [a.title, a.status])).toEqual([['Pruning', 'completed'], ['Weeding', undefined]]);
        expect(log.legacyPartial).toBe(true);
        expect(log.financialSummary).toBeUndefined();
    });

    it('invents NO method, source, reason, type, unit, severity or status', async () => {
        await run([dto({ tasks: lines })]);
        const log = written();

        expect(log.irrigation[0].method).toBeUndefined(); // never 'Drip'
        expect(log.irrigation[0].source).toBeUndefined(); // never 'Field'
        for (const input of log.inputs) {
            expect(input.method).toBeUndefined(); // never 'Spray' / 'Soil' / 'Drip'
            expect(input.reason).toBeUndefined(); // never 'Preventive' / 'Growth'
            expect(input.type).toBeUndefined(); // never 'pesticide' / 'fertilizer'
            expect(input.mix[0].unit).toBeUndefined(); // never 'unit'
        }
        for (const note of log.observations ?? []) {
            expect(note.severity).toBeUndefined(); // never 'normal'
            expect(note.source).toBeUndefined(); // never 'manual'
        }
        expect(JSON.stringify(log)).not.toMatch(/"Preventive"|"pesticide"|"Field"|"unit":"unit"|"normal"|"manual"/);
    });

    it('files ONLY by the exact labels the phone writes: "Spraying" and "Check vines" are crop work under their own titles (review S9)', async () => {
        await run([dto({
            tasks: [
                { id: 'w-spraying', activityType: 'Spraying', notes: 'सकाळी', occurredAtUtc: '2026-10-30T05:00:00.000Z' },
                { id: 'w-check', activityType: 'Check vines', occurredAtUtc: '2026-10-30T05:00:00.000Z' },
                { id: 'w-watering', activityType: 'Irrigation check', occurredAtUtc: '2026-10-30T05:00:00.000Z' },
                { id: 'w-observe', activityType: 'Observation walk', occurredAtUtc: '2026-10-30T05:00:00.000Z' },
                { id: 'w-input', activityType: 'Spray Input', occurredAtUtc: '2026-10-30T05:00:00.000Z' },
            ],
        })]);
        const log = written();

        expect(log.cropActivities.map(a => [a.id, a.title, a.notes])).toEqual([
            ['w-spraying', 'Spraying', 'सकाळी'],
            ['w-check', 'Check vines', undefined],
            ['w-watering', 'Irrigation check', undefined],
            ['w-observe', 'Observation walk', undefined],
        ]);
        expect(log.irrigation).toEqual([]);
        expect(log.observations).toEqual([]);
        // "Spray Input" IS the phone's label, but "Input" is its stand-in for "no product named".
        expect(log.inputs).toEqual([{ id: 'w-input', mix: [] }]);
        expect(JSON.stringify(log.inputs)).not.toContain('Spraying');
    });

    it('an observation line with no note carries no invented text (the label is not his words)', async () => {
        await run([dto({ tasks: [{ id: 'o-bare', activityType: 'Observation', occurredAtUtc: '2026-10-30T05:00:00.000Z' }] })]);

        expect(written().observations?.map(o => [o.id, o.textRaw, o.textCleaned])).toEqual([['o-bare', '', undefined]]);
    });

    it('a previous task-line rebuild is replaced by the next one (a line that arrived later is shown)', async () => {
        await run([dto({ tasks: [lines[0]] })]);
        expect(written().irrigation).toHaveLength(1);
        await run([dto({ modifiedAtUtc: '2026-10-30T07:00:00.000Z', tasks: [lines[0], lines[6]] })]);

        expect(written().cropActivities.map(a => a.title)).toEqual(['Pruning']);
        expect(written().legacyPartial).toBe(true);
    });
});
