// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L6b fix) — the result screen from the REAL parse responses
 * of the founder's live test (2026-10-30), through the SAME path the app takes, not hand-made fixtures:
 *   real response → `normalizeParsedLog` (the one reading of a parse) → `LogFactory.createFromVoiceResult` (what the
 *   auto-save writes) → the phone's write in Dexie → the FIRST SYNC PULL (`reconcileLogs`, with the very tasks this
 *   phone sends, `buildTaskPayloads`) → `VoiceResultContainer`.
 * The pull is the step every earlier test skipped: it USED TO rebuild crop work, water, sprays and notes from the
 * server's flattened tasks ("Spray इथरेल", "Weeding") with no phrase and no amount — which is why the why-tiles and the
 * amounts vanished on the real screen. Since lane F1 the server keeps what Sathi understood (`content`) and the pull
 * hands it back exactly, and the screen reads the RECORD (the L6b `asWritten` work-around is gone): every test here
 * mounts the PULLED record, never the phone's own write. Both field-name variants of the parser are covered.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined), start: vi.fn(), stop: vi.fn() },
}));
vi.mock('../../../../../app/providers/DataSourceProvider', () => ({
    useDataSource: () => ({ dataSource: { logs: {} }, auditPort: { append: vi.fn(async () => undefined) } }),
}));
vi.mock('../../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../../i18n/translations');
    const ctx = { language: 'mr', setLanguage: () => undefined, t: (k: string) => t(k, 'mr') };
    return { useLanguage: () => ctx, useOptionalLanguage: () => ctx };
});

import { markAutoSavedFromVoice } from '../../../../../app/helpers/autoSavedVoiceLog';
import { VersionRegistry } from '../../../../../core/contracts/VersionRegistry';
import { LogFactory } from '../../../../../core/domain/LogFactory';
import { normalizeParsedLog } from '../../../../../infrastructure/ai/BackendAiClient.helpers';
import type { DailyLogDto, SyncPullResponse } from '../../../../../infrastructure/api/dtos';
import { clearAuthSession, setAuthSession } from '../../../../../infrastructure/storage/AuthTokenStore';
import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import { reconcileLogs } from '../../../../sync/pull/reconcilers/logsReconciler';
import { buildTaskPayloads } from '../../../../logs/services/logTaskPayloads';
import { buildLogContent } from '../../../../logs/services/logContentPayload';
import type { CropProfile, DailyLog, FarmerProfile, LogScope } from '../../../../../types';
import { VoiceResultContainer } from '../VoiceResultContainer';
import { forgetPlayedReveals } from '../RingStage';
import { amountText, productBoxesOf, productName } from '../productModel';

const ME = 'a1a1a1a1-0000-4000-8000-000000000001';
const AT = '2026-10-30T05:00:00.000Z';
const clock = { now: () => new Date(AT), nowISO: () => AT, nowEpoch: () => Date.parse(AT) };
const profile = { activeOperatorId: ME, operators: [] } as unknown as FarmerProfile;
const crops = [{ id: 'crop-s', name: 'Sugarcane', plots: [{ id: 'plot-s1', name: 'S1', baseline: { unit: 'Acre' } }] }] as unknown as CropProfile[];
const scope: LogScope = { selectedPlotIds: ['plot-s1'], selectedCropIds: ['crop-s'], mode: 'single', applyPolicy: 'broadcast' };

/** The typed Marathi entry's real response (POST /shramsafal/ai/voice-parse, 200) — variant 1: dosePerLitre / carrierUnit. */
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

/** The spoken English sample's inputs — variant 2: quantity / unit / unitCarrier, a Latin label and Latin words. */
const SPOKEN_ENGLISH = {
    dayOutcome: 'WORK_RECORDED', summary: '', cropActivities: [], labour: [], irrigation: [], machinery: [],
    inputs: [{ productName: 'Ethrel', quantity: 250, unit: 'मिलीलीटर', method: 'Spray', carrierVolume: 500, unitCarrier: 'लिटर', sourceText: 'ethyl 250 milliliters in 500 liters of water' }],
    fullTranscript: 'Today I sprayed Ethyl 250 milliliters in 500 liters of water.',
};

/** The auto-save's write: the one reading of a parse, the real factory, the real marker. */
const written = (raw: unknown, typed: boolean): DailyLog[] =>
    LogFactory.createFromVoiceResult(normalizeParsedLog(raw), scope, crops, profile, undefined, undefined, clock)
        .map(l => markAutoSavedFromVoice(l, { typed }));

/**
 * The first sync pull after the save. lane F1: the server answers with what it stored — the content document this
 * phone sent (`buildLogContent`, kept verbatim server-side) and the task lines it wrote from it — unless `silent`, an
 * older server that holds only the task lines and states no details.
 */
