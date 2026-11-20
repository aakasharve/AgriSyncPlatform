// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a, redesign item 5; founder-approved 2026-11-21) - the bill photo sheet keeps its
 * "हा खर्च कशासाठी?" choice (plot / crop / whole farm) and its save, but the plot drop-down and the crop drop-down are the SHARED picker:
 *   - प्लॉटवर: the "सर्व पिकं" card (several crops) and one section per crop - its photo once, then chips (1 to 6 plots) or the number grid
 *     (7 or more); the one chosen plot is dark green with a tick; one count line for the farm;
 *   - पिकासाठी सामायिक: the shared crop cards with the crops in Marathi;
 *   - what the sheet saves is what it saved before (a plot bill carries no crop unless one was chosen; R-2).
 * The bill reader, the attachment queue and the stores are mocked; the sheet and the pickers are real.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CropProfile, ReceiptExtractionResponse } from '../../../../types';

const extractReceiptWithSession = vi.fn<() => Promise<ReceiptExtractionResponse>>();
vi.mock('../../receipt/receiptExtractionClient', () => ({ extractReceiptWithSession: () => extractReceiptWithSession() }));
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

const plot = (id: string, name: string) => ({ id, name }) as unknown as CropProfile['plots'][number];
const crop = (id: string, name: string, color: string, plots: CropProfile['plots']) =>
    ({ id, name, iconName: 'Sprout', color, plots }) as unknown as CropProfile;
// Stored English crop names, as the server keeps them; plots stored out of number order on purpose.
const GRAPES = crop('c1', 'Grapes', 'bg-green-500',
    ['G10', 'G2', 'G1', 'G9', 'G8', 'G7', 'G3', 'G4', 'G5', 'G6', 'G11', 'G12', 'G13', 'G14', 'G15'].map(n => plot(`g${n.slice(1)}`, n)));
const CANE = crop('c2', 'Sugarcane', 'bg-pink-500', [plot('u1', 'U1'), plot('u2', 'U2'), plot('u3', 'U3')]);
const FARM = [GRAPES, CANE];

const READ_BILL = (suggestedScope: ReceiptExtractionResponse['suggestedScope']): ReceiptExtractionResponse => ({
    success: true, confidence: 90, vendorName: 'कृषी सेवा केंद्र', date: '2026-10-20', grandTotal: 600, subtotal: 600, suggestedScope,
    lineItems: [{ name: 'युरिया', quantity: 2, unit: 'पोती', unitPrice: 300, totalAmount: 600, suggestedCategory: 'FERTILIZER', confidence: 90 }],
});

async function openWith(crops: CropProfile[], scope: ReceiptExtractionResponse['suggestedScope'], activePlotId?: string) {
    extractReceiptWithSession.mockResolvedValue(READ_BILL(scope));
    render(<ReceiptCaptureSheet onClose={vi.fn()} onSave={vi.fn()} crops={crops} activePlotId={activePlotId} />);
    fireEvent.change(screen.getByTestId('attachment-input'), { target: { files: [new File(['x'], 'bill.png', { type: 'image/png' })] } });
    await screen.findByText('बिलातल्या वस्तू');
}

