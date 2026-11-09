// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT-D2; founder D-123b, 2026-11-09) - तपासणी / आढावा (IT5): the "औषधं" block
 * of a review card ("N तपासायची · ऐच्छिक", the dose he said, the ingredient's percentage), the card the rows open, the bulk lines and
 * the "औषधं तपासा (N)" button show Devanagari digits in Marathi mode and keep 0-9 in English mode. The REAL sheet over a real Dexie
 * (fake-indexeddb); only the camera, the original-voice player and the sync worker are stood in for.
 *
 * The scan is the WHOLE sheet. It lets through one thing, named: "19:19:19" is a product written by its grade, as recorded - a name,
 * not a number the app printed.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const { enqueueOwnerConfirmation, enqueue, lng } = vi.hoisted(() => ({ enqueueOwnerConfirmation: vi.fn(), enqueue: vi.fn(), lng: { v: 'mr' as 'mr' | 'en' } }));
vi.mock('../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../i18n/translations');
    const ctx = () => ({ language: lng.v, setLanguage: () => undefined, t: (k: string) => t(k, lng.v) });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});
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
import { ProductCheckAuthority, CheckProductsButton } from '../../../reflect/day/CheckProducts';
import { approvalWords } from '../../../approval/approvalWords';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { clearAuthSession, setAuthSession } from '../../../../infrastructure/storage/AuthTokenStore';
import { LogVerificationStatus, type DailyLog } from '../../../../types';
import { latinDigitFindings } from '../../../../shared/test/latinDigits';

const OWNER = 'a1a1a1a1-0000-4000-8000-000000000001';
const SUNIL = 'b2b2b2b2-0000-4000-8000-000000000002';
const LOG = 'd4d4d4d4-0000-4000-8000-000000000004';
const LOG2 = 'e5e5e5e5-0000-4000-8000-000000000005';
const FARM = 'f0f0f0f0-0000-4000-8000-0000000000f1';
const DATE = '2026-11-09';
const CONFIDOR = 'p-imidacloprid-17-8-sl';

/** NOT numbers the app printed: a product named by its grade, as recorded. */
const NOT_NUMBERS = ['19:19:19'];

const SPRAY = {
    id: 'ev-spray', method: 'Spray', sourceText: 'कॉन्फिडॉर आणि प्रेम गोल्ड फवारलं',
    mix: [
        { id: 'm-conf', productName: 'कॉन्फिडॉर', dose: 250, unit: 'ml' },
        { id: 'm-prem', productName: 'प्रेम गोल्ड', dose: 1.5, unit: 'kg' },
        { id: 'm-npk', productName: '19:19:19', npkGrade: '19:19:19', numbers: { dose: { certainty: 'reported', quantity: 3, unit: 'kg', spokenText: '3 किलो' } } },
    ],
};
const localLog = (id: string): DailyLog => ({
    id, date: DATE, dayOutcome: 'WORK_RECORDED',
    context: { selection: [{ cropId: 'c1', cropName: 'Grapes', selectedPlotIds: ['plot-1'], selectedPlotNames: ['प्लॉट १'] }] },
    cropActivities: [], irrigation: [], labour: [], machinery: [], inputs: [SPRAY],
    verification: { status: LogVerificationStatus.DRAFT, required: true },
    meta: { createdAtISO: '2026-11-09T10:00:00.000Z', createdByOperatorId: SUNIL, farmId: FARM },
}) as unknown as DailyLog;

const sunilYes = { verdict: 'confirmed' as const, catalogProductId: CONFIDOR, assertedByUserId: SUNIL, assertedAtUtc: '2026-11-09T10:05:00.000Z' };
const PRODUCTS: ReviewProduct[] = [
    { inputEventId: 'ev-spray', mixIndex: 0, spokenName: 'कॉन्फिडॉर', match: { state: 'found', productId: CONFIDOR }, speakerAnswer: sunilYes },
    { inputEventId: 'ev-spray', mixIndex: 1, spokenName: 'प्रेम गोल्ड', match: { state: 'notFound' } },
    { inputEventId: 'ev-spray', mixIndex: 2, spokenName: '19:19:19', match: { state: 'notFound' } },
];
const card = (id: string, over: Partial<ReviewItem> = {}): ReviewItem => ({
    id, who: 'सुनील', initial: 'स', tone: 'or', detail: DATE, status: 'Draft', version: 1,
    plot: 'प्लॉट १', plotScope: 'Plot', points: { count: 6, task: 'फवारणी' }, products: PRODUCTS, uncheckedProductCount: 3, ...over,
});
const dataOf = (review: ReviewItem[]): LabourData => ({ ...EMPTY_LABOUR_DATA, review, canConfirm: true });

const mount = (language: 'mr' | 'en') => { lng.v = language; return render(
    <ReviewSheet open data={dataOf([card(LOG), card(LOG2)])} onClose={vi.fn()} onToast={vi.fn()} farmId={FARM}
        history={[localLog(LOG), localLog(LOG2)]} ownName="प्रकाश" language={language} />,
); };

beforeEach(async () => {
    vi.clearAllMocks();
    enqueue.mockResolvedValue('id');
    enqueueOwnerConfirmation.mockResolvedValue('id');
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
    setAuthSession({ userId: OWNER, accessToken: 't', expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString() });
});
afterEach(() => { cleanup(); clearAuthSession(); window.localStorage.clear(); lng.v = 'mr'; });

