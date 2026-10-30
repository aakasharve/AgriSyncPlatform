/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1) — the content document a phone sends, built from the
 * REAL parse responses of the founder's live test (2026-10-30) through the SAME path the app takes:
 *   real response → `normalizeParsedLog` → `LogFactory.createFromVoiceResult` → `buildLogContent` → the queue.
 * And the enqueue: a log that carries content sends NO add_log_task (the server writes the task lines from it); a
 * log whose details do not fit the contract keeps the old wire exactly, and the day is never refused (P9).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CropProfile, DailyLog, FarmerProfile, LogScope } from '../../../../types';

const { enqueueCreate, enqueueTask, plotsGet, cropCyclesWhere, triggerNow } = vi.hoisted(() => ({
    enqueueCreate: vi.fn(),
    enqueueTask: vi.fn(),
    plotsGet: vi.fn(),
    cropCyclesWhere: vi.fn(),
    triggerNow: vi.fn(),
}));

vi.mock('../../../../application/usecases/sync/CreateDailyLogCommand', () => ({
    CreateDailyLogCommand: { enqueue: enqueueCreate },
}));
vi.mock('../../../../application/usecases/sync/AddLogTaskCommand', () => ({
    AddLogTaskCommand: { enqueue: enqueueTask },
}));
vi.mock('../../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => ({ plots: { get: plotsGet }, cropCycles: { where: cropCyclesWhere } }),
}));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow },
}));

import { LogFactory } from '../../../../core/domain/LogFactory';
import { normalizeParsedLog } from '../../../../infrastructure/ai/BackendAiClient.helpers';
import { validatePayload } from '../../../../infrastructure/sync/PayloadValidator';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { logContentByteLength } from '../../../../../../../../sync-contract/schemas/payloads/_log_content.zod';
import { buildSkippedSyncToast } from '../../../../app/helpers/saveToastMessages';
import { buildLogContent, logContentFor } from '../logContentPayload';
import { enqueueLogsForSync } from '../logSyncMutationService';

const ME = 'a1a1a1a1-0000-4000-8000-000000000001';
const AT = '2026-10-30T05:00:00.000Z';
const FARM_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLOT = 'c1c1c1c1-cccc-4ccc-8ccc-cccccccccccc';
const CYCLE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const clock = { now: () => new Date(AT), nowISO: () => AT, nowEpoch: () => Date.parse(AT) };
const profile = { activeOperatorId: ME, operators: [] } as unknown as FarmerProfile;
const crops = [{ id: 'crop-s', name: 'Sugarcane', plots: [{ id: PLOT, name: 'S1', baseline: { unit: 'Acre' } }] }] as unknown as CropProfile[];
const scope: LogScope = { selectedPlotIds: [PLOT], selectedCropIds: ['crop-s'], mode: 'single', applyPolicy: 'broadcast' };

/** The typed Marathi entry's real response (POST /shramsafal/ai/voice-parse, 200) — variant 1. */
const TYPED_MARATHI = {
    dayOutcome: 'WORK_RECORDED', summary: '',
    cropActivities: [{ title: 'खुरपणी', workTypes: ['Weeding'], sourceText: 'पाच बायकांनी खुरपणी केली', provenanceVerified: true }],
    labour: [{ type: 'HIRED', count: 5, workerNames: ['बायका'], notes: 'बायका', sourceText: 'पाच बायकांनी खुरपणी केली', provenanceVerified: true }],
    inputs: [{
        productName: 'इथरेल', type: 'other', method: 'Spray', dosePerLitre: 250, doseUnit: 'मिली', carrierVolume: 500, carrierUnit: 'लिटर',
        sourceText: 'इथरेल अडीचशे मिली पाचशे लिटर पाण्यात मिसळून फवारणी केली', provenanceVerified: true,
    }],
    irrigation: [], machinery: [],
    fullTranscript: 'आज ऊस S1 मध्ये इथरेल अडीचशे मिली पाचशे लिटर पाण्यात मिसळून फवारणी केली. पाच बायकांनी खुरपणी केली.',
};

/** The spoken English sample — variant 2: quantity / unit / unitCarrier. */
const SPOKEN_ENGLISH = {
    dayOutcome: 'WORK_RECORDED', summary: '', cropActivities: [], labour: [], irrigation: [], machinery: [],
    inputs: [{ productName: 'Ethrel', quantity: 250, unit: 'मिलीलीटर', method: 'Spray', carrierVolume: 500, unitCarrier: 'लिटर', sourceText: 'ethyl 250 milliliters in 500 liters of water' }],
    fullTranscript: 'Today I sprayed Ethyl 250 milliliters in 500 liters of water.',
};

