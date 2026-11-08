// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT4 Tasks 1, 2, 3; founders D-95, D-93, D-96) - the result screen's simple
 * form, the Option 3 product rows with their card and its हो / नाही / फोटो, and the combination box with the red banner. The
 * REAL container over a real Dexie (fake-indexeddb) and the real sync queue; only the camera, the farm's roles and the audio
 * are stood in for.
 *
 * Phone numbers, where any appear, are the fake 600000xxxx kind. The mixing rules used for the red path are the shared
 * reference rules with a TEST-ONLY review stamp: in production nothing is red until a person reviews a rule (D-96).
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { farmCtx, capture } = vi.hoisted(() => ({
    farmCtx: { current: null as null | { currentFarm: unknown } },
    capture: vi.fn(),
}));
vi.mock('../../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined), start: vi.fn(), stop: vi.fn() },
}));
vi.mock('../../../../../app/providers/DataSourceProvider', () => ({
    useDataSource: () => ({ dataSource: { logs: {} }, auditPort: { append: vi.fn(async () => undefined) } }),
}));
vi.mock('../../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../../i18n/translations');
    const ctx = () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => t(k, 'mr') });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});
vi.mock('../../../../../core/domain/services/DateKeyService', async (orig) => {
    const actual = await orig<typeof import('../../../../../core/domain/services/DateKeyService')>();
    return { ...actual, getDateKey: (t?: Date | string) => (t === undefined ? '2026-10-26' : actual.getDateKey(t)) };
});
vi.mock('../../../../../infrastructure/voice/VoiceClipRetention', async (orig) => ({
    ...(await orig<typeof import('../../../../../infrastructure/voice/VoiceClipRetention')>()),
    readVoiceClipPlaintext: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
}));
vi.mock('../../../../../core/session/FarmContext', () => ({ useOptionalFarmContext: () => farmCtx.current }));
vi.mock('../../../../../application/use-cases/CaptureAttachment', () => ({ captureAttachment: (...a: unknown[]) => capture(...a) }));

import referenceRules from '../../../../../../../../../sync-contract/reference/inputs/mix-rules.json';
import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import type { VoiceClipCacheRecord } from '../../../../../infrastructure/storage/DexieDatabase';
import { clearAuthSession, setAuthSession } from '../../../../../infrastructure/storage/AuthTokenStore';
import { SyncMutationName } from '../../../../../infrastructure/sync/SyncMutationCatalog';
import { AssertInputIdentityCommand } from '../../../../../application/usecases/sync/AssertInputIdentityCommand';
import { reconcileInputIdentityAnswers } from '../../../../sync/pull/reconcilers/inputIdentityReconciler';
import type { MixRule } from '../../../../../domain/inputs/mixRules';
import { CATALOG_PRODUCTS, matchProduct } from '../../../../../domain/inputs/inputCatalog';
import { LogVerificationStatus, type DailyLog, type FarmerProfile } from '../../../../../types';
import type { SyncPullResponse } from '../../../../../infrastructure/api/AgriSyncClient';
import { VoiceResultContainer, type VoiceResultContainerProps } from '../VoiceResultContainer';
import { forgetPlayedReveals } from '../RingStage';

const ME = 'a1a1a1a1-0000-4000-8000-000000000001';
const RAMESH = 'b2b2b2b2-0000-4000-8000-000000000002';
const NOW = 'c3c3c3c3-0000-4000-8000-000000000003';
const FARM = 'f0f0f0f0-0000-4000-8000-0000000000f1';
const ATT = '9a9a9a9a-0000-4000-8000-0000000000a1';
const DATE = '2026-10-26';

/** The reference rules with a TEST-ONLY review stamp (D-96: production ships none reviewed). */
const REVIEWED: MixRule[] = (referenceRules as { rules: MixRule[] }).rules.map(r => ({ ...r, reviewedBy: 'test-fixture', reviewedOn: '2026-11-06' }));

