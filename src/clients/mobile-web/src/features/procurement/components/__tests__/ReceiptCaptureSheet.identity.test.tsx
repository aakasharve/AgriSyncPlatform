// @vitest-environment jsdom
/**
 * spec: pre-launch-repair L2b (R-1, R-2) — the bill sheet:
 *   - R-1: the bill's identity is minted when the sheet OPENS; a second tap on "खर्च म्हणून जतन करा" saves
 *     nothing new and sends no second money entry; the money keys are `<billId>:<lineId>`, the same each time.
 *   - R-2: a plot bill with no crop picked sends no crop at all (it used to send '' as the crop season).
 * The reader, the photo queue, the stores and the money service are mocked; the sheet is real.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { v5 as uuidv5 } from 'uuid';
import type { CropProfile, ReceiptExtractionResponse } from '../../../../types';

const extractReceiptWithSession = vi.fn<(b: string, farm: string) => Promise<ReceiptExtractionResponse>>();
vi.mock('../../receipt/receiptExtractionClient', () => ({
    extractReceiptWithSession: (b: string, farm: string) => extractReceiptWithSession(b, farm),
}));
vi.mock('../../../../infrastructure/sync/SyncContext', () => ({
    resolveFarmIdFromSyncState: async () => 'farm-A',
    resolveKnownFarmId: async () => null,
}));
vi.mock('../../../../infrastructure/storage/SessionStore', () => ({ SessionStore: { getCurrentFarmId: () => null } }));
vi.mock('../../../../infrastructure/sync/AttachmentUploadWorker', () => ({ attachmentUploadWorker: { triggerNow: vi.fn() } }));
vi.mock('../../../../application/use-cases/CaptureAttachment', () => ({ captureAttachment: async () => ({ id: 'att-1', status: 'pending' }) }));
vi.mock('../../../finance/moneyEntryState', () => ({ useMoneyEvidence: () => null }));
const saveExpense = vi.fn();
vi.mock('../../../../services/procurementRepository', () => ({ procurementRepository: { saveExpense: (...a: unknown[]) => saveExpense(...a) } }));
const createMoneyEventFromSource = vi.fn();
vi.mock('../../../finance/financeCommandService', () => ({
    financeCommandService: { createMoneyEventFromSource: (...a: unknown[]) => createMoneyEventFromSource(...a) },
}));

import { ReceiptCaptureSheet } from '../ReceiptCaptureSheet';

const CROPS = [{ id: 'crop_grapes', name: 'द्राक्ष', plots: [{ id: 'p1', name: 'थॉम्पसन' }] }] as unknown as CropProfile[];
const BILL: ReceiptExtractionResponse = {
    success: true, confidence: 90, vendorName: 'कृषी सेवा केंद्र', date: '2026-10-20', grandTotal: 900, subtotal: 900,
    suggestedScope: 'PLOT',
    lineItems: [
        { name: 'युरिया', totalAmount: 600, suggestedCategory: 'FERTILIZER', confidence: 90 },
        { name: 'औषध', totalAmount: 300, suggestedCategory: 'PESTICIDE', confidence: 90 },
    ],
};

async function openAndRead() {
    render(<ReceiptCaptureSheet onClose={vi.fn()} onSave={vi.fn()} crops={CROPS} activePlotId="p1" />);
    fireEvent.change(screen.getByTestId('attachment-input'), { target: { files: [new File(['x'], 'bill.png', { type: 'image/png' })] } });
    await screen.findByText('बिलातल्या वस्तू');
}

beforeEach(() => extractReceiptWithSession.mockResolvedValue(BILL));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('R-1 — one bill, one set of money entries, however often "जतन करा" is tapped', () => {
    it('a double tap saves the bill once and sends each line once', async () => {
        await openAndRead();
        const save = screen.getByText('खर्च म्हणून जतन करा');
        fireEvent.click(save);
        fireEvent.click(save);

        expect(saveExpense).toHaveBeenCalledTimes(1);
        expect(createMoneyEventFromSource).toHaveBeenCalledTimes(2);
        const billId = (saveExpense.mock.calls[0][0] as { id: string }).id;
        const keys = createMoneyEventFromSource.mock.calls.map(c => (c[0] as { sourceId: string }).sourceId);
        expect(keys.every(k => k.startsWith(`${billId}:`))).toBe(true);
        expect(new Set(keys).size).toBe(2);
        expect(saveExpense.mock.calls[0][0]).toMatchObject({ farmId: 'farm-A' });
    });

    it('the line keys are numbered under the bill opened (not minted at save); a new sheet is a new bill', async () => {
        await openAndRead();
        fireEvent.click(screen.getByText('खर्च म्हणून जतन करा'));
        const first = saveExpense.mock.calls[0][0] as { id: string; lineItems: { id: string }[] };
        expect(first.lineItems.map(l => l.id)).toEqual([uuidv5('0', first.id), uuidv5('1', first.id)]);
        cleanup();

        await openAndRead();
        fireEvent.click(screen.getByText('खर्च म्हणून जतन करा'));
        const second = saveExpense.mock.calls[1][0] as { id: string };
        expect(second.id).not.toBe(first.id);
    });
});

describe('R-2 — a plot bill with no crop picked names no crop', () => {
    it('cropId is absent, never the empty string the old sheet sent as the season id', async () => {
        await openAndRead();
        fireEvent.click(screen.getByText('खर्च म्हणून जतन करा'));
        for (const [payload] of createMoneyEventFromSource.mock.calls) {
            expect(payload).toMatchObject({ plotId: 'p1' });
            expect((payload as { cropId?: string }).cropId).toBeUndefined();
        }
    });
});