const written = (raw: unknown): DailyLog =>
    LogFactory.createFromVoiceResult(normalizeParsedLog(raw), scope, crops, profile, undefined, undefined, clock)[0];

beforeEach(() => {
    enqueueCreate.mockReset().mockResolvedValue('m1');
    enqueueTask.mockReset().mockResolvedValue('m2');
    triggerNow.mockReset().mockResolvedValue(undefined);
    plotsGet.mockReset().mockImplementation(async (id: string) => ({ payload: { id, farmId: FARM_UUID } }));
    cropCyclesWhere.mockReset().mockReturnValue({
        equals: () => ({
            toArray: async () => [{ payload: { id: CYCLE, cropName: 'Sugarcane', modifiedAtUtc: '2026-08-01T00:00:00Z' } }],
        }),
    });
});

describe('lane F1 — the content document, from the real parse responses', () => {
    it('carries every item exactly as the phone wrote it: values, units, his words, the verified flags', () => {
        const log = written(TYPED_MARATHI);
        const content = buildLogContent(log)!;

        expect(content).toBeDefined();
        expect(content.schema).toBe(1);
        expect(content.capturedAtUtc).toBe(log.meta?.createdAtISO);
        expect(content.fullTranscript).toBe(TYPED_MARATHI.fullTranscript);
        expect(content.inputs).toEqual(JSON.parse(JSON.stringify(log.inputs)));
        expect(content.cropActivities).toEqual(JSON.parse(JSON.stringify(log.cropActivities)));

        const input = content.inputs![0] as Record<string, unknown>;
        expect(input.productName).toBe('इथरेल');
        expect(input.quantity).toBe(250);
        expect(input.unit).toBe('मिली');
        expect(input.carrierUnit).toBe('लिटर');
        expect(input.sourceText).toBe('इथरेल अडीचशे मिली पाचशे लिटर पाण्यात मिसळून फवारणी केली');
        expect(input.provenanceVerified).toBe(true);
        expect((content.cropActivities![0] as Record<string, unknown>).sourceText).toBe('पाच बायकांनी खुरपणी केली');
        expect(Object.keys(content)).not.toContain('labour'); // labour keeps its own path
    });

    it('reads the second field-name variant the same way (quantity / unit / unitCarrier)', () => {
        const content = buildLogContent(written(SPOKEN_ENGLISH))!;
        const input = content.inputs![0] as Record<string, unknown>;
        expect(input).toMatchObject({ productName: 'Ethrel', quantity: 250, unit: 'मिलीलीटर', carrierUnit: 'लिटर' });
        expect(content.fullTranscript).toBe(SPOKEN_ENGLISH.fullTranscript);
    });

    it('a labour-door save, and a create with nothing in it, carry no document', () => {
        expect(buildLogContent({ ...written(TYPED_MARATHI), captureScope: 'labour' })).toBeUndefined();
        const empty = { ...written(SPOKEN_ENGLISH), inputs: [], fullTranscript: undefined } as DailyLog;
        expect(buildLogContent(empty)).toBeUndefined();
        // ...but an EDIT that removed everything is still a statement.
        expect(buildLogContent(empty, { evenIfEmpty: true })).toEqual({ schema: 1, capturedAtUtc: AT });
    });

    it('E6 — measures the document of each real parse (bytes on the wire, against the 64 KiB cap)', () => {
        const sizes = [
            ['typed Marathi', buildLogContent(written(TYPED_MARATHI))!],
            ['spoken English', buildLogContent(written(SPOKEN_ENGLISH))!],
        ].map(([name, content]) => [name, logContentByteLength(content)] as const);
        console.info(`[EVIDENCE] real parse content sizes: ${sizes.map(([n, b]) => `${n}=${b} bytes`).join(', ')}`);

        for (const [, bytes] of sizes) {
            expect(bytes).toBeGreaterThan(200);
            expect(bytes).toBeLessThan(64 * 1024 / 8); // a real day is a few KB, far under the cap
        }
    });

    it('says WHY there is no document: nothing to send, or details that do not fit (review S5)', () => {
        expect(logContentFor({ ...written(TYPED_MARATHI), captureScope: 'labour' }).kind).toBe('none');
        const huge = { ...written(TYPED_MARATHI), cropActivities: [{ id: 'c1', title: 'x', notes: 'अ'.repeat(30000) }] } as unknown as DailyLog;
        const outcome = logContentFor(huge);
        expect(outcome.kind).toBe('withheld');
        expect(outcome.kind === 'withheld' && outcome.issues.join(' ')).toMatch(/exceeds 65536 bytes/);
        const twins = { ...written(TYPED_MARATHI), irrigation: [{ id: 'i1' }, { id: 'i1' }] } as unknown as DailyLog;
        expect(logContentFor(twins).kind).toBe('withheld'); // review N2: one id, two items
    });

    it('a document that does not fit the contract is withheld, never thrown (P9)', () => {
        const noId = { ...written(TYPED_MARATHI), irrigation: [{ method: 'Flood', source: 'Canal' }] } as unknown as DailyLog;
        expect(buildLogContent(noId)).toBeUndefined();
        const huge = { ...written(TYPED_MARATHI), cropActivities: [{ id: 'c1', title: 'x', notes: 'अ'.repeat(30000) }] } as unknown as DailyLog;
        expect(() => buildLogContent(huge)).not.toThrow();
        expect(buildLogContent(huge)).toBeUndefined();
    });
});

