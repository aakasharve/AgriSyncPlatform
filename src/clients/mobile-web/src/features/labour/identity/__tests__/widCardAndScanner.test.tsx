// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID (founder D-54, screens 2 and 5; orchestrator calls 3 and 4).
 *   - The card: the QR (holding ONLY shramsafal.in/w/<code>), the code, the three levels, and the card picture shared
 *     through the phone's own share sheet (the owner's WhatsApp); print where printing exists.
 *   - The scanner: the platform's own QR detection when the phone has it, ALWAYS a typed-code fallback, and only the
 *     typed code where it does not. A scanned or typed code is resolved, and the worker is linked only after "तोच माणूस".
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mockResolve = vi.fn();
const mockStartLink = vi.fn();
const mockLink = vi.fn();
const mockSendCode = vi.fn();
const mockVerify = vi.fn();
vi.mock('../../data/workerIdentityClient', () => ({
    resolveCard: (...a: unknown[]) => mockResolve(...a),
    startLink: (...a: unknown[]) => mockStartLink(...a),
    linkWorker: (...a: unknown[]) => mockLink(...a),
    sendWorkerCode: (...a: unknown[]) => mockSendCode(...a),
    verifyWorkerCode: (...a: unknown[]) => mockVerify(...a),
    reissueCard: vi.fn(),
}));

const mockPicture = vi.fn();
vi.mock('../cardPicture', () => ({ renderCardPicture: (...a: unknown[]) => mockPicture(...a) }));

import { WorkerCardSheet } from '../WorkerCardSheet';
import { CardScanner } from '../CardScanner';
import { LinkByCardSheet } from '../LinkByCardSheet';

const FARM = 'aaaaaaaa-0000-4000-8000-00000000000a';
const worker = {
    id: 'w-ramesh',
    displayName: 'रमेश पाटील',
    fullName: 'खार्डी · दत्तात्रय',
    isActive: true,
    cardCode: 'SS-7K4M-29QX',
    identityLevel: 'Card',
    needsPhoneAndPin: false,
    phoneWhose: 'Own',
    phoneTail: '0101',
    homePin: '413304',
};

beforeEach(() => {
    vi.clearAllMocks();
});
afterEach(() => {
    cleanup();
    delete (window as { BarcodeDetector?: unknown }).BarcodeDetector;
    delete (navigator as { share?: unknown }).share;
    delete (navigator as { canShare?: unknown }).canShare;
    delete (navigator as { mediaDevices?: unknown }).mediaDevices;
});

describe('WID — the worker card', () => {
    it('shows the QR, the code and the three levels; the QR holds only the card address', async () => {
        render(<WorkerCardSheet farmId={FARM} worker={worker} onClose={() => undefined} isNative={false} />);
        expect(screen.getByTestId('card-code')).toHaveTextContent('SS-7K4M-29QX');
        expect(screen.getByTestId('card-name')).toHaveTextContent('रमेश पाटील');
        expect(screen.getByTestId('card-level-name')).toHaveTextContent('नाव झालं');
        expect(screen.getByTestId('card-level-card')).toHaveTextContent('कार्ड झालं');
        expect(screen.getByTestId('card-level-phone')).toHaveTextContent('बाकी');
        const qr = await screen.findByTestId('card-qr');
        expect(qr.getAttribute('src')).toMatch(/^data:image\/png/);
        expect(qr.getAttribute('data-payload')).toBe('https://shramsafal.in/w/SS-7K4M-29QX');
    });

    it('shares the card PICTURE through the phone share sheet (the owner\'s WhatsApp)', async () => {
        mockPicture.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
        const share = vi.fn(async (_data: ShareData) => undefined);
        Object.assign(navigator, { share, canShare: () => true });
        render(<WorkerCardSheet farmId={FARM} worker={worker} onClose={() => undefined} isNative={false} />);
        fireEvent.click(screen.getByTestId('card-share'));
        await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
        const arg = share.mock.calls[0][0];
        expect(arg.files?.[0]).toBeInstanceOf(File);
        expect(arg.files?.[0].type).toBe('image/png');
        expect(JSON.stringify(arg)).not.toContain('0101');
    });

    it('prints where printing exists, and does not show a print button in the installed app (no print there)', () => {
        const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
        const { unmount } = render(<WorkerCardSheet farmId={FARM} worker={worker} onClose={() => undefined} isNative={false} />);
        fireEvent.click(screen.getByTestId('card-print'));
        expect(print).toHaveBeenCalledTimes(1);
        unmount();
        render(<WorkerCardSheet farmId={FARM} worker={worker} onClose={() => undefined} isNative />);
        expect(screen.queryByTestId('card-print')).toBeNull();
    });

    it('proves his phone with the code he reads out (screen 3)', async () => {
        mockSendCode.mockResolvedValue({ ticket: 't-1', phoneTail: '0101' });
        mockVerify.mockResolvedValue({ fieldOperatorId: 'w-ramesh', identityLevel: 'PhoneVerified' });
        const onChanged = vi.fn();
        render(<WorkerCardSheet farmId={FARM} worker={worker} onClose={() => undefined} isNative={false} onChanged={onChanged} />);
        fireEvent.click(screen.getByTestId('card-verify'));
        await screen.findByTestId('card-code-input');
        fireEvent.change(screen.getByTestId('card-code-input'), { target: { value: '4821' } });
        fireEvent.click(screen.getByTestId('card-code-submit'));
        await waitFor(() => expect(mockVerify).toHaveBeenCalledWith(FARM, 'w-ramesh', 't-1', '4821'));
        await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ identityLevel: 'PhoneVerified' })));
    });
});

