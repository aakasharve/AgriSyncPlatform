// @vitest-environment jsdom
/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 2, verifier MU2-V1) — after a whole-farm bill is saved
 * on a farm with several plots, the sheet offers to split it over the plots ("खर्च प्लॉटमध्ये वाटा").
 * The server lets only a seat with the AddCost permission split money (the primary owner, or someone
 * he stored it for), so the step is offered exactly to those seats — the bill itself is recorded for
 * everyone, unchanged. When the phone cannot know (an older server sends no `permissions`; no farm
 * context), the step is offered as before (P11).
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
vi.mock('../../../../application/use-cases/CaptureAttachment', () => ({ captureAttachment: vi.fn() }));
vi.mock('../../../finance/components/AllocationSelector', () => ({
    default: (props: { totalAmount: number }) => <div data-testid="split-bill-step">split {props.totalAmount}</div>,
}));
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

function sheet(onSave: () => void, onClose: () => void) {
    return <ReceiptCaptureSheet onClose={onClose} onSave={onSave} crops={CROPS} />;
}

async function photographAndSave() {
    fireEvent.change(screen.getByTestId('attachment-input'), { target: { files: [new File(['x'], 'bill.png', { type: 'image/png' })] } });
    await screen.findByText('बिलातल्या वस्तू');
    fireEvent.click(screen.getByText('खर्च म्हणून जतन करा'));
}

describe('the split-the-bill step follows what the server lets this seat do', () => {
    it('a worker (server sent no AddCost) records the whole-farm bill and is NOT offered the split', async () => {
        extractReceiptWithSession.mockResolvedValue(WHOLE_FARM_BILL);
        const onSave = vi.fn(); const onClose = vi.fn();
        render(withFarm([], sheet(onSave, onClose)));
        await photographAndSave();

        expect(saveExpense).toHaveBeenCalledWith(expect.objectContaining({ scope: 'FARM', grandTotal: 900 }));
        expect(createMoneyEventFromSource).toHaveBeenCalledWith(expect.objectContaining({ amount: 900, eventType: 'Expense' }));
        expect(screen.queryByTestId('split-bill-step')).toBeNull();
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('the primary owner (server sent AddCost) records the bill and IS offered the split', async () => {
        extractReceiptWithSession.mockResolvedValue(WHOLE_FARM_BILL);
        const onSave = vi.fn(); const onClose = vi.fn();
        render(withFarm(['SeeMoney', 'AddCost', 'PlanWork'], sheet(onSave, onClose)));
        await photographAndSave();

        expect(saveExpense).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('split-bill-step')).toHaveTextContent('split 900');
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('an older server (no permissions sent) keeps today\'s split step', async () => {
        extractReceiptWithSession.mockResolvedValue(WHOLE_FARM_BILL);
        render(withFarm(undefined, sheet(vi.fn(), vi.fn())));
        await photographAndSave();
        expect(screen.getByTestId('split-bill-step')).toBeInTheDocument();
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
