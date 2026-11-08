// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT5, Task 2b; IT3 Task 3a; founders D-92, D-95, doctrine P7, P9) - the
 * products of a record on its review card. The REAL sheet over a real Dexie (fake-indexeddb) and the real sync queue; only the
 * camera, the original-voice player and the sync worker are stood in for.
 *
 * Phone numbers, where any appear, are the fake 600000xxxx kind.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { enqueueOwnerConfirmation, enqueue } = vi.hoisted(() => ({ enqueueOwnerConfirmation: vi.fn(), enqueue: vi.fn() }));
vi.mock('../../../../application/usecases/sync/VerifyLogCommand', () => ({
    VerifyLogCommand: { enqueue: (...a: unknown[]) => enqueue(...a), enqueueOwnerConfirmation: (...a: unknown[]) => enqueueOwnerConfirmation(...a) },
}));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined), start: vi.fn(), stop: vi.fn() },
}));
vi.mock('../../../logs/components/originalVoice/OriginalVoiceButton', () => ({ default: () => null }));
vi.mock('../../../../application/use-cases/CaptureAttachment', () => ({ captureAttachment: vi.fn() }));

import ReviewSheet from '../ReviewSheet';
import { EMPTY_LABOUR_DATA } from '../../labourMock';
import type { LabourData, ReviewItem } from '../../labourMock';
import type { ReviewProduct } from '../../labour.types';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { clearAuthSession, setAuthSession } from '../../../../infrastructure/storage/AuthTokenStore';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { LogVerificationStatus, type DailyLog } from '../../../../types';

const OWNER = 'a1a1a1a1-0000-4000-8000-000000000001';
const SUNIL = 'b2b2b2b2-0000-4000-8000-000000000002';
const TRUSTED = 'c3c3c3c3-0000-4000-8000-000000000003';
const LOG = 'd4d4d4d4-0000-4000-8000-000000000004';
const FARM = 'f0f0f0f0-0000-4000-8000-0000000000f1';
const DATE = '2026-11-09';

const SPRAY = {
    id: 'ev-spray', method: 'Spray', sourceText: 'कॉन्फिडॉर आणि प्रेम गोल्ड फवारलं',
    mix: [
        { id: 'm-conf', productName: 'कॉन्फिडॉर', dose: 1, unit: 'ml' },
        { id: 'm-prem', productName: 'प्रेम गोल्ड' },
    ],
};

/** The record as a worker (Sunil) made it and this phone holds it. */
const localLog = (over: Record<string, unknown> = {}): DailyLog => ({
    id: LOG, date: DATE, dayOutcome: 'WORK_RECORDED',
    context: { selection: [{ cropId: 'c1', cropName: 'Grapes', selectedPlotIds: ['plot-1'], selectedPlotNames: ['प्लॉट १'] }] },
    cropActivities: [], irrigation: [], labour: [], machinery: [], inputs: [SPRAY],
    verification: { status: LogVerificationStatus.DRAFT, required: true },
    meta: { createdAtISO: '2026-11-09T10:00:00.000Z', createdByOperatorId: SUNIL, farmId: FARM },
    ...over,
}) as unknown as DailyLog;

const sunilYes = { verdict: 'confirmed' as const, catalogProductId: 'p-imidacloprid-17-8-sl', assertedByUserId: SUNIL, assertedAtUtc: '2026-11-09T10:05:00.000Z' };
const PRODUCTS: ReviewProduct[] = [
    { inputEventId: 'ev-spray', mixIndex: 0, spokenName: 'कॉन्फिडॉर', match: { state: 'found', productId: 'p-imidacloprid-17-8-sl' }, speakerAnswer: sunilYes },
    { inputEventId: 'ev-spray', mixIndex: 1, spokenName: 'प्रेम गोल्ड', match: { state: 'notFound' } },
];

