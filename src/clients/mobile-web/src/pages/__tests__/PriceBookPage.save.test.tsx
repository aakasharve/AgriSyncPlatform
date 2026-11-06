// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane RATE-1 part A (founder D-72 "Own farm prices" = D-17 / D-43).
 *
 * The दरपत्रक is HIS FARM's own list now:
 *   - every rate he may read, with what it is for, the rate per unit / per day, its kind, for whom, its dates;
 *   - the primary account holder adds a rate and changes one (a NEW version on the same line, queued through the outbox);
 *   - each rate's history: who, when, old → new;
 *   - a ShramSafal suggested rate is confirmed into HIS list: it prefills only the item and the amount;
 *   - a change the server refused says why, in Marathi; one still waiting says it is not saved yet;
 *   - a seat that may not set rates reads them with the rule line and no write control;
 *   - a seat without see wages gets the rule line and "—", never ₹ 0;
 *   - Marathi mode shows Marathi only.
 * (Replaces the I8 / F99 tests of the shared-list form, which this page no longer shows: that form never kept a rate.)
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDateKey } from '../../core/domain/services/DateKeyService';
import type { FarmRatesView } from '../../features/finance/farmRates/useFarmRates';
import type { FarmRateRow } from '../../features/finance/farmRates/farmRateSchema';

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const FARM = '00000000-0000-4000-8000-0000000000f1';
const UREA = '00000000-0000-4000-8000-000000000101';
const SPRAY = '00000000-0000-4000-8000-000000000102';

const row = (over: Partial<FarmRateRow>): FarmRateRow => ({
    id: `v-${over.rateLineId}-${over.version ?? 1}`, rateLineId: UREA, farmId: FARM, version: 1, kind: 'Input', itemName: 'युरिया',
    unit: 'पोते', basis: 'PerUnit', workerCategory: null, amount: 1350, currencyCode: 'INR', effectiveFrom: '2026-11-01',
    season: null, endsOn: null, retired: false, suggestionId: null, createdByUserId: OWNER, createdAtUtc: '2026-11-01T05:00:00.500Z',
    ...over,
});

const h = vi.hoisted(() => ({
    view: null as unknown as FarmRatesView,
    reload: vi.fn(),
    enqueue: vi.fn(async (input: unknown) => input),
    trigger: vi.fn(async () => undefined),
    language: undefined as string | undefined,
}));