const part = (el: Element, name: string) => el.querySelector(`[data-part="${name}"]`);
const pressed = (id: string) => screen.getByTestId(id).getAttribute('aria-pressed');
const save = () => fireEvent.click(screen.getByText('खर्च म्हणून जतन करा'));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ReceiptCaptureSheet - प्लॉटवर uses the shared plot picker', () => {
    it('has no drop-down any more: the "सर्व पिकं" card, a section per crop, the scope choice still above', async () => {
        await openWith(FARM, 'PLOT');
        const sheet = screen.getByTestId('receipt-capture-sheet');
        expect(sheet.querySelector('select')).toBeNull();
        expect(sheet).toHaveTextContent('हा खर्च कशासाठी?');
        expect(sheet).toHaveTextContent(SCOPE_LABEL.PLOT);
        expect(sheet).toHaveTextContent(SCOPE_LABEL.CROP);
        expect(sheet).toHaveTextContent(SCOPE_LABEL.FARM);
        // the choice sits ABOVE the picker
        expect(screen.getByText('हा खर्च कशासाठी?').compareDocumentPosition(screen.getByTestId('bill-plot-pick')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const card = screen.getByTestId('bill-crop-all-card');
        expect(card).toHaveTextContent('सर्व पिकं');
        expect(card).toHaveTextContent('द्राक्ष');
        expect(card).toHaveTextContent('ऊस');
        expect(screen.getByTestId('bill-plot-pick').textContent).not.toMatch(/Grapes|Sugarcane/);
        expect(screen.getByTestId('bill-crop-section-c1')).toBeInTheDocument();
        expect(screen.getByTestId('bill-crop-section-c2')).toBeInTheDocument();
    });

    it('the big crop: its photo once in a header, a number grid in natural order with Marathi digits; the small crop keeps chips', async () => {
        await openWith(FARM, 'PLOT');
        expect(screen.getByTestId('bill-crop-header-c1').querySelector('img, svg')).toBeTruthy();
        expect(screen.queryByTestId('bill-crop-header-c2')).toBeNull();
        const grid = screen.getByTestId('bill-grid-c1');
        expect(grid.children).toHaveLength(15);
        expect([...grid.children].map(c => part(c, 'name')?.textContent)).toEqual(Array.from({ length: 15 }, (_, i) => `G${i + 1}`));
        expect(part(screen.getByTestId('bill-plot-g12'), 'number')).toHaveTextContent('१२');
        expect(part(screen.getByTestId('bill-plot-g7'), 'number')).toHaveTextContent('७');
        expect(screen.getByTestId('bill-crop-section-c1').querySelector('[data-mode="grid"]')).toBeTruthy();
        expect(screen.getByTestId('bill-crop-section-c2').querySelector('[data-mode="chips"]')).toBeTruthy();
        expect(screen.getByTestId('bill-plot-u2')).toHaveTextContent('U2');
    });

    it('no "select all" (a bill goes on ONE plot); the count line says 0 of 18 until one is chosen', async () => {
        await openWith(FARM, 'PLOT');
        expect(screen.queryByTestId('plot-quick-row')).toBeNull();
        expect(screen.getByTestId('bill-picked-count')).toHaveTextContent('१८ पैकी ० निवडले');
        expect(screen.getByText('खर्च म्हणून जतन करा').closest('button')).toBeDisabled();
    });

    it('a tap chooses the plot in the one chosen look (dark green, white letters, a tick), names it above, and the save goes there with no crop', async () => {
        await openWith(FARM, 'PLOT');
        fireEvent.click(screen.getByTestId('bill-plot-g7'));
        const box = screen.getByTestId('bill-plot-g7');
        expect(box).toHaveAttribute('aria-pressed', 'true');
        expect(box.className).toContain('bg-emerald-800');
        expect(box.className).toContain('text-white');
        expect(part(box, 'tick')).toBeTruthy();
        expect(screen.getByTestId('bill-plot-g8').className).toContain('bg-white');
        expect(pressed('bill-plot-g8')).toBe('false');
        expect(screen.getByTestId('bill-picked-count')).toHaveTextContent('१८ पैकी १ निवडले');
        expect(screen.getByText(SCOPE_LABEL.PLOT).closest('button')).toHaveTextContent('G7');

        // a plot of the OTHER crop moves the one choice
        fireEvent.click(screen.getByTestId('bill-plot-u2'));
        expect(pressed('bill-plot-u2')).toBe('true');
        expect(pressed('bill-plot-g7')).toBe('false');
        fireEvent.click(screen.getByTestId('bill-plot-g7'));

        save();
        expect(saveExpense).toHaveBeenCalledWith(expect.objectContaining({ scope: 'PLOT', plotId: 'g7' }));
        expect((saveExpense.mock.calls[0][0] as { cropId?: string }).cropId).toBeUndefined(); // R-2: no crop picked, no crop sent
        await waitFor(() => expect(createMoneyEventFromSource).toHaveBeenCalledWith(expect.objectContaining({ plotId: 'g7' })));
    });

    it('the page\'s plot arrives chosen', async () => {
        await openWith(FARM, 'PLOT', 'g12');
        expect(pressed('bill-plot-g12')).toBe('true');
        expect(screen.getByTestId('bill-picked-count')).toHaveTextContent('१८ पैकी १ निवडले');
    });

    it('a crop photo on the card narrows the list to that crop (a view only: the chosen plot stays chosen and counted)', async () => {
        await openWith(FARM, 'PLOT', 'g7');
        fireEvent.click(screen.getByTestId('bill-crop-all-photo-c2'));
        expect(screen.queryByTestId('bill-crop-section-c1')).toBeNull();
        expect(screen.getByTestId('bill-crop-section-c2')).toBeInTheDocument();
        expect(screen.getByTestId('bill-picked-count')).toHaveTextContent('१८ पैकी १ निवडले');
        expect(screen.getByText('खर्च म्हणून जतन करा').closest('button')).not.toBeDisabled();
        fireEvent.click(screen.getByTestId('bill-crop-all'));
        expect(screen.getByTestId('bill-crop-section-c1')).toBeInTheDocument();
        expect(pressed('bill-plot-g7')).toBe('true');
    });

    it('a farm with one big crop has no card, so the crop\'s photo stands once in a header over its plots', async () => {
        await openWith([GRAPES], 'PLOT');
        expect(screen.queryByTestId('bill-crop-all-card')).toBeNull();
        expect(screen.getByTestId('bill-crop-header-c1')).toHaveTextContent('द्राक्ष');
        expect(screen.getByTestId('bill-crop-header-c1')).toHaveTextContent('१५ प्लॉट');
        expect(screen.getByTestId('bill-picked-count')).toHaveTextContent('१५ पैकी ० निवडले');
    });

    it('leaves no English on the sheet', async () => {
        await openWith(FARM, 'PLOT', 'g7');
        const found = (document.body.textContent ?? '').replace(/G\d+|U\d+/g, '').match(/[A-Za-z]+/g) ?? []; // the farmer's own plot names are his
        expect(found).toEqual([]);
        document.body.querySelectorAll('[placeholder],[aria-label],[alt],[title]').forEach(el => {
            for (const a of ['placeholder', 'aria-label', 'alt', 'title']) expect(el.getAttribute(a) ?? '').not.toMatch(/[A-Za-z]/);
        });
    });
});