const card = (over: Partial<ReviewItem> = {}): ReviewItem => ({
    id: LOG, who: 'सुनील', initial: 'स', tone: 'or', detail: DATE, status: 'Draft', version: 1,
    plot: 'प्लॉट १', plotScope: 'Plot', points: { count: 6, task: 'फवारणी' }, products: PRODUCTS, uncheckedProductCount: 2, ...over,
});
const dataOf = (review: ReviewItem[], over: Partial<LabourData> = {}): LabourData => ({ ...EMPTY_LABOUR_DATA, review, canConfirm: true, ...over });

/** The app's own wiring in miniature (`useAppData`): history is state, re-read from Dexie when `agrisync:sync-reconciled` fires. */
const LiveSheet: React.FC<{ data: LabourData; start: DailyLog[]; ownName?: string }> = ({ data, start, ownName }) => {
    const [history, setHistory] = React.useState<DailyLog[]>(start);
    React.useEffect(() => {
        const read = () => { void getDatabase().logs.toArray().then(rows => setHistory(rows.map(r => r.log))); };
        window.addEventListener('agrisync:sync-reconciled', read);
        return () => window.removeEventListener('agrisync:sync-reconciled', read);
    }, []);
    return <ReviewSheet open data={data} onClose={vi.fn()} onToast={vi.fn()} farmId={FARM} history={history} ownName={ownName} />;
};

const putLog = async (record: DailyLog) => {
    await getDatabase().logs.put({ id: record.id, schemaVersion: 1, log: record, date: record.date, verificationStatus: record.verification?.status, createdByOperatorId: SUNIL, isDeleted: 0 } as never);
    return (await getDatabase().logs.get(record.id))!.log;
};
const assertRows = async () => (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === SyncMutationName.AssertInputIdentity);
const statusOf = (rowId: string) => screen.getByTestId(`vr-prow-${rowId}`).querySelector('[data-testid="vr-prow-status"]');

beforeEach(async () => {
    vi.clearAllMocks();
    enqueue.mockResolvedValue('id');
    enqueueOwnerConfirmation.mockResolvedValue('id');
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
    setAuthSession({ userId: OWNER, accessToken: 't', expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString() });
});
afterEach(() => { cleanup(); clearAuthSession(); window.localStorage.clear(); });