const log = (id: string, over: Record<string, unknown>): DailyLog => ({
    id, date: DATE, dayOutcome: 'WORK_RECORDED',
    context: { selection: [{ cropId: 'c1', cropName: 'Grapes', selectedPlotIds: ['plot-1'], selectedPlotNames: ['प्लॉट १'] }] },
    cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [],
    verification: { status: LogVerificationStatus.DRAFT, required: true },
    meta: { createdAtISO: '2026-10-26T10:00:00.000Z', createdByOperatorId: ME, farmId: FARM },
    ...over,
}) as unknown as DailyLog;

/** One spray of a known insecticide (Confidor) and a product the library does not know. */
const SPRAY = {
    id: 'ev-spray', method: 'Spray', sourceText: 'कॉन्फिडॉर आणि प्रेम गोल्ड फवारलं',
    mix: [
        { id: 'm-conf', productName: 'कॉन्फिडॉर', dose: 1, unit: 'ml' },
        { id: 'm-prem', productName: 'प्रेम गोल्ड' },
    ],
};
/** Calcium nitrate and 19:19:19 in ONE drip tank (a never-together pair when a reviewed rule exists). */
const DRIP = {
    id: 'ev-drip', method: 'Drip', sourceText: 'कॅल्शियम नायट्रेट आणि एकोणीस एकोणीस एकोणीस ठिबकने',
    mix: [
        { id: 'd-can', productName: 'कॅल्शियम नायट्रेट', dose: 2, unit: 'kg' },
        { id: 'd-npk', productName: '19:19:19', npkGrade: '19:19:19', dose: 3, unit: 'kg' },
    ],
};
const SAID = 'कॉन्फिडॉर आणि प्रेम गोल्ड फवारलं, कॅल्शियम नायट्रेट आणि एकोणीस एकोणीस एकोणीस ठिबकने';

/** A name the library answers with more than one product (an ingredient several products hold), found in the library itself. */
const AMBIGUOUS_NAME = (() => {
    for (const p of CATALOG_PRODUCTS) {
        for (const i of p.activeIngredients) {
            const name = i.mr ?? i.en;
            if (name && matchProduct(name).state === 'ambiguous') return name;
        }
    }
    return '';
})();

const productLog = (over: Record<string, unknown> = {}): DailyLog => log(NOW, { fullTranscript: SAID, inputs: [SPRAY, DRIP], ...over });

const clipRow = (): VoiceClipCacheRecord => ({
    id: 'clip-now', dailyLogId: NOW, farmId: 'farm-1', plotId: 'plot-1', recordedAtUtc: '2026-10-26T10:00:00.000Z', durationMs: 4000,
    mimeType: 'audio/webm', sizeBytes: 3, ciphertext: new Uint8Array([1]).buffer, iv: new Uint8Array([1]), wrappedDekId: 'dek',
    status: 'parsed', retentionPolicy: 'processing_30d', expiresAtUtc: '2026-11-25T00:00:00.000Z', createdAt: 'T', updatedAt: 'T',
} as unknown as VoiceClipCacheRecord);

const props = (over: Partial<VoiceResultContainerProps> = {}): VoiceResultContainerProps => {
    const history = over.history ?? [productLog()];
    return {
        result: { logIds: [history[0].id], clipId: 'clip-now', key: 'clip-now|T', unclear: [] },
        history,
        farmerProfile: { name: 'सुनील', activeOperatorId: ME, operators: [] } as unknown as FarmerProfile,
        operatorNameById: new Map([[RAMESH, 'रमेश']]),
        farmId: FARM,
        farmRole: 'PrimaryOwner',
        placeLabel: 'द्राक्ष · प्लॉट १',
        syncQueuedById: new Map([[history[0].id, true]]),
        onEdit: vi.fn(),
        onBack: vi.fn(),
        onAddAnother: vi.fn(),
        ...over,
    };
};
const mount = (p: VoiceResultContainerProps) => render(<VoiceResultContainer {...p} />);

/**
 * The app's own wiring in miniature (`useAppData`): `history` is state, read from Dexie at the start and again whenever the
 * `agrisync:sync-reconciled` event fires. A screen mounted through it shows an answer only if the answer's write tells the app to
 * re-read - no hand-built re-render.
 */
