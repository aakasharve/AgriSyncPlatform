// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — the receipt sheet speaks Marathi all the way through
 * (photo → reading → the read bill → where it goes), and its save is unchanged: the same receipt is stored and
 * the same one money entry per bill line is sent. The bill reader, the attachment queue and the stores are
 * mocked; the sheet is real.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CropProfile, ReceiptExtractionResponse } from '../../../../types';

const extractReceiptWithSession = vi.fn<() => Promise<ReceiptExtractionResponse>>();
vi.mock('../../receipt/receiptExtractionClient', () => ({
    extractReceiptWithSession: () => extractReceiptWithSession(),
}));
// The bill's farm is known (the plot's farm) — L2a R-3: with none known, nothing is read (own test file).
vi.mock('../../../../infrastructure/sync/SyncContext', () => ({ resolveFarmIdFromSyncState: async () => 'farm-1' }));
vi.mock('../../../finance/moneyEntryState', () => ({ useMoneyEvidence: () => null }));
vi.mock('../../../../infrastructure/sync/AttachmentUploadWorker', () => ({ attachmentUploadWorker: { triggerNow: vi.fn() } }));
vi.mock('../../../../application/use-cases/CaptureAttachment', () => ({ captureAttachment: vi.fn() }));
const saveExpense = vi.fn();
vi.mock('../../../../services/procurementRepository', () => ({ procurementRepository: { saveExpense: (...a: unknown[]) => saveExpense(...a) } }));
const createMoneyEventFromSource = vi.fn();
vi.mock('../../../finance/financeCommandService', () => ({
    financeCommandService: { createMoneyEventFromSource: (...a: unknown[]) => createMoneyEventFromSource(...a) },
}));

import { SCOPE_LABEL } from '../billView';
import { ReceiptCaptureSheet } from '../ReceiptCaptureSheet';

const CROPS = [
    { id: 'c1', name: 'द्राक्ष', plots: [{ id: 'p1', name: 'थॉम्पसन' }, { id: 'p2', name: 'सोनाका' }] },
] as unknown as CropProfile[];

const READ_BILL: ReceiptExtractionResponse = {
    success: true, confidence: 50, vendorName: 'कृषी सेवा केंद्र', date: '2026-10-20', grandTotal: 600, subtotal: 600,
    suggestedScope: 'PLOT',
    lineItems: [{ name: 'युरिया', quantity: 2, unit: 'पोती', unitPrice: 300, totalAmount: 600, suggestedCategory: 'FERTILIZER', confidence: 50 }],
};

function latinLeftovers(): string[] {
    const found: string[] = [...((document.body.textContent ?? '').match(/[A-Za-z]+/g) ?? [])];
    document.body.querySelectorAll('[placeholder],[aria-label],[alt],[title]').forEach(el => {
        ['placeholder', 'aria-label', 'alt', 'title'].forEach(a => {
            const v = el.getAttribute(a);
            if (v && /[A-Za-z]/.test(v)) found.push(`${a}=${v}`);
        });
    });
    return found;
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ReceiptCaptureSheet — Marathi, same save', () => {
    it('reads the bill in Marathi, names the picked plot, and saves exactly as before', async () => {
        extractReceiptWithSession.mockResolvedValue(READ_BILL);
        const onSave = vi.fn(); const onClose = vi.fn();
        render(<ReceiptCaptureSheet onClose={onClose} onSave={onSave} crops={CROPS} activePlotId="p1" />);
        expect(screen.getByTestId('receipt-capture-sheet')).toHaveTextContent('फोटो काढा');
        expect(latinLeftovers()).toEqual([]);

        fireEvent.change(screen.getByTestId('attachment-input'), { target: { files: [new File(['x'], 'bill.png', { type: 'image/png' })] } });
        await screen.findByText('बिलातल्या वस्तू');

        const sheet = screen.getByTestId('receipt-capture-sheet');
        expect(sheet).toHaveTextContent('एकदा तपासा'); // low-confidence read
        expect(sheet).toHaveTextContent('हा खर्च कशासाठी?');
        expect(sheet).toHaveTextContent('थॉम्पसन'); // was "Selected"
        // No crop is chosen in this sheet yet, so the crop option names none — it used to say "सर्व द्राक्ष"
        // while the save would have used no crop at all (I8 review B006).
        expect(latinLeftovers()).toEqual([]);

        fireEvent.click(screen.getByText('खर्च म्हणून जतन करा'));
        expect(saveExpense).toHaveBeenCalledTimes(1);
        expect(saveExpense).toHaveBeenCalledWith(expect.objectContaining({
            scope: 'PLOT', plotId: 'p1', grandTotal: 600, vendorName: 'कृषी सेवा केंद्र', date: '2026-10-20',
        }));
        expect(createMoneyEventFromSource).toHaveBeenCalledTimes(1);
        expect(createMoneyEventFromSource).toHaveBeenCalledWith(expect.objectContaining({ type: 'Procurement', eventType: 'Expense', amount: 600, plotId: 'p1', farmId: 'farm-1' }));
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('says in Marathi that a photo taken offline waits to be read', async () => {
        extractReceiptWithSession.mockResolvedValue({ ...READ_BILL, success: false, queued: true, message: 'Saved locally. Will process when online.', lineItems: [] });
        render(<ReceiptCaptureSheet onClose={vi.fn()} onSave={vi.fn()} crops={CROPS} />);
        fireEvent.change(screen.getByTestId('attachment-input'), { target: { files: [new File(['x'], 'bill.png', { type: 'image/png' })] } });
        await screen.findByText('बिलाचा फोटो फोनवर ठेवला आहे. इंटरनेट आल्यावर वाचला जाईल.');
        expect(latinLeftovers()).toEqual([]);
        expect(saveExpense).not.toHaveBeenCalled();
    });
});

// I8 review B006 — the "where does it go" option names what THIS sheet's dropdown holds (what the save uses),
// never the page's pick once the dropdown has moved away from it.
describe('ReceiptCaptureSheet — the place it names is the place it saves', () => {
    it('changing the plot dropdown changes the named plot, and the save goes there', async () => {
        extractReceiptWithSession.mockResolvedValue(READ_BILL);
        render(<ReceiptCaptureSheet onClose={vi.fn()} onSave={vi.fn()} crops={CROPS} activePlotId="p1" />);
        fireEvent.change(screen.getByTestId('attachment-input'), { target: { files: [new File(['x'], 'bill.png', { type: 'image/png' })] } });
        await screen.findByText('बिलातल्या वस्तू');

        const plotOption = () => screen.getByText(SCOPE_LABEL.PLOT).closest('button') as HTMLButtonElement;
        fireEvent.click(plotOption());
        expect(plotOption()).toHaveTextContent('थॉम्पसन');

        fireEvent.change(screen.getByDisplayValue('थॉम्पसन'), { target: { value: 'p2' } });
        expect(plotOption()).toHaveTextContent('सोनाका');
        expect(plotOption()).not.toHaveTextContent('थॉम्पसन');

        fireEvent.click(screen.getByText('खर्च म्हणून जतन करा'));
        await waitFor(() => expect(createMoneyEventFromSource).toHaveBeenCalledWith(expect.objectContaining({ plotId: 'p2' })));
    });
});
