// @vitest-environment jsdom
/**
 * spec: pre-launch-repair L2a (R-9, P5) — the "split this bill across plots" step that followed a whole-farm
 * bill is gone for EVERY seat: it sent the bill's own id as a money entry id, which the server never has, so
 * the split could never land (alignment N2). A whole-farm bill is recorded once, as whole-farm, and the sheet
 * closes. (Before: plr-d7-m1-multiuser step 2 offered it to seats with AddCost; that permission helper stays,
 * for when allocation is built — P-D12.)
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CropProfile, ReceiptExtractionResponse } from '../../../../types';

const extractReceiptWithSession = vi.fn<() => Promise<ReceiptExtractionResponse>>();
vi.mock('../../receipt/receiptExtractionClient', () => ({
    extractReceiptWithSession: () => extractReceiptWithSession(),
}));
vi.mock('../../../../infrastructure/sync/SyncContext', () => ({ resolveFarmIdFromSyncState: async () => null }));
vi.mock('../../../../infrastructure/sync/AttachmentUploadWorker', () => ({ attachmentUploadWorker: { triggerNow: vi.fn() } }));
vi.mock('../../../../application/use-cases/CaptureAttachment', () => ({ captureAttachment: vi.fn(async () => ({ id: 'att-1', status: 'pending' })) }));
vi.mock('../../../finance/moneyEntryState', () => ({ useMoneyEvidence: () => null }));
const saveExpense = vi.fn();
vi.mock('../../../../services/procurementRepository', () => ({ procurementRepository: { saveExpense: (...a: unknown[]) => saveExpense(...a) } }));
const createMoneyEventFromSource = vi.fn();
vi.mock('../../../finance/financeCommandService', () => ({
    financeCommandService: { createMoneyEventFromSource: (...a: unknown[]) => createMoneyEventFromSource(...a) },
}));

import { FarmContext } from '../../../../core/session/FarmContext';
import { mayChangeRecordedMoney } from '../../../../core/session/farmPermissions';
import { ReceiptCaptureSheet } from '../ReceiptCaptureSheet';

const CROPS = [
    { id: 'c1', name: 'द्राक्ष', plots: [{ id: 'p1', name: 'थॉम्पसन' }, { id: 'p2', name: 'सोनाका' }] },
] as unknown as CropProfile[];

const WHOLE_FARM_BILL: ReceiptExtractionResponse = {
    success: true, confidence: 90, vendorName: 'कृषी सेवा केंद्र', date: '2026-10-20', grandTotal: 900, subtotal: 900,
    suggestedScope: 'FARM',
    lineItems: [{ name: 'डिझेल', quantity: 10, unit: 'लिटर', unitPrice: 90, totalAmount: 900, suggestedCategory: 'FUEL', confidence: 90 }],
};

/** The current farm as `/me/context` answered it; `permissions` absent = an older server. */
function withFarm(permissions: string[] | undefined, node: React.ReactElement): React.ReactElement {
    const currentFarm = { farmId: 'farm-1', role: 'Worker', status: 'Active', ...(permissions ? { permissions } : {}) };
    const value = {
        meContext: null, isLoading: false, currentFarmId: 'farm-1', currentFarm, farms: [currentFarm],
        switchFarm: vi.fn(), refresh: vi.fn(), loadFailed: false,
    };
    return <FarmContext.Provider value={value as never}>{node}</FarmContext.Provider>;
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function photographAndSave() {
    fireEvent.change(screen.getByTestId('attachment-input'), { target: { files: [new File(['x'], 'bill.png', { type: 'image/png' })] } });
    await screen.findByText('बिलातल्या वस्तू');
    fireEvent.click(screen.getByText('खर्च म्हणून जतन करा'));
}

describe('no split-the-bill step — a whole-farm bill stays whole-farm (L2a R-9)', () => {
    it.each([
        ['a worker (no AddCost)', []],
        ['the primary owner (AddCost)', ['SeeMoney', 'AddCost', 'PlanWork']],
        ['an older server (no permissions sent)', undefined],
    ] as const)('%s: the bill is recorded once as whole-farm, no split is offered, the sheet closes', async (_who, permissions) => {
        extractReceiptWithSession.mockResolvedValue(WHOLE_FARM_BILL);
        const onSave = vi.fn(); const onClose = vi.fn();
        render(withFarm(permissions as string[] | undefined, <ReceiptCaptureSheet onClose={onClose} onSave={onSave} crops={CROPS} />));
        await photographAndSave();

        expect(saveExpense).toHaveBeenCalledTimes(1);
        expect(saveExpense).toHaveBeenCalledWith(expect.objectContaining({ scope: 'FARM', grandTotal: 900, plotId: undefined }));
        expect(createMoneyEventFromSource).toHaveBeenCalledTimes(1);
        expect(createMoneyEventFromSource).toHaveBeenCalledWith(expect.objectContaining({ amount: 900, eventType: 'Expense', plotId: undefined, farmId: 'farm-1' }));
        expect(document.body.textContent).not.toContain('वाटा');
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe('mayChangeRecordedMoney', () => {
    it('reads only the server\'s AddCost answer; unknown is "as before"', () => {
        expect(mayChangeRecordedMoney({ permissions: ['AddCost'] })).toBe(true);
        expect(mayChangeRecordedMoney({ permissions: ['SeeMoney', 'PlanWork'] })).toBe(false);
        expect(mayChangeRecordedMoney({ permissions: [] })).toBe(false);
        expect(mayChangeRecordedMoney({ permissions: null })).toBe(true);
        expect(mayChangeRecordedMoney({})).toBe(true);
        expect(mayChangeRecordedMoney(null)).toBe(true);
    });
});