const LiveContainer: React.FC<{ base: VoiceResultContainerProps }> = ({ base }) => {
    const [history, setHistory] = React.useState<DailyLog[]>(base.history as DailyLog[]);
    React.useEffect(() => {
        const read = () => { void getDatabase().logs.toArray().then(rows => setHistory(rows.map(r => r.log))); };
        window.addEventListener('agrisync:sync-reconciled', read);
        return () => window.removeEventListener('agrisync:sync-reconciled', read);
    }, []);
    return <VoiceResultContainer {...base} history={history} />;
};
const mountLive = (p: VoiceResultContainerProps) => render(<LiveContainer base={p} />);
const open = (key: string) => fireEvent.click(screen.getByTestId(`vr-line-row-${key}`));
const assertRows = async () => (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === SyncMutationName.AssertInputIdentity);

beforeEach(async () => {
    vi.clearAllMocks();
    capture.mockReset();
    farmCtx.current = null;
    forgetPlayedReveals();
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
    setAuthSession({ userId: ME, accessToken: 't', expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString() });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:clip'), revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanup(); clearAuthSession(); vi.restoreAllMocks(); });

// =====================================================================================================================
describe('Task 1 - the simple form, one tappable line per part', () => {
    const sevenParts = () => log(NOW, {
        fullTranscript: SAID,
        cropActivities: [{ id: 'ca', title: 'छाटणी', sourceText: 'छाटणी' }],
        labour: [{ id: 'lb', count: 4 }],
        irrigation: [{ id: 'ir', durationHours: 2 }],
        inputs: [SPRAY],
        activityExpenses: [{ id: 'ex', reason: 'डिझेल', totalAmount: 400 }],
        machinery: [{ id: 'mc', type: 'tractor', hoursUsed: 1 }],
        observations: [{ id: 'ob', noteType: 'observation', textRaw: 'थोडी भुरी' }],
    });

    it('SevenPartDay_ShowsSevenLines_NothingExpanded', () => {
        mount(props({ history: [sevenParts()] }));
        const lines = within(screen.getByTestId('vr-lines')).getAllByTestId(/^vr-line-(?!row-|head-|body-|red-)/);
        expect(lines).toHaveLength(7);
        expect(lines.map(l => l.getAttribute('data-part')).sort()).toEqual(['crop', 'expense', 'inputs', 'irrigation', 'labour', 'machinery', 'observation']);
        expect(lines.every(l => l.getAttribute('data-open') === 'no')).toBe(true);
        expect(screen.queryAllByTestId(/^vr-line-body-/)).toHaveLength(0);
    });

    it('TapLine_OpensOnlyThatLine', () => {
        mount(props({ history: [sevenParts()] }));
        open('part:irrigation');
        expect(screen.getByTestId('vr-line-part:irrigation').getAttribute('data-open')).toBe('yes');
        expect(screen.getByTestId('vr-line-part:labour').getAttribute('data-open')).toBe('no');
        expect(screen.getAllByTestId(/^vr-line-body-/)).toHaveLength(1);
        open('part:labour');
        expect(screen.getAllByTestId(/^vr-line-body-/)).toHaveLength(2);
        open('part:irrigation'); // a second tap closes only that line
        expect(screen.getByTestId('vr-line-part:irrigation').getAttribute('data-open')).toBe('no');
        expect(screen.getByTestId('vr-line-part:labour').getAttribute('data-open')).toBe('yes');
    });

    it('HisWords_FoldedUnderOneLine_WithPlay', async () => {
        await getDatabase().voiceClips.bulkPut([clipRow()]);
        mount(props({ history: [sevenParts()] }));
        await waitFor(() => expect(screen.getByTestId('vr-play')).toBeTruthy()); // his recording's play button is on the fold
        expect(screen.queryByTestId('vr-words')).toBeNull();
        expect(screen.getByTestId('vr-words-toggle').textContent).toContain('तुमचं बोलणं');
        fireEvent.click(screen.getByTestId('vr-words-toggle'));
        expect(screen.getByTestId('vr-words').textContent).toContain('कॉन्फिडॉर');
        fireEvent.click(screen.getByTestId('vr-words-toggle'));
        expect(screen.queryByTestId('vr-words')).toBeNull();
    });

    it('ConfirmAndEdit_StillPresent_ForOwnerOnly', () => {
        mount(props({ history: [sevenParts()] }));
        expect(screen.getByTestId('vr-confirm')).toBeTruthy(); // I27 / D-44 / D-46: the primary owner's own "पक्कं आहे"
        expect(screen.getByTestId('vr-edit')).toBeTruthy();
        cleanup();
        mount(props({ history: [sevenParts()], farmRole: 'Worker' }));
        expect(screen.queryByTestId('vr-confirm')).toBeNull(); // never asked of anyone else
        expect(screen.getByTestId('vr-edit')).toBeTruthy();
    });
});

// =====================================================================================================================
describe('Task 2 - the product rows, the card, and हो / नाही / फोटो offline', () => {
    const openSpray = () => { open('inputs:ev-spray'); };
    const tapRow = (id: string) => fireEvent.click(screen.getByTestId(`vr-prow-${id}`));

    it('KnownProduct_TapShowsIngredientFormCompany', () => {
        mount(props());
        openSpray();
        const row = screen.getByTestId('vr-prow-m-conf');
        expect(row.getAttribute('data-type')).toBe('insecticide');
        expect(within(row).getByTestId('vr-prow-type').textContent).toBe('कीटकनाशक');
        expect(within(row).getByTestId('vr-prow-ingredient').textContent).toBe('इमिडाक्लोप्रिड 17.8%');
        expect(within(row).getByTestId('vr-prow-amount').textContent).toBe('1 मिली');
        tapRow('m-conf');
        const card = screen.getByTestId('vr-product-card');
        expect(within(card).getByTestId('vr-fact-ingredient').textContent).toContain('इमिडाक्लोप्रिड 17.8% · एसएल');
        expect(within(card).getByTestId('vr-fact-company').textContent).toContain('बायर');
        expect(within(card).getByTestId('vr-fact-dose').textContent).toContain('1 मिली'); // what he said, not a library dose
        expect(within(card).getByTestId('vr-card-source').textContent).toBe('माहिती: श्रमसफल लायब्ररी');
        expect(card.textContent).not.toContain('मार्गदर्शिका');
        expect(card.textContent).not.toMatch(/[A-Za-z]/);
    });

    it('UnknownProduct_ShowsNotFound_AndPhoto', () => {
        mount(props());
        openSpray();
        const row = screen.getByTestId('vr-prow-m-prem');
        expect(row.getAttribute('data-type')).toBe('unknown');
        expect(within(row).getByTestId('vr-prow-type').textContent).toBe('ओळख नाही');
        expect(within(row).getByTestId('vr-prow-status').textContent).toBe('हे औषध ओळखता आलं नाही');
        tapRow('m-prem');
        expect(screen.getByTestId('vr-card-unknown-note').textContent).toBe('हे औषध ओळखता आलं नाही');
        expect(screen.getByTestId('vr-card-photo').textContent).toContain('पॅकेटचा फोटो काढा');
        // No pick-from-list yet: a "हो" cannot be recorded for a product the library does not know.
        expect(screen.queryByTestId('vr-answer-yes')).toBeNull();
        expect(screen.queryByTestId('vr-answer-no')).toBeNull();
    });

    it('AmbiguousProduct_SaysLibraryFoundSeveral_AndOwnerWillLook_NoWayToPickPromised', () => {
        expect(AMBIGUOUS_NAME).not.toBe('');
        const ambiguous = log(NOW, { fullTranscript: AMBIGUOUS_NAME, inputs: [{ id: 'ev-amb', method: 'Spray', mix: [{ id: 'm-amb', productName: AMBIGUOUS_NAME }, { id: 'm-amb2', productName: 'प्रेम गोल्ड' }] }] });
        mount(props({ history: [ambiguous] }));
        open('inputs:ev-amb');
        const row = screen.getByTestId('vr-prow-m-amb');
        expect(row.querySelector('[data-testid="vr-prow-status"]')?.textContent).toBe('लायब्ररीत एकापेक्षा जास्त जुळले — मालक पाहतील');
        tapRow('m-amb');
        // The old line told him to "say which one" - nothing on this card lets him. Not any more.
        expect(screen.getByTestId('vr-card-unknown-note').textContent).toBe('लायब्ररीत एकापेक्षा जास्त जुळले — मालक पाहतील');
        expect(document.body.textContent).not.toContain('नक्की कुठलं ते सांगा');
        expect(screen.queryByTestId('vr-answer-yes')).toBeNull();
    });

    it('Yes_QueuesAssertInputIdentity_AndShowsShield_Offline', async () => {
        // The record as the phone holds it in Dexie; the screen reads it back from there (the live store does this in the app).
        const db = getDatabase();
        const record = productLog();
        await db.logs.put({ id: NOW, schemaVersion: 1, log: record, date: DATE, verificationStatus: record.verification?.status, createdByOperatorId: ME, isDeleted: 0 } as never);
        const held = (await db.logs.get(NOW))!;
        mountLive(props({ history: [held.log] }));
        openSpray();
        tapRow('m-conf');
        await act(async () => { fireEvent.click(screen.getByTestId('vr-answer-yes')); });
        await waitFor(() => expect(screen.queryByTestId('vr-product-sheet')).toBeNull()); // the card closes once it is kept

        const rows = await assertRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('PENDING'); // queued, no network needed
        const payload = rows[0].payload as Record<string, unknown>;
        expect(payload).toMatchObject({ farmId: FARM, dailyLogId: NOW, inputEventId: 'ev-spray', mixIndex: 0, verdict: 'confirmed', catalogProductId: 'p-imidacloprid-17-8-sl' });
        expect(Object.keys(payload).some(k => /check/i.test(k))).toBe(false); // the phone never sends is_check (D-95)
        expect(rows[0].clientRequestId).toBe(`assert_input_identity:${payload.assertionId as string}`);

        // The answer is on the record at once, offline, and ONLY the overlay changed (P7): every other field is as it was.
        const after = (await db.logs.get(NOW))!;
        const { inputIdentities, ...rest } = after.log;
        const { inputIdentities: none, ...restBefore } = held.log;
        expect(none).toBeUndefined();
        expect(rest).toEqual(restBefore);
        expect(after.serverModifiedAtUtc).toBe(held.serverModifiedAtUtc);
        expect(inputIdentities).toHaveLength(1);
        expect(inputIdentities?.[0]).toMatchObject({ inputEventId: 'ev-spray', mixIndex: 0, verdict: 'confirmed', pending: true, isCheck: false });
        // ... and it shows on the row by itself (no re-render by hand): his own answer, by his real name, as an answered state.
        await waitFor(() => expect(screen.getByTestId('vr-prow-m-conf').querySelector('[data-testid="vr-prow-status"]')?.textContent).toBe('सुनील: हो, हेच'));
        const status = screen.getByTestId('vr-prow-m-conf').querySelector('[data-testid="vr-prow-status"]');
        expect(status?.getAttribute('data-status')).toBe('said');
        expect(status?.getAttribute('data-verdict')).toBe('confirmed');
    });

    it('a second tap of the same answer is the SAME request: the button is off while that answer waits; a changed mind is a new request', async () => {
        const db = getDatabase();
        const record = productLog();
        await db.logs.put({ id: NOW, schemaVersion: 1, log: record, date: DATE, verificationStatus: record.verification?.status, createdByOperatorId: ME, isDeleted: 0 } as never);
        mountLive(props({ history: [(await db.logs.get(NOW))!.log] }));
        openSpray();
        tapRow('m-conf');
        await act(async () => { fireEvent.click(screen.getByTestId('vr-answer-yes')); });
        await waitFor(() => expect(screen.queryByTestId('vr-product-sheet')).toBeNull());
        await waitFor(() => expect(screen.getByTestId('vr-prow-m-conf').querySelector('[data-status="said"]')).toBeTruthy());

        tapRow('m-conf'); // open it again
        expect((screen.getByTestId('vr-answer-yes') as HTMLButtonElement).disabled).toBe(true);
        await act(async () => { fireEvent.click(screen.getByTestId('vr-answer-yes')); });
        expect(await assertRows()).toHaveLength(1); // no second answer queued

        await act(async () => { fireEvent.click(screen.getByTestId('vr-answer-no')); }); // he changed his mind: a new request
        await waitFor(() => expect(screen.queryByTestId('vr-product-sheet')).toBeNull());
        const rows = await assertRows();
        expect(rows).toHaveLength(2);
        expect(rows.map(r => (r.payload as { verdict: string }).verdict)).toEqual(['confirmed', 'rejected']);
        await waitFor(() => expect(screen.getByTestId('vr-prow-m-conf').querySelector('[data-status="said"]')?.getAttribute('data-verdict')).toBe('rejected'));
    });

    it('Photo_UsesCreateAttachment_DailyLogParent_ThenAsserts', async () => {
        capture.mockResolvedValue({ id: ATT, status: 'pending' });
        const enqueue = vi.spyOn(AssertInputIdentityCommand, 'enqueue');
        mount(props());
        openSpray();
        tapRow('m-prem');
        await act(async () => { fireEvent.click(screen.getByTestId('vr-card-photo')); });
        await waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
        expect(capture).toHaveBeenCalledWith({ source: 'camera', farmId: FARM, linkedEntityId: NOW, linkedEntityType: 'DailyLog' });
        expect(capture.mock.invocationCallOrder[0]).toBeLessThan(enqueue.mock.invocationCallOrder[0]); // the photo first, THEN the answer
        expect(enqueue.mock.calls[0][0]).toMatchObject({ dailyLogId: NOW, inputEventId: 'ev-spray', mixIndex: 1, verdict: 'photo', attachmentId: ATT });
        const [row] = await assertRows();
        expect(row.payload).toMatchObject({ verdict: 'photo', attachmentId: ATT });
        expect((row.payload as Record<string, unknown>).catalogProductId).toBeUndefined();
    });

    it('PhotoState_Says_PhotoKept', async () => {
        capture.mockResolvedValue({ id: ATT, status: 'pending' });
        mount(props());
        openSpray();
        tapRow('m-prem');
        await act(async () => { fireEvent.click(screen.getByTestId('vr-card-photo')); });
        // The record on the screen is the test's own: the answer is laid on the stored record, which a pull hands back.
        await waitFor(() => expect(screen.queryByTestId('vr-product-sheet')).toBeNull());
        expect(document.body.textContent).not.toContain('पॅकेटवरून'); // P5: never "filled from the packet"
        cleanup();
        // The same record, with the photo answer on it (as the pull gives it back): the row says "फोटो ठेवला".
        const withPhoto = productLog({ inputIdentities: [{ assertionId: 'as-1', inputEventId: 'ev-spray', mixIndex: 1, verdict: 'photo', attachmentId: ATT, catalogVersion: 'inputs-2', assertedByUserId: ME, assertedAtUtc: '2026-10-26T10:05:00.000Z', isCheck: false }] });
        mount(props({ history: [withPhoto] }));
        openSpray();
        expect(screen.getByTestId('vr-prow-m-prem').querySelector('[data-testid="vr-prow-status"]')?.textContent).toBe('फोटो ठेवला');
        expect(document.body.textContent).not.toContain('पॅकेटवरून');
    });

    it('AfterReinstall_PullRestoresAnswers', async () => {
        // A new phone: the first pull brings the record and, in its own list, the answers.
        const db = getDatabase();
        const bare = productLog();
        await db.logs.put({ id: NOW, schemaVersion: 1, log: bare, date: DATE, verificationStatus: bare.verification?.status, createdByOperatorId: ME, isDeleted: 0 } as never);
        const dto = (over: Record<string, unknown>) => ({
            farmId: FARM, dailyLogId: NOW, inputEventId: 'ev-spray', mixIndex: 0, spokenName: 'कॉन्फिडॉर', verdict: 'confirmed',
            catalogProductId: 'p-imidacloprid-17-8-sl', catalogVersion: 'inputs-2', ...over,
        });
        const payload = { inputIdentityAssertions: [
            dto({ assertionId: 'as-sp', assertedByUserId: ME, assertedAtUtc: '2026-10-26T10:01:00.000Z', isCheck: false }),
            dto({ assertionId: 'as-ck', assertedByUserId: RAMESH, assertedAtUtc: '2026-10-26T11:00:00.000Z', isCheck: true }),
        ] } as unknown as SyncPullResponse;
        await db.transaction('rw', [db.logs, db.mutationQueue], async () => { await reconcileInputIdentityAnswers(db, payload); });
        const restored = (await db.logs.get(NOW))!.log;
        expect(restored.inputIdentities).toHaveLength(2);
        expect(restored.inputs).toEqual(bare.inputs); // only the overlay arrived

        mount(props({ history: [restored] }));
        openSpray();
        expect(screen.getByTestId('vr-prow-m-conf').querySelector('[data-testid="vr-prow-status"]')?.textContent).toBe('रमेश यांनी तपासलं');
        tapRow('m-conf');
        // The speaker's answer stays HIS, beside the check (D-95).
        expect(screen.getByTestId('vr-card-speaker-said').textContent).toBe('सुनीलने सांगितलं: हो, हेच');
        expect(screen.getByTestId('vr-card-checked').textContent).toBe('रमेश यांनी तपासलं');
    });

    it('NonChecker_SeesOwnerWillCheck_AndOptionalCard', () => {
        mount(props({ farmRole: 'Worker' }));
        // One line under the badges (D-95), the founder's words.
        expect(screen.getByTestId('vr-speaker-done').textContent).toBe('तुमचं काम झालं. नोंद ठेवली. औषधं मालक नंतर तपासतील.');
        openSpray();
        expect(screen.getByTestId('vr-prow-m-conf').querySelector('[data-testid="vr-prow-status"]')?.textContent).toBe('मालक तपासतील');
        tapRow('m-conf');
        expect(screen.getByTestId('vr-card-question').textContent).toBe('माहीत असेल तर सांगा (ऐच्छिक)');
        expect(screen.getByTestId('vr-card-close').textContent).toBe('माहीत नाही, मालक पाहतील');
        fireEvent.click(screen.getByTestId('vr-card-close'));
        expect(screen.queryByTestId('vr-product-sheet')).toBeNull();
        return assertRows().then(rows => expect(rows).toHaveLength(0)); // "माहीत नाही" asks nothing of the server and blocks nothing (P9)
    });

    it('Checker_SeesHechKaTapasa', () => {
        farmCtx.current = { currentFarm: { farmId: FARM, role: 'CoOwner', authorities: [{ name: 'ConfirmRecords', expiresAtUtc: null }] } };
        mount(props({ farmRole: 'CoOwner' }));
        expect(screen.queryByTestId('vr-speaker-done')).toBeNull();
        openSpray();
        expect(screen.getByTestId('vr-prow-m-conf').querySelector('[data-testid="vr-prow-status"]')?.textContent).toBe('हेच का? तपासा');
        tapRow('m-conf');
        expect(screen.getByTestId('vr-card-question').textContent).toBe('हेच औषध वापरलं का?');
        expect(screen.getByTestId('vr-card-close').textContent).toBe('नंतर पाहीन');
    });
});

// =====================================================================================================================
describe('Task 3 - the combination box and the red banner', () => {
    const tapBanner = () => fireEvent.click(screen.getByTestId('vr-mix-banner'));

    it('SameMixCalciumAnd191919_RedBannerOnTop_TapOpensDripLine', () => {
        mount(props({ mixRules: REVIEWED }));
        const banner = screen.getByTestId('vr-mix-banner');
        expect(banner.textContent).toContain('एक मिश्रण चुकीचं आहे');
        expect(banner.textContent).toContain('ठिबकातून सोडलं');
        // On top: the first thing on the screen, before the place and day chips.
        expect(screen.getByTestId('voice-result').firstElementChild).toBe(banner);
        expect(screen.getByTestId('vr-line-inputs:ev-drip').getAttribute('data-open')).toBe('no');
        tapBanner();
        expect(screen.getByTestId('vr-line-inputs:ev-drip').getAttribute('data-open')).toBe('yes');
        expect(screen.getByTestId('vr-line-inputs:ev-spray').getAttribute('data-open')).toBe('no'); // only that line
        expect(within(screen.getByTestId('vr-line-body-inputs:ev-drip')).getByTestId('vr-mixbox').getAttribute('data-state')).toBe('red');
        expect(screen.getByTestId('vr-line-red-inputs:ev-drip')).toBeTruthy(); // the flag sits on the line that holds it
    });

    it('RedBox_ShowsWhyNextTimeSource_AndRecordUnchanged', () => {
        mount(props({ mixRules: REVIEWED }));
        tapBanner();
        const box = screen.getByTestId('vr-mixbox');
        const rule = REVIEWED.find(r => r.id === 'R1') as MixRule;
        expect(within(box).getByTestId('vr-mix-title').textContent).toBe('हे मिश्रण चुकीचं आहे');
        expect(within(box).getByTestId('vr-mix-why').textContent).toBe(rule.why.mr);
        expect(within(box).getByTestId('vr-mix-next').textContent).toBe(rule.nextTime.mr);
        expect(within(box).getByTestId('vr-mix-source').textContent).toBe(`स्रोत: ${rule.sources[0].title} · नोंद सांगितली तशीच राहील`);
    });

    it('NoRuleCombination_Grey', () => {
        // Production rules: none is reviewed (D-96), so nothing is red. The drip tank is two KNOWN products: plain grey.
        mount(props());
        expect(screen.queryByTestId('vr-mix-banner')).toBeNull();
        open('inputs:ev-drip');
        expect(within(screen.getByTestId('vr-line-body-inputs:ev-drip')).getByTestId('vr-mixbox').getAttribute('data-state')).toBe('grey');
        expect(within(screen.getByTestId('vr-line-body-inputs:ev-drip')).getByTestId('vr-mix-title').textContent).toBe('मिसळण्याची नोंद नाही');
        // The spray holds a product the library does not know: never green, and it says why it could not be checked.
        open('inputs:ev-spray');
        expect(within(screen.getByTestId('vr-line-body-inputs:ev-spray')).getByTestId('vr-mix-title').textContent).toBe('ओळख नसल्याने तपासता आलं नाही');
    });

    it('SeparateEvents_NoCombination', () => {
        // The same two products on the same day, but in two separate events: no tank, so no combination and no verdict.
        const separate = log(NOW, {
            fullTranscript: SAID,
            inputs: [
                { id: 'ev-a', method: 'Drip', mix: [{ id: 'a1', productName: 'कॅल्शियम नायट्रेट', dose: 2, unit: 'kg' }] },
                { id: 'ev-b', method: 'Drip', mix: [{ id: 'b1', productName: '19:19:19', npkGrade: '19:19:19', dose: 3, unit: 'kg' }] },
            ],
        });
        mount(props({ history: [separate], mixRules: REVIEWED }));
        expect(screen.queryByTestId('vr-mix-banner')).toBeNull();
        open('inputs:ev-a');
        open('inputs:ev-b');
        expect(screen.queryByTestId('vr-mixbox')).toBeNull();
    });

    it('RedVerdict_DoesNotEditTheLog', async () => {
        // The record lives in Dexie as the phone holds it; showing the verdict - and opening everything - changes none of it (P7).
        const db = getDatabase();
        const record = productLog();
        await db.logs.put({ id: NOW, schemaVersion: 1, log: record, date: DATE, verificationStatus: record.verification?.status, createdByOperatorId: ME, isDeleted: 0 } as never);
        const before = JSON.stringify(await db.logs.get(NOW));
        const history = [(await db.logs.get(NOW))!.log];
        const historyBefore = JSON.stringify(history);

        mount(props({ history, mixRules: REVIEWED }));
        tapBanner();
        open('inputs:ev-spray');
        fireEvent.click(screen.getByTestId('vr-prow-d-can'));
        fireEvent.click(screen.getByTestId('vr-card-close'));
        await act(async () => { await Promise.resolve(); });

        expect(screen.getAllByTestId('vr-mixbox').map(b => b.getAttribute('data-state')).sort()).toEqual(['grey', 'red']);
        expect(JSON.stringify(await db.logs.get(NOW))).toBe(before);
        expect(JSON.stringify(history)).toBe(historyBefore);
        expect(await assertRows()).toHaveLength(0); // looking at a verdict sends nothing
    });
});