describe('ReceiptCaptureSheet - पिकासाठी सामायिक uses the shared crop cards', () => {
    it('has no drop-down: one card per crop in Marathi; the footer waits for a crop; the save carries the crop', async () => {
        await openWith(FARM, 'CROP');
        const sheet = screen.getByTestId('receipt-capture-sheet');
        expect(sheet.querySelector('select')).toBeNull();
        expect(screen.getByTestId('bill-crop-pick')).toBeInTheDocument();
        expect(screen.getByTestId('bill-crop-c1')).toHaveTextContent('द्राक्ष');
        expect(screen.getByTestId('bill-crop-c1')).toHaveTextContent('१५ प्लॉट');
        expect(screen.getByTestId('bill-crop-c2')).toHaveTextContent('ऊस');
        expect(screen.getByTestId('bill-crop-pick').textContent).not.toMatch(/Grapes|Sugarcane/);
        expect(screen.queryByTestId('bill-crop-all-card')).toBeNull(); // "every crop" is the whole-farm choice above, not a crop
        expect(pressed('bill-crop-c1')).toBe('false');
        expect(screen.getByText('खर्च म्हणून जतन करा').closest('button')).toBeDisabled();

        fireEvent.click(screen.getByTestId('bill-crop-c2'));
        expect(pressed('bill-crop-c2')).toBe('true');
        expect(pressed('bill-crop-c1')).toBe('false');
        expect(part(screen.getByTestId('bill-crop-c2'), 'tick')).toBeTruthy();
        expect(screen.getByText(SCOPE_LABEL.CROP).closest('button')).toHaveTextContent('सर्व ऊस');
        expect(screen.getByText('खर्च म्हणून जतन करा').closest('button')).not.toBeDisabled();

        save();
        expect(saveExpense).toHaveBeenCalledWith(expect.objectContaining({ scope: 'CROP', cropId: 'c2', plotId: undefined }));
    });
});

describe('ReceiptCaptureSheet - सर्व शेतासाठी asks for no place', () => {
    it('shows neither picker and saves a whole-farm bill as before', async () => {
        await openWith(FARM, 'FARM');
        expect(screen.queryByTestId('bill-plot-pick')).toBeNull();
        expect(screen.queryByTestId('bill-crop-pick')).toBeNull();
        save();
        expect(saveExpense).toHaveBeenCalledWith(expect.objectContaining({ scope: 'FARM', plotId: undefined, cropId: undefined }));
    });
});