describe('the review card - the products of the record (IT5 Task 2b)', () => {
    it('ReviewCard_ShowsProducts_WithSpeakerAnswer: an "औषधं" block of big rows, the speaker\'s answer kept as HIS, the doses he said', async () => {
        const held = await putLog(localLog());
        render(<ReviewSheet open data={dataOf([card()])} onClose={vi.fn()} onToast={vi.fn()} farmId={FARM} history={[held]} ownName="प्रकाश" />);

        const block = screen.getByTestId(`review-products-${LOG}`);
        expect(within(block).getByTestId(`review-products-title-${LOG}`)).toHaveTextContent('औषधं');
        // nothing is checked yet - the speaker's own answer is not a check - and checking is optional
        expect(within(block).getByTestId(`review-products-count-${LOG}`)).toHaveTextContent('२ तपासायची · ऐच्छिक');
        expect(within(block).getAllByTestId(/^vr-prow-/).filter(e => e.tagName === 'BUTTON')).toHaveLength(2);

        // the speaker's answer, by the speaker's name, as an answer of his (not a check)
        const conf = statusOf('m-conf');
        expect(conf?.textContent).toBe('सुनील: हो, हेच');
        expect(conf?.getAttribute('data-status')).toBe('said');
        expect(screen.getByTestId('vr-prow-m-conf')).toHaveTextContent('1 मिली'); // the dose HE said, from the record this phone holds
        // a product the library does not know is shown as such, never as found
        expect(screen.getByTestId('vr-prow-m-prem')).toHaveTextContent('हे औषध ओळखता आलं नाही');

        // one tap opens the card: "सुनीलने सांगितलं: ..." and the checker's question
        fireEvent.click(screen.getByTestId('vr-prow-m-conf'));
        expect(screen.getByTestId('vr-card-speaker-said')).toHaveTextContent('सुनीलने सांगितलं: हो, हेच');
        expect(screen.getByTestId('vr-card-question')).toHaveTextContent('हेच औषध वापरलं का?');
        // the card sits above the sheet (outside its transformed box)
        expect(screen.getByTestId(`review-product-card-host-${LOG}`).parentElement).toBe(document.body);
    });

    it('ReviewCard_ShowsProducts_WithSpeakerAnswer: with the record not on this phone the row is his word and nothing more - no dose is made up', () => {
        render(<ReviewSheet open data={dataOf([card()])} onClose={vi.fn()} onToast={vi.fn()} farmId={FARM} history={[]} />);
        expect(statusOf('ev-spray:0')?.textContent).toBe('सुनील: हो, हेच');
        const text = screen.getByTestId('vr-prow-ev-spray:0').textContent ?? '';
        expect(text).toContain('कॉन्फिडॉर');
        expect(screen.getByTestId('vr-prow-ev-spray:0').querySelector('[data-testid="vr-prow-amount"]')).toBeNull();
    });

    it('a reader the server did not send the products to, or a record that names none, draws no block at all', () => {
        render(<ReviewSheet open data={dataOf([card({ products: undefined, uncheckedProductCount: undefined })])} onClose={vi.fn()} onToast={vi.fn()} farmId={FARM} />);
        expect(screen.queryByTestId(`review-products-${LOG}`)).toBeNull();
        cleanup();
        render(<ReviewSheet open data={dataOf([card({ products: [], uncheckedProductCount: 0 })])} onClose={vi.fn()} onToast={vi.fn()} farmId={FARM} />);
        expect(screen.queryByTestId(`review-products-${LOG}`)).toBeNull();
        expect(screen.queryByTestId(`review-approve-anyway-${LOG}`)).toBeNull();
    });

    it('CheckerYes_QueuesAssert_AndRowShowsChecked: "हो" queues the answer offline and the row shows it checked at once - no hand-built re-render, the record unchanged', async () => {
        const held = await putLog(localLog());
        render(<LiveSheet data={dataOf([card()])} start={[held]} ownName="प्रकाश" />);

        fireEvent.click(screen.getByTestId('vr-prow-m-conf'));
        await act(async () => { fireEvent.click(screen.getByTestId('vr-answer-yes')); });
        await waitFor(() => expect(screen.queryByTestId('vr-product-sheet')).toBeNull()); // the card closes once it is kept

        // queued, no network needed, and the phone sends no "is check" (the server decides from his standing, D-95)
        const rows = await assertRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('PENDING');
        const payload = rows[0].payload as Record<string, unknown>;
        expect(payload).toMatchObject({ farmId: FARM, dailyLogId: LOG, inputEventId: 'ev-spray', mixIndex: 0, verdict: 'confirmed', catalogProductId: 'p-imidacloprid-17-8-sl' });
        expect(Object.keys(payload).some(k => /check/i.test(k))).toBe(false);

        // the row is CHECKED (his name, the checker's line) and the count went down - all by the app's own refresh
        await waitFor(() => expect(statusOf('m-conf')?.getAttribute('data-status')).toBe('checked'));
        expect(statusOf('m-conf')?.textContent).toBe('प्रकाश यांनी तपासलं');
        expect(statusOf('m-conf')?.getAttribute('data-verdict')).toBe('confirmed');
        expect(screen.getByTestId(`review-products-count-${LOG}`)).toHaveTextContent('१ तपासायची · ऐच्छिक');
        // the other row is untouched
        expect(statusOf('m-prem')?.getAttribute('data-status')).toBe('notFound');

        // P7: only the overlay changed; his dose, name and date are exactly as said; and the speaker's own answer still stands as HIS
        const after = (await getDatabase().logs.get(LOG))!.log;
        const { inputIdentities, ...rest } = after;
        const { inputIdentities: none, ...before } = held;
        expect(none).toBeUndefined();
        expect(rest).toEqual(before);
        expect(inputIdentities).toHaveLength(1);
        expect(after.inputs?.[0]).toEqual(held.inputs?.[0]);
    });

    it('CheckerYes_QueuesAssert_AndRowShowsChecked: when all are checked the block says so; "नाही" is also a check', async () => {
        const held = await putLog(localLog());
        render(<LiveSheet data={dataOf([card({ products: [PRODUCTS[0]] })])} start={[held]} ownName="प्रकाश" />);
        fireEvent.click(screen.getByTestId('vr-prow-m-conf'));
        await act(async () => { fireEvent.click(screen.getByTestId('vr-answer-no')); });
        await waitFor(() => expect(statusOf('m-conf')?.getAttribute('data-status')).toBe('checked'));
        expect(statusOf('m-conf')?.getAttribute('data-verdict')).toBe('rejected');
        expect(screen.getByTestId(`review-products-count-${LOG}`)).toHaveTextContent('सगळी तपासली');
        expect(screen.queryByTestId(`review-approve-anyway-${LOG}`)).toBeNull(); // nothing left to skip
    });

    it('Approve_WithUncheckedProducts_Allowed: मंजूर and शंका are on at once with every product unchecked, and say they may be done without checking', async () => {
        const held = await putLog(localLog());
        render(<ReviewSheet open data={dataOf([card()])} onClose={vi.fn()} onToast={vi.fn()} farmId={FARM} history={[held]} />);
        expect(screen.getByTestId(`review-products-count-${LOG}`)).toHaveTextContent('२ तपासायची');
        const approve = screen.getByTestId(`review-approve-${LOG}`);
        expect(approve).toBeEnabled();
        expect(screen.getByTestId(`review-query-${LOG}`)).toBeEnabled();
        expect(screen.getByTestId(`review-approve-anyway-${LOG}`)).toHaveTextContent('औषधं न तपासता मंजूर केलं तरी चालेल.');

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            fireEvent.click(approve);
            await act(async () => { await vi.advanceTimersByTimeAsync(450 + 3100); });
        } finally {
            vi.useRealTimers();
        }
        // the confirmation went to the one write, with the record's version - no product was asked about first
        expect(enqueueOwnerConfirmation).toHaveBeenCalledWith(LOG, expect.objectContaining({ verifierUserId: OWNER, logVersion: 1 }));
        expect(await assertRows()).toHaveLength(0);
    });

    it('TrustedPerson_SameScreens_AsOwner: a trusted person who may confirm sees the same block, rows and words as the owner; one who may not is told "मालक तपासतील"', async () => {
        const held = await putLog(localLog());
        const markup = () => screen.getByTestId(`review-products-${LOG}`).innerHTML;

        render(<ReviewSheet open data={dataOf([card()])} onClose={vi.fn()} onToast={vi.fn()} farmId={FARM} history={[held]} ownName="प्रकाश" />);
        const asOwner = markup();
        expect(statusOf('m-prem')?.getAttribute('data-status')).toBe('notFound');
        cleanup();

        // a trusted person: not the primary owner, but the server says he may confirm records (`canConfirm`) - the same sheet
        clearAuthSession();
        setAuthSession({ userId: TRUSTED, accessToken: 't', expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString() });
        render(<ReviewSheet open data={dataOf([card()], { canConfirm: true })} onClose={vi.fn()} onToast={vi.fn()} farmId={FARM} history={[held]} ownName="गणेश" />);
        expect(markup()).toBe(asOwner);
        fireEvent.click(screen.getByTestId('vr-prow-m-conf'));
        expect(screen.getByTestId('vr-card-question')).toHaveTextContent('हेच औषध वापरलं का?');
        fireEvent.click(screen.getByTestId('vr-card-close'));
        cleanup();

        // someone the server did not give the authority: the same rows, but he is not asked to check
        render(<ReviewSheet open data={dataOf([card()], { canConfirm: false })} onClose={vi.fn()} onToast={vi.fn()} farmId={FARM} history={[held]} />);
        expect(screen.queryByTestId(`review-approve-${LOG}`)).toBeNull();
        fireEvent.click(screen.getByTestId('vr-prow-m-conf'));
        expect(screen.getByTestId('vr-card-question')).toHaveTextContent('माहीत असेल तर सांगा (ऐच्छिक)');
    });
});

