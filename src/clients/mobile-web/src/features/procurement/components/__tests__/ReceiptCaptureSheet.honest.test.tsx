// @vitest-environment jsdom
/**
 * spec: pre-launch-repair L2a (R-3, R-6, R-8) — the bill sheet:
 *   - R-3: never sends a bill to a guessed farm. The plot's farm wins over the farm on screen; with no farm
 *     known nothing is read or queued and the sheet asks once which farm (review M1) — or, knowing no farm
 *     at all, says so — then carries on with the chosen farm, or by itself once a farm is known. Closing
 *     while the photo waits asks first (M1); "पुन्हा काढा" drops a waiting photo (m4); a remembered farm
 *     this phone does not hold is no farm (m8).
 *   - R-6: no "paid"/"cash", no ₹0 rate, no ₹0 line; an amount nobody read shows "—"; a total-only bill is
 *     one entry for its total; no total read = an empty field, not ₹0.
 *   - R-8: the photo is queued (never silently skipped), its upload state is shown in the app's existing
 *     words, and the money entry names the photo's id — never the base64 photo.
 * The reader, the photo queue, the stores and the evidence read are mocked; the sheet is real.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CropProfile, ReceiptExtractionResponse } from '../../../../types';

const h = vi.hoisted(() => ({
    plotFarm: null as string | null,
    evidence: null as unknown,
    sessionFarm: null as string | null,
    phoneFarms: [] as string[],
}));
const extractReceiptWithSession = vi.fn<(b: string, farm: string) => Promise<ReceiptExtractionResponse>>();
vi.mock('../../receipt/receiptExtractionClient', () => ({
    extractReceiptWithSession: (b: string, farm: string) => extractReceiptWithSession(b, farm),
}));
vi.mock('../../../../infrastructure/sync/SyncContext', () => ({
    resolveFarmIdFromSyncState: async () => h.plotFarm,
    // Stands in for the real Dexie check (tested on its own in SyncContext.test.ts).
    resolveKnownFarmId: async (id: string | null) => (id && h.phoneFarms.includes(id) ? id : null),
}));
vi.mock('../../../../infrastructure/storage/SessionStore', () => ({ SessionStore: { getCurrentFarmId: () => h.sessionFarm } }));
vi.mock('../../../../infrastructure/sync/AttachmentUploadWorker', () => ({ attachmentUploadWorker: { triggerNow: vi.fn() } }));
const captureAttachment = vi.fn();
vi.mock('../../../../application/use-cases/CaptureAttachment', () => ({ captureAttachment: (...a: unknown[]) => captureAttachment(...a) }));
vi.mock('../../../finance/moneyEntryState', () => ({ useMoneyEvidence: () => h.evidence }));
const saveExpense = vi.fn();
vi.mock('../../../../services/procurementRepository', () => ({ procurementRepository: { saveExpense: (...a: unknown[]) => saveExpense(...a) } }));
const createMoneyEventFromSource = vi.fn();
vi.mock('../../../finance/financeCommandService', () => ({
    financeCommandService: { createMoneyEventFromSource: (...a: unknown[]) => createMoneyEventFromSource(...a) },
}));

import { FarmContext } from '../../../../core/session/FarmContext';
import {
    CLOSE_ANYWAY_MR, CLOSE_WAITING_MR, FARM_UNKNOWN_MR, KEEP_OPEN_MR, NO_FARM_AT_ALL_MR, PHOTO_NOT_KEPT_MR, ReceiptCaptureSheet,
} from '../ReceiptCaptureSheet';

const CROPS = [{ id: 'c1', name: 'द्राक्ष', plots: [{ id: 'p1', name: 'थॉम्पसन' }] }] as unknown as CropProfile[];

const BILL: ReceiptExtractionResponse = {
    success: true, confidence: 90, vendorName: 'कृषी सेवा केंद्र', date: '2026-10-20', grandTotal: 600, subtotal: 600,
    suggestedScope: 'FARM',
    lineItems: [
        { name: 'युरिया', quantity: 2, unit: 'पोती', totalAmount: 600, suggestedCategory: 'FERTILIZER', confidence: 90 }, // no rate read
        { name: 'पिशवी', totalAmount: 0, suggestedCategory: 'MISC', confidence: 40 }, // no amount read
    ],
};

const FARM_A = { farmId: 'farm-A', name: 'मळा', status: 'Active' };
const FARM_B = { farmId: 'farm-B', name: 'ओढ्याकडचं शेत', status: 'Active' };

function withFarm(currentFarmId: string | null, node: React.ReactElement, farms: object[] = []): React.ReactElement {
    const value = { meContext: null, isLoading: false, currentFarmId, currentFarm: null, farms, switchFarm: vi.fn(), refresh: vi.fn(), loadFailed: false };
    return <FarmContext.Provider value={value as never}>{node}</FarmContext.Provider>;
}

const sheet = (props: Partial<React.ComponentProps<typeof ReceiptCaptureSheet>> = {}) =>
    <ReceiptCaptureSheet onClose={vi.fn()} onSave={vi.fn()} crops={CROPS} {...props} />;

function takePhoto() {
    fireEvent.change(screen.getByTestId('attachment-input'), { target: { files: [new File(['x'], 'bill.png', { type: 'image/png' })] } });
}

beforeEach(() => {
    h.plotFarm = null;
    h.evidence = null;
    h.sessionFarm = null;
    h.phoneFarms = [];
    captureAttachment.mockResolvedValue({ id: 'att-1', status: 'pending' });
    extractReceiptWithSession.mockResolvedValue(BILL);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('R-3 — the bill goes to a known farm, never a guessed one', () => {
    it('no farm known and none to choose: says so plainly — no promise the photo is kept — nothing read or queued', async () => {
        const { rerender } = render(withFarm(null, sheet()));
        takePhoto();
        const banner = await screen.findByTestId('bill-farm-unknown');
        expect(banner).toHaveTextContent(NO_FARM_AT_ALL_MR);
        expect(banner).not.toHaveTextContent('फोनवरच आहे');
        expect(screen.queryByTestId(/^bill-farm-choice-/)).toBeNull();
        expect(captureAttachment).not.toHaveBeenCalled();
        expect(extractReceiptWithSession).not.toHaveBeenCalled();

        // …and carries on by itself once the app knows the farm — to THAT farm.
        rerender(withFarm('farm-9', sheet()));
        await screen.findByText('बिलातल्या वस्तू');
        expect(screen.queryByTestId('bill-farm-unknown')).toBeNull();
        expect(captureAttachment).toHaveBeenCalledWith(expect.objectContaining({ farmId: 'farm-9' }));
        expect(extractReceiptWithSession).toHaveBeenCalledWith(expect.any(String), 'farm-9');
    });

    it('the plot\'s own farm wins over the farm on screen — for the photo, the reading and the money', async () => {
        h.plotFarm = 'farm-A';
        render(withFarm('farm-B', sheet({ activePlotId: 'p1' })));
        takePhoto();
        await screen.findByText('बिलातल्या वस्तू');
        fireEvent.click(screen.getByText('खर्च म्हणून जतन करा'));

        expect(captureAttachment).toHaveBeenCalledWith(expect.objectContaining({ farmId: 'farm-A' }));
        expect(extractReceiptWithSession).toHaveBeenCalledWith(expect.any(String), 'farm-A');
        expect(createMoneyEventFromSource).toHaveBeenCalledWith(expect.objectContaining({ farmId: 'farm-A' }));
    });

    it('no farm known: asks ONCE which farm; choosing one carries on to THAT farm — photo, reading and money', async () => {
        render(withFarm(null, sheet(), [FARM_A, FARM_B]));
        takePhoto();
        const banner = await screen.findByTestId('bill-farm-unknown');
        expect(banner).toHaveTextContent(FARM_UNKNOWN_MR);
        expect(banner).not.toHaveTextContent('फोनवरच आहे');
        expect(captureAttachment).not.toHaveBeenCalled();
        expect(extractReceiptWithSession).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('bill-farm-choice-farm-B'));
        await screen.findByText('बिलातल्या वस्तू');
        expect(screen.queryByTestId('bill-farm-unknown')).toBeNull();
        expect(captureAttachment).toHaveBeenCalledTimes(1);
        expect(captureAttachment).toHaveBeenCalledWith(expect.objectContaining({ farmId: 'farm-B', linkedEntityId: 'farm-B' }));
        expect(extractReceiptWithSession).toHaveBeenCalledWith(expect.any(String), 'farm-B');
        fireEvent.click(screen.getByText('खर्च म्हणून जतन करा'));
        expect(createMoneyEventFromSource).toHaveBeenCalledWith(expect.objectContaining({ farmId: 'farm-B' }));
    });

    it('closing while the photo waits for its farm asks first — "नाही" keeps it, "हो" closes', async () => {
        const onClose = vi.fn();
        render(withFarm(null, sheet({ onClose }), [FARM_A]));
        takePhoto();
        await screen.findByTestId('bill-farm-unknown');

        fireEvent.click(screen.getByLabelText('बंद करा'));
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByTestId('bill-close-confirm')).toHaveTextContent(CLOSE_WAITING_MR);
        fireEvent.click(screen.getByText(KEEP_OPEN_MR));
        expect(screen.queryByTestId('bill-close-confirm')).toBeNull();
        expect(screen.getByTestId('bill-farm-unknown')).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('बंद करा'));
        fireEvent.click(screen.getByText(CLOSE_ANYWAY_MR));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(captureAttachment).not.toHaveBeenCalled();
    });

    it('with no photo waiting, the close button closes at once', () => {
        const onClose = vi.fn();
        render(withFarm('farm-1', sheet({ onClose })));
        fireEvent.click(screen.getByLabelText('बंद करा'));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('bill-close-confirm')).toBeNull();
    });

    it('"पुन्हा काढा" drops a waiting photo: when the farm later arrives, the discarded photo is never queued', async () => {
        const { rerender } = render(withFarm(null, sheet()));
        takePhoto();
        await screen.findByTestId('bill-farm-unknown');
        fireEvent.click(screen.getByText('पुन्हा काढा'));
        expect(screen.queryByTestId('bill-farm-unknown')).toBeNull();

        rerender(withFarm('farm-9', sheet()));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(captureAttachment).not.toHaveBeenCalled();
        expect(extractReceiptWithSession).not.toHaveBeenCalled();
        expect(screen.getByText('फोटो काढा')).toBeInTheDocument();
    });

    it('a remembered farm counts only if this phone holds it (the log path\'s own check)', async () => {
        h.sessionFarm = 'farm-gone';
        render(sheet()); // no FarmContext: the remembered pointer is the only farm on offer
        takePhoto();
        expect(await screen.findByTestId('bill-farm-unknown')).toHaveTextContent(NO_FARM_AT_ALL_MR);
        expect(captureAttachment).not.toHaveBeenCalled();
        cleanup();

        h.phoneFarms = ['farm-gone'];
        render(sheet());
        takePhoto();
        await screen.findByText('बिलातल्या वस्तू');
        expect(captureAttachment).toHaveBeenCalledWith(expect.objectContaining({ farmId: 'farm-gone' }));
    });
});

describe('R-6 — nothing invented on a bill', () => {
    it('no "paid"/"cash", no ₹0 rate, no ₹0 line; an unread amount shows "—"', async () => {
        render(withFarm('farm-1', sheet()));
        takePhoto();
        await screen.findByText('बिलातल्या वस्तू');
        expect(screen.getByTestId('bill-line-amount-0')).toHaveTextContent('₹600');
        expect(screen.getByTestId('bill-line-amount-1')).toHaveTextContent('—');
        expect(screen.getByTestId('bill-line-amount-1')).not.toHaveTextContent('₹');

        fireEvent.click(screen.getByText('खर्च म्हणून जतन करा'));
        const saved = saveExpense.mock.calls[0][0] as Record<string, unknown>;
        expect(saved.paymentStatus).toBeUndefined();
        expect(createMoneyEventFromSource).toHaveBeenCalledTimes(1); // the ₹0 line is not sent
        const money = createMoneyEventFromSource.mock.calls[0][0] as Record<string, unknown>;
        expect(money.amount).toBe(600);
        expect(money.paymentMode).toBeUndefined();
        expect(money.unitPrice).toBeUndefined();
    });

    it('a total-only bill is saved as ONE entry for its total', async () => {
        extractReceiptWithSession.mockResolvedValue({ ...BILL, grandTotal: 750, lineItems: [{ name: 'माल', totalAmount: 0, suggestedCategory: 'MISC', confidence: 30 }] });
        render(withFarm('farm-1', sheet()));
        takePhoto();
        await screen.findByText('बिलातल्या वस्तू');
        fireEvent.click(screen.getByText('खर्च म्हणून जतन करा'));
        expect(createMoneyEventFromSource).toHaveBeenCalledTimes(1);
        expect(createMoneyEventFromSource).toHaveBeenCalledWith(expect.objectContaining({ amount: 750, sourceId: expect.stringMatching(/:total$/) }));
    });

    it('no total read: the field is empty (never ₹0) and the bill cannot be saved until one is given', async () => {
        extractReceiptWithSession.mockResolvedValue({ ...BILL, grandTotal: 0, subtotal: 0 });
        render(withFarm('farm-1', sheet()));
        takePhoto();
        await screen.findByText('बिलातल्या वस्तू');
        expect(screen.getByTestId('bill-total')).toHaveValue(null);
        expect(screen.getByText('खर्च म्हणून जतन करा').closest('button')).toBeDisabled();
        fireEvent.change(screen.getByTestId('bill-total'), { target: { value: '450' } });
        expect(screen.getByText('खर्च म्हणून जतन करा').closest('button')).not.toBeDisabled();
    });
});

describe('R-8 — the bill photo is never silently skipped', () => {
    it('queued once, its state shown in the app\'s words, and the money names its id — never the photo', async () => {
        render(withFarm('farm-1', sheet()));
        takePhoto();
        await screen.findByText('बिलातल्या वस्तू');
        expect(captureAttachment).toHaveBeenCalledTimes(1);
        const queued = captureAttachment.mock.calls[0][0] as { file: File };
        expect(queued.file.name).toBe('bill.png'); // the original file, as picked
        expect(screen.getByTestId('bill-photo-state')).toHaveTextContent('पाठवायचा बाकी');

        fireEvent.click(screen.getByText('खर्च म्हणून जतन करा'));
        const money = createMoneyEventFromSource.mock.calls[0][0] as { attachments: string[] };
        expect(money.attachments).toEqual(['att-1']);
        expect(JSON.stringify(money.attachments)).not.toContain('data:');
    });

    it('the state follows the upload: uploaded → "पाठवला"', async () => {
        h.evidence = { rows: [], server: [], photos: new Map([['att-1', 'uploaded']]) };
        render(withFarm('farm-1', sheet()));
        takePhoto();
        await waitFor(() => expect(screen.getByTestId('bill-photo-state')).toHaveTextContent('पाठवला'));
    });

    it('a photo that could not be kept is said, not swallowed — and no base64 goes to the money instead', async () => {
        captureAttachment.mockRejectedValue(new Error('disk full'));
        render(withFarm('farm-1', sheet()));
        takePhoto();
        expect(await screen.findByTestId('bill-photo-not-kept')).toHaveTextContent(PHOTO_NOT_KEPT_MR);
        await screen.findByText('बिलातल्या वस्तू');
        fireEvent.click(screen.getByText('खर्च म्हणून जतन करा'));
        expect((createMoneyEventFromSource.mock.calls[0][0] as { attachments: string[] }).attachments).toEqual([]);
    });
});