async function pulled(logs: DailyLog[], { silent = false }: { silent?: boolean } = {}): Promise<DailyLog[]> {
    const db = getDatabase();
    for (const log of logs) await db.logs.put({ id: log.id, schemaVersion: VersionRegistry.DB_SCHEMA_VERSION, log, date: log.date, isDeleted: 0 });
    const dtos: DailyLogDto[] = logs.map(log => {
        const content = buildLogContent(log);
        return {
            id: log.id, farmId: 'farm-1', plotId: 'plot-s1', cropCycleId: 'cycle-1', operatorUserId: ME, logDate: log.date,
            createdAtUtc: AT, modifiedAtUtc: '2026-10-30T05:00:01.000Z', lastVerificationStatus: 'Draft', verificationEvents: [],
            tasks: buildTaskPayloads(log).map(t => ({ id: t.logTaskId, activityType: t.activityType, notes: t.notes, occurredAtUtc: AT })),
            contentVersion: 1,
            ...(!silent && content && { content: { version: 1, schema: 1, document: JSON.parse(JSON.stringify(content)) } }),
        } as unknown as DailyLogDto;
    });
    const payload = { serverTimeUtc: AT, nextCursorUtc: AT, farms: [], plots: [], cropCycles: [], dailyLogs: dtos, attachments: [], costEntries: [],
        financeCorrections: [], dayLedgers: [], priceConfigs: [], plannedActivities: [], auditEvents: [] } as unknown as SyncPullResponse;
    await reconcileLogs(db, payload, new Map([['plot-s1', { cropId: 'crop-s', cropName: 'Sugarcane', plotName: 'S1' }]]), new Set<string>());
    return Promise.all(logs.map(async l => (await db.logs.get(l.id))!.log));
}

const mount = (logs: DailyLog[], history: DailyLog[], typed: boolean, withWrite = true) => render(
    <VoiceResultContainer
        result={{ logIds: logs.map(l => l.id), clipId: null, key: `k-${logs[0].id}`, unclear: [], ...(typed && { typed: true }), ...(withWrite && { written: logs }) }}
        history={history} farmerProfile={profile} operatorNameById={new Map()} farmId="farm-1" farmRole="PrimaryOwner"
        placeLabel="ऊस · S1" syncQueuedById={new Map(logs.map(l => [l.id, true] as const))}
        onEdit={vi.fn()} onBack={vi.fn()} onAddAnother={vi.fn()} />,
);

beforeEach(async () => {
    forgetPlayedReveals();
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
    setAuthSession({ userId: ME, accessToken: 't', expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString() });
});
afterEach(() => { cleanup(); clearAuthSession(); });

describe('the real typed Marathi entry, after the first sync pull', () => {
    it('lane F1: the pull KEEPS what Sathi read from his words — the defect this file reproduced is gone', async () => {
        const logs = written(TYPED_MARATHI, true);
        const [before] = logs;
        const [after] = await pulled(logs);
        // The record after the pull IS the write: his product word, his phrases, the verified flags, the amounts.
        expect(after.inputs).toEqual(JSON.parse(JSON.stringify(before.inputs)));
        expect(after.cropActivities).toEqual(JSON.parse(JSON.stringify(before.cropActivities)));
        expect(after.inputs[0].productName).toBe('इथरेल');
        expect(after.inputs[0].sourceText).toBe('इथरेल अडीचशे मिली पाचशे लिटर पाण्यात मिसळून फवारणी केली');
        expect(after.cropActivities[0].sourceText).toBe('पाच बायकांनी खुरपणी केली');
        expect(after.fullTranscript).toBe(TYPED_MARATHI.fullTranscript);
        expect(after.contentVersion).toBe(1);
        expect(after.legacyPartial).toBe(false);
        mount(logs, [after], true, false); // the screen reads the pulled RECORD, not the write
        fireEvent.click(screen.getByTestId('vr-words-toggle')); // his words are folded under one line (lane IT4 Task 1)
        expect(screen.getByTestId('vr-link-inputs')).toBeTruthy();
        expect(screen.getByTestId('vr-link-crop')).toBeTruthy();
    });

    it('lane F1: an OLDER server that states no details still leaves this phone\'s own record whole', async () => {
        const logs = written(TYPED_MARATHI, true);
        const [after] = await pulled(logs, { silent: true });
        expect(after.inputs[0].productName).toBe('इथरेल'); // never the task line's "Spray इथरेल"
        expect(after.inputs[0].sourceText).toBe('इथरेल अडीचशे मिली पाचशे लिटर पाण्यात मिसळून फवारणी केली');
        expect(after.legacyPartial).toBeUndefined();
    });

    it('shows the why-tiles, the product chip and the spray box from HIS words — amounts as he said them', async () => {
        const logs = written(TYPED_MARATHI, true);
        const history = await pulled(logs);
        const { container } = mount(logs, history, true, false);
        fireEvent.click(screen.getByTestId('vr-words-toggle')); // his words are folded under one line (lane IT4 Task 1)

        // Why-tiles: in the order he said them; the first open; his phrase marked.
        expect(screen.getByTestId('vr-why-heading').textContent).toBe('श्रम साथीला हे का समजले?');
        const tiles = within(screen.getByTestId('vr-links')).getAllByRole('button', { pressed: undefined }).filter(b => b.dataset.testid?.startsWith('vr-link-'));
        expect(tiles.map(t => t.dataset.testid)).toEqual(['vr-link-inputs', 'vr-link-crop']);
        expect(screen.getByTestId('vr-link-card').getAttribute('data-part')).toBe('inputs');
        expect(screen.getByTestId('vr-why-cue-inputs-0').textContent).toBe('इथरेल अडीचशे मिली पाचशे लिटर पाण्यात मिसळून फवारणी केली');
        expect(screen.getByTestId('vr-link-card').textContent).toContain('श्रम साथीने लिहिलेइथरेल');
        fireEvent.click(screen.getByTestId('vr-link-crop'));
        expect(screen.getByTestId('vr-why-cue-crop-0').textContent).toBe('पाच बायकांनी खुरपणी केली');
        expect(screen.getByTestId('vr-link-card').textContent).toContain('श्रम साथीने लिहिलेखुरपणी');

        // The spray line: his word, and the amount AS SAID in its open row — 250 ml in 500 L, never "per litre".
        const spray = container.querySelector('[data-testid^="vr-line-row-inputs:"]') as HTMLElement;
        expect(within(spray).getByText('फवारणी')).toBeTruthy();
        fireEvent.click(spray);
        const box = container.querySelector('[data-testid^="vr-tank-"]') as HTMLElement;
        expect(box.getAttribute('data-kind')).toBe('spray');
        expect(within(box).getByTestId('vr-product-water').textContent).toBe('पाणी: 500 लिटर');
        expect(within(box).getAllByTestId('vr-prow-name').map(r => r.textContent)).toEqual(['इथरेल']);
        expect(within(box).getAllByTestId('vr-prow-amount').map(r => r.textContent)).toEqual(['250 मिली']);

        expect(container.textContent).not.toMatch(/Spray|Weeding|\/ ?लिटर/); // no raw method, no English work type, no per-litre
        expect(screen.getByTestId('vr-latest-typed').textContent).toBe('लिहिलेलं');
    });
});