describe('WID — the scanner', () => {
    it('shows ONLY the typed code where the phone has no QR detection, and reads what is typed', () => {
        const onCode = vi.fn();
        render(<CardScanner onCode={onCode} onCancel={() => undefined} />);
        expect(screen.queryByTestId('scanner-video')).toBeNull();
        fireEvent.change(screen.getByTestId('scanner-typed-input'), { target: { value: 'ss 7k4m 29qx' } });
        fireEvent.click(screen.getByTestId('scanner-typed-submit'));
        expect(onCode).toHaveBeenCalledWith('7K4M29QX');
    });

    it('a typed text that is not a card code is a calm question, never sent', () => {
        const onCode = vi.fn();
        render(<CardScanner onCode={onCode} onCancel={() => undefined} />);
        fireEvent.change(screen.getByTestId('scanner-typed-input'), { target: { value: 'रमेश' } });
        fireEvent.click(screen.getByTestId('scanner-typed-submit'));
        expect(onCode).not.toHaveBeenCalled();
        expect(screen.getByTestId('scanner-typed-error')).toBeInTheDocument();
    });

    it('uses the platform QR detection when the phone has it, and still offers the typed code', () => {
        (window as { BarcodeDetector?: unknown }).BarcodeDetector = class {
            static getSupportedFormats = async () => ['qr_code'];
            detect = async () => [];
        };
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { getUserMedia: () => new Promise(() => undefined) },
        });
        render(<CardScanner onCode={() => undefined} onCancel={() => undefined} />);
        expect(screen.getByTestId('scanner-video')).toBeInTheDocument();
        expect(screen.getByTestId('scanner-typed-input')).toBeInTheDocument();
    });

    it('links a worker by his card only after the owner sees the name and says "तोच माणूस"', async () => {
        mockResolve.mockResolvedValue({ status: 'Active', displayName: 'रमेश पाटील', level: 'Card' });
        mockStartLink.mockResolvedValue({ ticket: null, codeSent: false, displayName: 'रमेश पाटील', level: 'Card' });
        mockLink.mockResolvedValue({ fieldOperatorId: 'w-new', displayName: 'रमेश पाटील', cardCode: 'SS-7K4M-29QX', identityLevel: 'Card', needsPhoneAndPin: false });
        const onLinked = vi.fn();
        render(<LinkByCardSheet farmId={FARM} onLinked={onLinked} onCancel={() => undefined} />);
        fireEvent.change(screen.getByTestId('scanner-typed-input'), { target: { value: 'SS-7K4M-29QX' } });
        fireEvent.click(screen.getByTestId('scanner-typed-submit'));
        expect(await screen.findByTestId('link-found-name')).toHaveTextContent('रमेश पाटील');
        expect(mockLink).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('link-confirm'));
        await waitFor(() => expect(mockLink).toHaveBeenCalledWith(FARM, expect.objectContaining({ cardCode: '7K4M29QX' })));
        await waitFor(() => expect(onLinked).toHaveBeenCalled());
    });
});