describe('the review card - what reaches it from the server (IT5 Task 2b)', () => {
    const wire = (over: Record<string, unknown> = {}) => ({
        id: LOG, who: 'सुनील', initial: 'स', tone: 'or', detail: DATE, status: 'Draft', points: { count: 6, shift: null, task: 'फवारणी', amount: null, names: [] },
        plot: 'प्लॉट १', plotScope: 'Plot', version: 1, hasRecording: false, ...over,
    });

    it('ReviewCard_ShowsProducts_WithSpeakerAnswer (wire): products and the newest answers are read as sent; a broken row or an unknown word is dropped, never guessed', async () => {
        const { mapReview } = await import('../../data/labourClient');
        const item = mapReview(wire({
            products: [
                { inputEventId: 'ev-spray', mixIndex: 0, spokenName: ' कॉन्फिडॉर ', match: { state: 'found', productId: 'p-imidacloprid-17-8-sl' },
                    speakerAnswer: { verdict: 'Confirmed', catalogProductId: 'p-imidacloprid-17-8-sl', assertedByUserId: SUNIL, assertedAtUtc: '2026-11-09T10:05:00Z' },
                    check: { verdict: 'maybe', assertedByUserId: OWNER, assertedAtUtc: '2026-11-09T10:06:00Z' } },
                { inputEventId: 'ev-spray', mixIndex: 1, spokenName: 'प्रेम गोल्ड', match: { state: 'notFound' } },
                { inputEventId: 'ev-spray', mixIndex: 2, spokenName: '', match: { state: 'found' } }, // no name: dropped
                { inputEventId: 'ev-spray', mixIndex: 3, spokenName: 'x', match: { state: 'nearly' } }, // a match word nobody defined: dropped
            ],
            uncheckedProductCount: 2,
        }) as never);
        expect(item.uncheckedProductCount).toBe(2);
        expect(item.products).toEqual([
            { inputEventId: 'ev-spray', mixIndex: 0, spokenName: 'कॉन्फिडॉर', match: { state: 'found', productId: 'p-imidacloprid-17-8-sl' },
                speakerAnswer: { verdict: 'confirmed', catalogProductId: 'p-imidacloprid-17-8-sl', assertedByUserId: SUNIL, assertedAtUtc: '2026-11-09T10:05:00Z' } }, // 'maybe' is no answer
            { inputEventId: 'ev-spray', mixIndex: 1, spokenName: 'प्रेम गोल्ड', match: { state: 'notFound' } },
        ]);
    });

    it('a null (the reader may not hear the words) or an older server sends no products: the item carries none', async () => {
        const { mapReview } = await import('../../data/labourClient');
        for (const over of [{ products: null, uncheckedProductCount: null }, {}]) {
            const item = mapReview(wire(over) as never);
            expect('products' in item).toBe(false);
            expect('uncheckedProductCount' in item).toBe(false);
        }
        expect(mapReview(wire({ products: [], uncheckedProductCount: 0 }) as never).products).toEqual([]);
    });

    it('CheckButton_OpensReviewFocusedOnThatRecord (sheet): the record the door names is first on the sheet', () => {
        const other = card({ id: 'other-record', who: 'रमेश', products: undefined, uncheckedProductCount: undefined });
        render(<ReviewSheet open data={dataOf([other, card()])} onClose={vi.fn()} onToast={vi.fn()} farmId={FARM} focusLogId={LOG} />);
        const cards = Array.from(document.querySelectorAll('[data-testid^="review-card-"]')).map(e => e.getAttribute('data-testid'));
        expect(cards).toEqual([`review-card-${LOG}`, 'review-card-other-record']);
        expect(screen.getByTestId(`review-card-${LOG}`).getAttribute('data-focused')).toBe('true');
    });
});