describe('the real spoken English sample (the other field names)', () => {
    it('reads quantity / unit / unitCarrier at the one normaliser, and names the product by HIS word in Marathi mode', async () => {
        const parsed = normalizeParsedLog(SPOKEN_ENGLISH);
        expect(parsed.inputs[0]).toMatchObject({ quantity: 250, unit: 'मिलीलीटर', carrierUnit: 'लिटर' });
        const variant1 = normalizeParsedLog(TYPED_MARATHI);
        expect(variant1.inputs[0]).toMatchObject({ quantity: 250, unit: 'मिली', carrierUnit: 'लिटर', dosePerLitre: 250 });

        const logs = written(SPOKEN_ENGLISH, false);
        const [box] = productBoxesOf(logs[0]);
        expect(box.water).toEqual([{ litres: 500 }]);
        expect(productName(box.items[0], 'mr')).toBe('ethyl'); // "Ethrel" has no Marathi: his own word, not a hidden row
        expect(productName(box.items[0], 'en')).toBe('Ethrel');
        expect(amountText(box.items[0].amount, 'mr')).toBe('250 मिलीलीटर');
        expect(amountText(box.items[0].amount, 'en')).toBe('250 ml');

        const history = await pulled(logs);
        mount(logs, history, false, false);
        fireEvent.click(screen.getByTestId('vr-words-toggle')); // his words are folded under one line (lane IT4 Task 1)
        // His words carry a capital letter and a full stop the parser's phrase does not: the tiles still find them.
        expect(screen.getByTestId('vr-why-cue-inputs-0').textContent).toBe('Ethyl 250 milliliters in 500 liters of water');
        const line = document.querySelector('[data-testid^="vr-line-head-inputs:"]') as HTMLElement;
        expect(line.textContent).toBe('ethyl');
        fireEvent.click(document.querySelector('[data-testid^="vr-line-row-inputs:"]') as HTMLElement);
        expect(screen.getAllByTestId('vr-prow-amount').map(c => c.textContent)).toEqual(['250 मिलीलीटर']);
    });

    it('a dose filed as per litre is shown per litre only when HIS words say so', () => {
        const perLitre = { ...TYPED_MARATHI, inputs: [{ ...TYPED_MARATHI.inputs[0], sourceText: 'इथरेल प्रति लिटर अडीचशे मिली फवारली' }],
            fullTranscript: 'इथरेल प्रति लिटर अडीचशे मिली फवारली' };
        const [box] = productBoxesOf(written(perLitre, true)[0]);
        expect(amountText(box.items[0].amount, 'mr')).toBe('250 मिली / लिटर');
        const [plain] = productBoxesOf(written(TYPED_MARATHI, true)[0]);
        expect(amountText(plain.items[0].amount, 'mr')).toBe('250 मिली');
    });
});