describe('lane F1 — the enqueue', () => {
    it('a log carrying content sends it on the create, which the queue validator accepts, and NO add_log_task', async () => {
        const log = { ...written(TYPED_MARATHI), context: { selection: [{ cropId: 'crop-s', cropName: 'Sugarcane', selectedPlotIds: [PLOT], selectedPlotNames: ['S1'] }] } } as DailyLog;

        await enqueueLogsForSync([log]);

        expect(enqueueCreate).toHaveBeenCalledTimes(1);
        const payload = enqueueCreate.mock.calls[0][0];
        expect(payload.content).toEqual(buildLogContent(log));
        expect(validatePayload(SyncMutationName.CreateDailyLog, payload)).toEqual({ ok: true });
        expect(enqueueTask).not.toHaveBeenCalled();
    });

    it('a log whose details do not fit keeps the old wire exactly: no content, the task lines as before', async () => {
        const log = {
            ...written(TYPED_MARATHI),
            context: { selection: [{ cropId: 'crop-s', cropName: 'Sugarcane', selectedPlotIds: [PLOT], selectedPlotNames: ['S1'] }] },
            cropActivities: [{ id: 'c1', title: 'Weeding', notes: 'अ'.repeat(30000) }],
        } as unknown as DailyLog;

        await enqueueLogsForSync([log]);

        expect(enqueueCreate.mock.calls[0][0]).not.toHaveProperty('content');
        expect(enqueueTask.mock.calls.map(call => call[0].activityType)).toEqual(['Weeding', 'Spray इथरेल']);
    });

    it('and the farmer is TOLD, quietly, that the details stay on this phone — in his language (review S5)', async () => {
        const log = {
            ...written(TYPED_MARATHI),
            context: { selection: [{ cropId: 'crop-s', cropName: 'Sugarcane', selectedPlotIds: [PLOT], selectedPlotNames: ['S1'] }] },
            cropActivities: [{ id: 'c1', title: 'Weeding', notes: 'अ'.repeat(30000) }],
        } as unknown as DailyLog;

        const outcome = await enqueueLogsForSync([log]);

        expect(outcome.detailsKeptOnPhoneLogIds).toEqual([log.id]);
        expect(outcome.queuedLogIds).toEqual([log.id]);
        const mr = buildSkippedSyncToast(outcome, 'mr');
        const en = buildSkippedSyncToast(outcome, 'en');
        expect(mr).toEqual({ message: 'लक्षात ठेवलं ✓ — या कामाचा पूर्ण तपशील फक्त या फोनवरच राहील.', type: 'partial' });
        expect(en?.message).toBe('Shram Sathi has it — The full details of this entry stay on this phone only.');
        expect(mr?.message).not.toMatch(/[A-Za-z]/);
    });

    it('a log whose details fit says nothing extra (the happy path is unchanged)', async () => {
        const log = { ...written(TYPED_MARATHI), context: { selection: [{ cropId: 'crop-s', cropName: 'Sugarcane', selectedPlotIds: [PLOT], selectedPlotNames: ['S1'] }] } } as DailyLog;

        const outcome = await enqueueLogsForSync([log]);

        expect(outcome.detailsKeptOnPhoneLogIds).toEqual([]);
        expect(buildSkippedSyncToast(outcome, 'mr')).toBeNull();
    });
});