vi.mock('../../features/finance/farmRates/useFarmRates', () => ({ useFarmRates: () => ({ ...h.view, reload: h.reload }) }));
vi.mock('../../application/usecases/sync/SetFarmRateCommand', async importOriginal => {
    const real = await importOriginal<typeof import('../../application/usecases/sync/SetFarmRateCommand')>();
    return { ...real, SetFarmRateCommand: { enqueue: h.enqueue } };
});
vi.mock('../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: h.trigger } }));
vi.mock('../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => (h.language ? { language: h.language } : undefined) }));

import PriceBookPage from '../PriceBookPage';

const RATES: FarmRateRow[] = [
    row({ version: 1, amount: 1350, createdAtUtc: '2026-11-01T05:00:00.500Z' }),
    row({ version: 2, amount: 1400, createdAtUtc: '2026-11-05T05:00:00.500Z', effectiveFrom: '2026-11-05' }),
    row({
        rateLineId: SPRAY, kind: 'Work', itemName: 'फवारणी', unit: null, basis: 'PerDay', workerCategory: 'बाई मजूर', amount: 450,
        season: 'खरीप', createdAtUtc: '2026-11-02T05:00:00.500Z',
    }),
];

const view = (over: Partial<FarmRatesView> = {}): FarmRatesView => ({
    loading: false, rows: RATES, mayWrite: true, seeWorkRates: true, queued: [], drafts: [], suggestions: [], fromServer: true, ...over,
});

const open = () => render(
    <PriceBookPage currentRoute="finance-price-book" onNavigate={vi.fn()} onBack={vi.fn()} farmId={FARM} selfUserId={OWNER}
        operatorNameById={new Map([[OWNER, 'अशोक']])} />,
);
const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => { h.view = view(); h.language = undefined; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('the farm\'s own list', () => {
    it('each rate: what it is for, the CURRENT rate per what, its kind, for whom and season', () => {
        open();
        expect(screen.getByTestId(`rate-line-${UREA}`)).toHaveTextContent('युरिया₹ 1,400 / पोतेवस्तूचा भाव');
        const spray = screen.getByTestId(`rate-line-${SPRAY}`);
        expect(spray).toHaveTextContent('फवारणी₹ 450 दिवसालाकामाचा दरबाई मजूरखरीप');
        fireEvent.click(screen.getByTestId('rate-show-Work'));
        expect(screen.queryByTestId(`rate-line-${UREA}`)).toBeNull();
        expect(screen.getByTestId(`rate-line-${SPRAY}`)).toBeInTheDocument();
    });

    it('its history: who, when, old → new', () => {
        open();
        fireEvent.click(screen.getByTestId(`rate-history-toggle-${UREA}`));
        expect(screen.getByTestId(`rate-history-${UREA}-v1`)).toHaveTextContent('तुम्ही: ₹ 1,350 ठरवला');
        expect(screen.getByTestId(`rate-history-${UREA}-v2`)).toHaveTextContent('तुम्ही: ₹ 1,350 → ₹ 1,400');
    });

    it('an empty list says so; a list the phone could not read says that instead of "no rate"', () => {
        h.view = view({ rows: [] });
        open();
        expect(screen.getByTestId('rate-empty')).toHaveTextContent('अजून एकही दर लिहिलेला नाही.');
        cleanup();
        h.view = view({ rows: [], failed: true });
        open();
        expect(screen.getByTestId('rate-empty')).toHaveTextContent('दरपत्रक आत्ता उघडता आलं नाही.');
    });
});

describe('the primary account holder adds and changes rates through the outbox', () => {
    it('a new input price: kind, कशासाठी, unit, price, from-date — queued as set_farm_rate', async () => {
        open();
        fireEvent.click(screen.getByTestId('rate-new'));
        type('rate-item', ' डीएपी ');
        type('rate-unit', 'पोते');
        expect(screen.getByTestId('rate-save')).toBeDisabled();
        type('rate-amount', '1590.5');
        type('rate-from', '2026-11-06');
        fireEvent.click(screen.getByTestId('rate-save'));
        await flush();
        expect(h.enqueue).toHaveBeenCalledTimes(1);
        const input = h.enqueue.mock.calls[0][0] as Record<string, unknown>;
        expect(input).toMatchObject({
            farmId: FARM, change: 'set', kind: 'Input', itemName: 'डीएपी', unit: 'पोते', basis: 'PerUnit', amount: 1590.5, effectiveFrom: '2026-11-06',
        });
        expect(typeof input.rateLineId).toBe('string');
        expect(input).not.toHaveProperty('workerCategory');
        expect(h.trigger).toHaveBeenCalled();
        expect(h.reload).toHaveBeenCalled();
    });

    it('a work rate names a basis and, if he wants, for whom; never a unit', async () => {
        open();
        fireEvent.click(screen.getByTestId('rate-new'));
        fireEvent.click(screen.getByTestId('rate-kind-Work'));
        expect(screen.queryByTestId('rate-unit')).toBeNull();
        type('rate-item', 'खुरपणी');
        fireEvent.click(screen.getByTestId('rate-basis-PerAcre'));
        type('rate-category', 'टोळी');
        type('rate-amount', '2200');
        fireEvent.click(screen.getByTestId('rate-save'));
        await flush();
        expect(h.enqueue.mock.calls[0][0]).toMatchObject({ kind: 'Work', basis: 'PerAcre', workerCategory: 'टोळी', amount: 2200 });
        expect(h.enqueue.mock.calls[0][0]).not.toHaveProperty('unit');
    });

    it('a blank price is never written (it is not ₹ 0)', () => {
        open();
        fireEvent.click(screen.getByTestId('rate-new'));
        type('rate-item', 'युरिया');
        type('rate-unit', 'पोते');
        expect(screen.getByTestId('rate-save')).toBeDisabled();
        type('rate-amount', '0');
        expect(screen.getByTestId('rate-save')).toBeDisabled();
        fireEvent.click(screen.getByTestId('rate-save'));
        expect(h.enqueue).not.toHaveBeenCalled();
    });

    it('"दर बदला" writes a NEW version on the same line, from today; the old one stays in the history', async () => {
        open();
        fireEvent.click(screen.getByTestId(`rate-change-${UREA}`));
        expect(screen.getByText('दर बदला — युरिया')).toBeInTheDocument();
        expect(screen.getByTestId('rate-item')).toHaveValue('युरिया');
        expect(screen.getByTestId('rate-unit')).toHaveValue('पोते');
        expect(screen.getByTestId('rate-amount')).toHaveValue(1400);
        expect(screen.getByTestId('rate-from')).toHaveValue(getDateKey());
        type('rate-amount', '1450');
        fireEvent.click(screen.getByTestId('rate-save'));
        await flush();
        expect(h.enqueue.mock.calls[0][0]).toMatchObject({ rateLineId: UREA, change: 'set', amount: 1450, kind: 'Input' });
    });

    it('"हा दर बंद करा" queues a stop of that line (a stopped version, never a deletion)', async () => {
        open();
        fireEvent.click(screen.getByTestId(`rate-retire-${SPRAY}`));
        await flush();
        expect(h.enqueue).toHaveBeenCalledWith({ farmId: FARM, rateLineId: SPRAY, change: 'retire' });
    });
});

describe('ShramSafal सुचवलेला दर — a suggestion to confirm, never applied by itself', () => {
    it('confirming prefills only the item and the amount; he chooses the unit and kind; it carries its source', async () => {
        h.view = view({ suggestions: [{ id: 'sug-1', itemName: 'पोटॅश', unitPrice: 1700, currencyCode: 'INR', effectiveFrom: '2026-10-01' }] });
        open();
        const card = screen.getByTestId('rate-suggestions');
        expect(within(card).getByText('श्रमसफल सुचवलेला दर')).toBeInTheDocument();
        expect(h.enqueue).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('rate-suggestion-take-sug-1'));
        expect(screen.getByTestId('rate-item')).toHaveValue('पोटॅश');
        expect(screen.getByTestId('rate-amount')).toHaveValue(1700);
        expect(screen.getByTestId('rate-unit')).toHaveValue('');
        expect(screen.getByTestId('rate-save')).toBeDisabled();
        type('rate-unit', 'पोते');
        fireEvent.click(screen.getByTestId('rate-save'));
        await flush();
        expect(h.enqueue.mock.calls[0][0]).toMatchObject({ itemName: 'पोटॅश', amount: 1700, unit: 'पोते', suggestionId: 'sug-1' });
    });

    it('an old draft on this phone is offered to check, prefilled, never saved by itself', () => {
        h.view = view({ drafts: [{ key: 'outbox:r1', itemName: 'जुना दर', amount: 90, unit: 'किलो', source: 'outbox' }] });
        open();
        expect(screen.getByTestId('rate-drafts')).toHaveTextContent('या फोनवर आधी लिहिलेला दर');
        fireEvent.click(screen.getByTestId('rate-draft-take-outbox:r1'));
        expect(screen.getByTestId('rate-item')).toHaveValue('जुना दर');
        expect(screen.getByTestId('rate-unit')).toHaveValue('किलो');
        expect(h.enqueue).not.toHaveBeenCalled();
    });
});

describe('refusals and unsent changes are said plainly', () => {
    it('a change the server refused (not the primary account holder) says why, in Marathi; a waiting one says it is not saved yet', () => {
        const base = { farmRateId: 'q1', farmId: FARM, rateLineId: 'L9', change: 'set' as const, kind: 'Input' as const, itemName: 'गंधक',
            unit: 'किलो', basis: 'PerUnit' as const, amount: 60, effectiveFrom: '2026-11-06', changedAtUtc: '2026-11-06T05:00:00Z' };
        h.view = view({
            queued: [
                { payload: base, state: 'refused', errorCode: 'ShramSafal.FarmRate.Forbidden' },
                { payload: { ...base, farmRateId: 'q2' }, state: 'waiting' },
            ],
        });
        open();
        expect(screen.getByTestId('rate-queued-q1')).toHaveTextContent(
            'हा दर जतन झाला नाही: श्रमसफलच्या नियमानुसार शेताचे दर फक्त मुख्य खातेदार ठरवतात.');
        expect(screen.getByTestId('rate-queued-q2')).toHaveTextContent('फोनवर लिहिला — इंटरनेट आल्यावर जतन होईल.');
    });

    it('a seat that may not set rates reads them with the rule line and no write control', () => {
        h.view = view({ mayWrite: false });
        open();
        expect(screen.getByTestId('rate-read-only')).toHaveTextContent('श्रमसफलच्या नियमानुसार शेताचे दर शेताचे मुख्य खातेदार ठरवतात.');
        expect(screen.queryByTestId('rate-new')).toBeNull();
        expect(screen.queryByTestId(`rate-change-${UREA}`)).toBeNull();
        expect(screen.queryByTestId(`rate-retire-${UREA}`)).toBeNull();
        expect(screen.getByTestId(`rate-line-${UREA}`)).toBeInTheDocument();
    });

    it('without see wages: the rule line and "—", never ₹ 0, and no work rate', () => {
        h.view = view({ seeWorkRates: false, rows: RATES.filter(r => r.kind === 'Input') });
        open();
        expect(screen.getByTestId('rate-work-withheld')).toHaveTextContent('श्रमसफलच्या नियमानुसार कामाचे (मजुरीचे) दर इथे दिसत नाहीत.');
        expect(screen.getByTestId('rate-work-withheld-amount')).toHaveTextContent('—');
        expect(screen.queryByTestId(`rate-line-${SPRAY}`)).toBeNull();
        expect(document.body.textContent).not.toMatch(/₹\s*0(?![\d,.])/);
    });
});

it('Marathi mode shows Marathi only (no English word on the page)', () => {
    h.view = view({ suggestions: [{ id: 's', itemName: 'पोटॅश', unitPrice: 1700, currencyCode: 'INR', effectiveFrom: '2026-10-01' }] });
    open();
    fireEvent.click(screen.getByTestId(`rate-history-toggle-${UREA}`));
    fireEvent.click(screen.getByTestId('rate-new'));
    fireEvent.click(screen.getByTestId('rate-kind-Work'));
    expect(screen.getByTestId('fin-prices').textContent).not.toMatch(/[A-Za-z]/);
});

// ── fix round 1 (review F1 / F3 / F5 / F6) ───────────────────────────────────────────────────────────────────────
describe('fix round 1', () => {
    it('F1: a seat that reads none of the farm\'s rates gets the ShramSafal rule and "—", not the list', () => {
        h.view = view({ mayWrite: false, seeInputPrices: false, seeWorkRates: false, rows: [] });
        open();
        expect(screen.getByTestId('rate-all-withheld')).toHaveTextContent('श्रमसफलच्या नियमानुसार शेताचे दर इथे दिसत नाहीत.');
        expect(screen.getByTestId('rate-all-withheld')).toHaveTextContent('—');
        expect(screen.queryByTestId('rate-show-all')).toBeNull();
        expect(screen.queryByTestId('rate-empty')).toBeNull();
        expect(screen.queryByTestId('rate-new')).toBeNull();
        expect(screen.getByTestId('fin-prices').textContent).not.toContain('₹');
    });

    it('F5: rows the phone could not read are said, never silently missing', () => {
        h.view = view({ unreadable: 2 });
        open();
        expect(screen.getByTestId('rate-unreadable')).toHaveTextContent('काही दर या फोनवर दाखवता आले नाहीत — अॅप अपडेट करा.');
    });

    it('F3: a refused change says why it was not saved, by its reason; never "saved when online"', () => {
        const base = { farmId: FARM, rateLineId: 'L9', change: 'set' as const, kind: 'Input' as const, itemName: 'गंधक', unit: 'किलो',
            basis: 'PerUnit' as const, amount: 60, effectiveFrom: '2026-11-06', changedAtUtc: '2026-11-06T05:00:00Z' };
        h.view = view({
            queued: [
                { payload: { ...base, farmRateId: 'k' }, state: 'refused', errorCode: 'ShramSafal.FarmRate.KindChangeNotAllowed' },
                { payload: { ...base, farmRateId: 's' }, state: 'refused', errorCode: 'ShramSafal.FarmRate.UnknownSuggestion' },
                { payload: { ...base, farmRateId: 'n' }, state: 'refused', errorCode: 'ShramSafal.FarmRate.LineNotFound' },
                { payload: { ...base, farmRateId: 'o' }, state: 'refused', errorCode: 'ShramSafal.SyncMutationStoreError' },
            ],
        });
        open();
        expect(screen.getByTestId('rate-queued-k')).toHaveTextContent('ठरलेल्या दराचा प्रकार बदलता येत नाही');
        expect(screen.getByTestId('rate-queued-s')).toHaveTextContent('तो श्रमसफल सुचवलेला दर नाही');
        expect(screen.getByTestId('rate-queued-n')).toHaveTextContent('हा दर शेताच्या यादीत सापडला नाही');
        expect(screen.getByTestId('rate-queued-o')).toHaveTextContent('हा दर जतन झाला नाही. तो तपासून पुन्हा लिहा.');
        expect(screen.getByTestId('fin-prices').textContent).not.toContain('इंटरनेट आल्यावर जतन होईल');
    });

    it('F6: English mode is one language: English title, back button and lines', () => {
        h.language = 'en';
        open();
        expect(screen.getByTestId('page-title')).toHaveTextContent('Rate list');
        expect(screen.getByTestId('page-back')).toHaveTextContent('Back');
        for (const id of ['page-title', 'page-back', 'rate-intro', 'rate-never-rewrites', 'rate-show-all', 'rate-show-Input', 'rate-new']) {
            expect(screen.getByTestId(id).textContent ?? '').not.toMatch(/[ऀ-ॿ]/); // no Devanagari
        }
    });
});