describe('IT-D2 - the review card\'s "औषधं" block in Marathi mode shows no Latin digit', () => {
    it('the block, the open product card and the bulk lines', () => {
        mount('mr');
        const block = screen.getByTestId(`review-products-${LOG}`);
        // The numbers really are there: how many are left to check, the doses he said (recorded, and in his own words), the percentage.
        expect(within(block).getByTestId(`review-products-count-${LOG}`)).toHaveTextContent('३ तपासायची · ऐच्छिक');
        expect(within(block).getByTestId('vr-prow-m-conf')).toHaveTextContent('२५० मिली');
        expect(within(block).getByTestId('vr-prow-m-conf')).toHaveTextContent('१७.८%');
        expect(within(block).getByTestId('vr-prow-m-prem')).toHaveTextContent('१.५ किलो');
        expect(within(block).getByTestId('vr-prow-m-npk')).toHaveTextContent('३ किलो');
        expect(latinDigitFindings(block, NOT_NUMBERS)).toEqual([]);

        fireEvent.click(within(block).getByTestId('vr-prow-m-conf'));
        const host = screen.getByTestId(`review-product-card-host-${LOG}`);
        expect(host).toHaveTextContent('१७.८%');
        expect(host).toHaveTextContent('२५० मिली');
        expect(latinDigitFindings(host, NOT_NUMBERS)).toEqual([]);
        fireEvent.click(within(host).getByTestId('vr-card-close'));

        // Select two records: the sheet's count line, the bulk button and its question carry the numbers.
        fireEvent.click(screen.getByTestId(`review-select-${LOG}`));
        fireEvent.click(screen.getByTestId(`review-select-${LOG2}`));
        expect(screen.getByTestId('review-sheet-count')).toHaveTextContent('२ नोंदी — मंजूर करा');
        expect(screen.getByTestId('review-approve-selected')).toHaveTextContent('निवडलेल्या २ नोंदी मंजूर करा');
        expect(latinDigitFindings(screen.getByTestId('review-sheet-count'))).toEqual([]);
        expect(latinDigitFindings(screen.getByTestId('review-approve-selected'))).toEqual([]);
        fireEvent.click(screen.getByTestId('review-approve-selected'));
        expect(screen.getByTestId('review-bulk-confirm')).toHaveTextContent('२ नोंदी मंजूर करायच्या?');
        expect(latinDigitFindings(screen.getByTestId('review-bulk-confirm'))).toEqual([]);
    });

    it('the whole sheet - every card, its date and facts, the selection controls - is free of Latin digits', () => {
        mount('mr');
        fireEvent.click(screen.getByTestId(`review-select-${LOG}`));
        expect(latinDigitFindings(screen.getByTestId('review-sheet'), NOT_NUMBERS)).toEqual([]);
    });

    it('the words of approvalWords: no digit for any count in Marathi mode, 0-9 in English', () => {
        const mr = approvalWords('mr');
        const en = approvalWords('en');
        for (const n of [0, 1, 2, 3, 9, 10, 57, 120, 1234]) {
            for (const f of [mr.countLine, mr.approvedMany, mr.failedMany, mr.approveSelected, mr.confirmSelected, mr.approvalChip, mr.unsentChip, mr.productsToCheck, mr.checkProducts]) {
                expect(f(n), `${f.name} ${n}`).not.toMatch(/[0-9]/);
            }
            expect(en.productsToCheck(n)).toBe(`${n} to check · optional`);
            expect(en.checkProducts(n)).toBe(`Check products (${n})`);
            expect(en.approvalChip(n)).toBe(`For approval ${n}`);
        }
        expect(mr.productsToCheck(12)).toBe('१२ तपासायची · ऐच्छिक');
        expect(mr.checkProducts(3)).toBe('औषधं तपासा (३)');
    });
});

describe('IT-D2 - the review card in English mode keeps 0-9', () => {
    it('the same block: the count, the dose and the percentage in Latin digits, no Devanagari digit', () => {
        mount('en');
        const block = screen.getByTestId(`review-products-${LOG}`);
        expect(within(block).getByTestId(`review-products-count-${LOG}`)).toHaveTextContent('3 to check · optional');
        expect(within(block).getByTestId('vr-prow-m-conf')).toHaveTextContent('250 ml');
        expect(within(block).getByTestId('vr-prow-m-conf')).toHaveTextContent('17.8%');
        expect(within(block).getByTestId('vr-prow-m-prem')).toHaveTextContent('1.5 kg');
        expect(within(block).getByTestId('vr-prow-m-npk')).toHaveTextContent('3 किलो'); // his own words for the amount, as he said them: only their digits follow the language
        expect(block.textContent).not.toMatch(/[०-९]/);
    });
});

describe('IT-D2 - "औषधं तपासा (N)" on a recording in आढावा', () => {
    const made = (id: string): DailyLog => ({
        ...localLog(id),
        meta: { createdAtISO: '2026-11-09T10:00:00.000Z', createdByOperatorId: SUNIL, farmId: FARM },
    }) as DailyLog;

    it('the button shows its count in Devanagari digits in Marathi mode', () => {
        const logs = [made(LOG)];
        render(<ProductCheckAuthority.Provider value><CheckProductsButton logs={logs} testId="chk" /></ProductCheckAuthority.Provider>);
        // three products on the record, none checked yet
        expect(screen.getByTestId('chk-check')).toHaveTextContent('औषधं तपासा (३)');
        expect(latinDigitFindings(screen.getByTestId('chk-check'))).toEqual([]);
    });
});
