// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a, redesign item 5; founder-approved 2026-11-21) - खरेदी asks "which crop, which
 * plot?" with the SHARED picker (the same one the overview uses): the "सर्व पिकं" card with the crops in Marathi, then the plots - chips for 1 to
 * 6, the number grid from 7 - with "सर्व <पीक>" as the FIRST quick button, chosen = dark green with a tick, and the count line. The page's own
 * model (`pick = { cropId, plotId }`, `ALL` for each), the bills in view and the totals are unchanged and still follow every tap.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CropProfile, ProcurementExpense } from '../../types';

const bills: { current: ProcurementExpense[] } = { current: [] };
vi.mock('../../services/procurementRepository', () => ({
    procurementRepository: { getExpenses: () => bills.current, saveExpense: vi.fn() },
}));
vi.mock('../../features/finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
vi.mock('../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn() } }));
vi.mock('../../infrastructure/sync/AttachmentUploadWorker', () => ({ attachmentUploadWorker: { triggerNow: vi.fn() } }));
vi.mock('../../features/finance/financeCommandService', () => ({ financeCommandService: { createMoneyEventFromSource: vi.fn() } }));

import ProcurementPage from '../ProcurementPage';

const plot = (id: string, name: string) => ({ id, name }) as unknown as CropProfile['plots'][number];
const crop = (id: string, name: string, color: string, plots: CropProfile['plots']) =>
    ({ id, name, iconName: 'Sprout', color, plots }) as unknown as CropProfile;
// The crops as the server stores them: English names ("Grapes", "Sugarcane"). The farmer must read them in Marathi.
const GRAPES = crop('c1', 'Grapes', 'bg-green-500', Array.from({ length: 15 }, (_, i) => plot(`g${i + 1}`, `G${i + 1}`)));
const CANE = crop('c2', 'Sugarcane', 'bg-pink-500', [plot('u1', 'U1'), plot('u2', 'U2'), plot('u3', 'U3')]);
const FARM = [GRAPES, CANE];

const bill = (id: string, scope: ProcurementExpense['scope'], amount: number, extra: Partial<ProcurementExpense> = {}): ProcurementExpense => ({
    id, scope, grandTotal: amount, subtotal: amount, date: '2026-10-20', createdAt: '2026-10-20T10:00:00.000Z',
    vendorName: `दुकान ${id.slice(1)}`, lineItems: [{ id: `${id}-1`, name: `वस्तू ${id.slice(1)}`, totalAmount: amount, category: 'FERTILIZER' }],
    paymentStatus: 'PAID', aiExtracted: true, userVerified: true, ...extra,
});

const part = (el: Element, name: string) => el.querySelector(`[data-part="${name}"]`);
const pressed = (id: string) => screen.getByTestId(id).getAttribute('aria-pressed');
const listedIds = () => screen.queryAllByTestId(/^bill-b\d$/).map(el => el.getAttribute('data-testid')?.replace('bill-', ''));
const gIds = Array.from({ length: 15 }, (_, i) => `g${i + 1}`);

beforeEach(() => {
    bills.current = [
        bill('b1', 'PLOT', 100, { plotId: 'g7' }),
        bill('b2', 'PLOT', 200, { plotId: 'g8' }),
        bill('b3', 'CROP', 400, { cropId: 'c1' }),
        bill('b4', 'PLOT', 800, { plotId: 'u1' }),
    ];
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('खरेदी - the "सर्व पिकं" card with the crops in Marathi', () => {
    it('draws the card with one photo button per crop; the crop names are Marathi, never the stored English', () => {
        render(<ProcurementPage crops={FARM} />);
        const card = screen.getByTestId('buy-crop-all-card');
        expect(card).toHaveTextContent('सर्व पिकं');
        expect(card).toHaveTextContent('द्राक्ष');
        expect(card).toHaveTextContent('ऊस');
        expect(card).toHaveTextContent('२ पिकं · १८ प्लॉट'); // Marathi digits
        expect(screen.getByTestId('buy-crop-all-photo-c1')).toBeInTheDocument();
        expect(screen.getByTestId('buy-crop-all-photo-c2')).toBeInTheDocument();
        expect(screen.getByTestId('buy-pick').textContent).not.toMatch(/Grapes|Sugarcane/);
        // the old crop chips are gone
        expect(screen.queryByTestId('buy-crop-c1')).toBeNull();
    });

    it('starts on every crop: the card is chosen (tick) and no plot is asked for yet', () => {
        render(<ProcurementPage crops={FARM} />);
        expect(screen.getByTestId('buy-crop-all-card').getAttribute('data-on')).toBe('yes');
        expect(pressed('buy-crop-all')).toBe('true');
        expect(screen.queryByTestId('buy-plots')).toBeNull();
        expect(screen.getByTestId('buy-totals-cover')).toHaveTextContent('सगळं शेत');
        expect(listedIds()).toHaveLength(4);
    });

    it('a farm with ONE crop still has the card, so "सर्व" stays one tap away', () => {
        render(<ProcurementPage crops={[GRAPES]} />);
        expect(screen.getByTestId('buy-crop-all')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('buy-crop-all-photo-c1'));
        expect(screen.getByTestId('buy-totals-cover')).toHaveTextContent('सर्व द्राक्ष');
        expect(screen.getByTestId('buy-plots')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('buy-crop-all'));
        expect(screen.getByTestId('buy-totals-cover')).toHaveTextContent('सगळं शेत');
        expect(screen.queryByTestId('buy-plots')).toBeNull();
    });
});

describe('खरेदी - the number grid, "सर्व <पीक>" first, the chosen look and the count line', () => {
    it('15 plots: a number grid in natural order with Marathi digits, "G7" under the number', () => {
        render(<ProcurementPage crops={FARM} />);
        fireEvent.click(screen.getByTestId('buy-crop-all-photo-c1'));
        const grid = screen.getByTestId('buy-plot-grid');
        expect(grid.children).toHaveLength(15);
        expect(part(screen.getByTestId('buy-plot-g7'), 'number')).toHaveTextContent('७');
        expect(part(screen.getByTestId('buy-plot-g7'), 'name')).toHaveTextContent('G7');
        expect(part(screen.getByTestId('buy-plot-g12'), 'number')).toHaveTextContent('१२');
        expect([...grid.children].map(c => part(c, 'name')?.textContent)).toEqual(Array.from({ length: 15 }, (_, i) => `G${i + 1}`));
        // the old plot chips (and the English "सर्व Grapes") are gone
        expect(screen.getByTestId('buy-plots').textContent).not.toMatch(/Grapes/);
    });

    it('"सर्व द्राक्ष" is the FIRST quick button and is chosen at the start; every plot wears the one chosen look', () => {
        render(<ProcurementPage crops={FARM} />);
        fireEvent.click(screen.getByTestId('buy-crop-all-photo-c1'));
        const row = screen.getByTestId('plot-quick-row');
        expect(row.firstElementChild).toBe(screen.getByTestId('buy-plot-all'));
        expect(screen.getByTestId('buy-plot-all')).toHaveTextContent('सर्व द्राक्ष');
        expect(pressed('buy-plot-all')).toBe('true');
        expect(screen.getByTestId('buy-plot-all').className).toContain('bg-emerald-800');
        for (const id of gIds) {
            const box = screen.getByTestId(`buy-plot-${id}`);
            expect(box.getAttribute('aria-pressed'), id).toBe('true');
            expect(box.className, id).toContain('bg-emerald-800');
            expect(box.className, id).toContain('text-white');
            expect(part(box, 'tick'), id).toBeTruthy();
        }
        expect(screen.getByTestId('buy-picked-count')).toHaveTextContent('१५ पैकी १५ निवडले');
    });

    it('one tap on a number shows ONLY that plot (its own bills + the crop\'s shared + farm-wide); the count line follows', () => {
        render(<ProcurementPage crops={FARM} />);
        fireEvent.click(screen.getByTestId('buy-crop-all-photo-c1'));
        fireEvent.click(screen.getByTestId('buy-plot-g7'));
        expect(pressed('buy-plot-g7')).toBe('true');
        for (const id of gIds.filter(x => x !== 'g7')) expect(pressed(`buy-plot-${id}`), id).toBe('false');
        expect(screen.getByTestId('buy-plot-g8').className).toContain('bg-white');
        expect(screen.getByTestId('buy-plot-g8').className).not.toContain('bg-emerald-800');
        expect(pressed('buy-plot-all')).toBe('false');
        expect(screen.getByTestId('buy-picked-count')).toHaveTextContent('१५ पैकी १ निवडले');
        expect(screen.getByTestId('buy-totals-cover')).toHaveTextContent('G7 (द्राक्ष)');
        expect(listedIds().sort()).toEqual(['b1', 'b3']);
    });

    it('from there: another number switches to it, the same number again - or "सर्व द्राक्ष" - brings every plot back', () => {
        render(<ProcurementPage crops={FARM} />);
        fireEvent.click(screen.getByTestId('buy-crop-all-photo-c1'));
        fireEvent.click(screen.getByTestId('buy-plot-g7'));
        fireEvent.click(screen.getByTestId('buy-plot-g8'));
        expect(pressed('buy-plot-g8')).toBe('true');
        expect(pressed('buy-plot-g7')).toBe('false');
        expect(listedIds().sort()).toEqual(['b2', 'b3']);

        fireEvent.click(screen.getByTestId('buy-plot-g8'));
        expect(pressed('buy-plot-all')).toBe('true');
        for (const id of gIds) expect(pressed(`buy-plot-${id}`), id).toBe('true');
        expect(listedIds().sort()).toEqual(['b1', 'b2', 'b3']);

        fireEvent.click(screen.getByTestId('buy-plot-g3'));
        fireEvent.click(screen.getByTestId('buy-plot-all'));
        expect(pressed('buy-plot-all')).toBe('true');
        expect(screen.getByTestId('buy-picked-count')).toHaveTextContent('१५ पैकी १५ निवडले');
        expect(screen.getByTestId('buy-totals-cover')).toHaveTextContent('सर्व द्राक्ष');
    });

    it('a crop with 1 to 6 plots keeps the shared chips, "सर्व ऊस" first, and its count line', () => {
        render(<ProcurementPage crops={FARM} />);
        fireEvent.click(screen.getByTestId('buy-crop-all-photo-c2'));
        const plots = screen.getByTestId('buy-plots');
        expect(plots.querySelector('[data-mode="chips"]')).toBeTruthy();
        expect(plots.querySelector('[data-mode="grid"]')).toBeNull();
        expect(screen.getByTestId('plot-quick-row').firstElementChild).toBe(screen.getByTestId('buy-plot-all'));
        expect(screen.getByTestId('buy-plot-all')).toHaveTextContent('सर्व ऊस');
        expect(screen.getByTestId('buy-plot-u2')).toHaveTextContent('U2');
        expect(screen.getByTestId('buy-picked-count')).toHaveTextContent('३ पैकी ३ निवडले');
        fireEvent.click(screen.getByTestId('buy-plot-u2'));
        expect(pressed('buy-plot-u2')).toBe('true');
        expect(pressed('buy-plot-u1')).toBe('false');
        expect(screen.getByTestId('buy-picked-count')).toHaveTextContent('३ पैकी १ निवडले');
        expect(screen.getByTestId('buy-totals-cover')).toHaveTextContent('U2 (ऊस)');
    });

    it('picking another crop starts its plots at "सर्व" again', () => {
        render(<ProcurementPage crops={FARM} />);
        fireEvent.click(screen.getByTestId('buy-crop-all-photo-c1'));
        fireEvent.click(screen.getByTestId('buy-plot-g7'));
        fireEvent.click(screen.getByTestId('buy-crop-all-photo-c2'));
        expect(pressed('buy-plot-all')).toBe('true');
        expect(screen.queryByTestId('buy-plot-g7')).toBeNull();
        expect(listedIds().sort()).toEqual(['b4']);
    });

    it('the bill sheet still opens from the page with the plot chosen here', () => {
        render(<ProcurementPage crops={FARM} />);
        fireEvent.click(screen.getByTestId('buy-crop-all-photo-c1'));
        fireEvent.click(screen.getByTestId('buy-plot-g7'));
        fireEvent.click(screen.getByTestId('scan-receipt-btn'));
        expect(screen.getByTestId('receipt-capture-sheet')).toBeInTheDocument();
    });
});
