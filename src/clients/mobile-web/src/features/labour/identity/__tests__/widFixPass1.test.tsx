// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID fix pass 1 (review L6, with H1/H2/M2 refusals). The
 * phone says what actually happened, in ShramSafal's words:
 *   - a NUMBER search that finds nobody says the number was not found (not "no such card"), and the code line on the
 *     number path names nobody (no broken "च्या फोनवर…");
 *   - a new card that cannot be given states the rule (owner only; only the farm holding his proof), never "try again";
 *   - "छापा" prints the card alone, in its colours;
 *   - the phone and PIN boxes show no Latin "x" and no real PIN as a hint.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mockResolve = vi.fn();
const mockStartLink = vi.fn();
const mockLink = vi.fn();
const mockReissue = vi.fn();
const mockSendCode = vi.fn();
vi.mock('../../data/workerIdentityClient', () => ({
    resolveCard: (...a: unknown[]) => mockResolve(...a),
    startLink: (...a: unknown[]) => mockStartLink(...a),
    linkWorker: (...a: unknown[]) => mockLink(...a),
    sendWorkerCode: (...a: unknown[]) => mockSendCode(...a),
    verifyWorkerCode: vi.fn(),
    reissueCard: (...a: unknown[]) => mockReissue(...a),
    identityErrorCode: (error: unknown) => {
        const data = (error as { response?: { data?: { error?: unknown } } } | null)?.response?.data;
        return typeof data?.error === 'string' ? data.error : null;
    },
}));
vi.mock('../cardPicture', () => ({ renderCardPicture: vi.fn() }));

import { LinkByCardSheet } from '../LinkByCardSheet';
import { WorkerCardSheet } from '../WorkerCardSheet';
import { AddMemberWizard } from '../../../people/components/AddMemberWizard';

const FARM = 'aaaaaaaa-0000-4000-8000-00000000000a';
const refusal = (error: string) => ({ response: { status: 404, data: { error } } });
const worker = {
    id: 'w-ramesh',
    displayName: 'रमेश पाटील',
    isActive: true,
    cardCode: 'SS-7K4M-29QX',
    identityLevel: 'Card',
    needsPhoneAndPin: false,
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('WID fix pass 1 — the number path of "कोड किंवा QR ने जोडा"', () => {
    it('a number with no verified holder says the NUMBER was not found, never "no such card"', async () => {
        mockStartLink.mockRejectedValue(refusal('identity.not_found'));
        render(<LinkByCardSheet farmId={FARM} onLinked={() => undefined} onCancel={() => undefined} />);
        fireEvent.change(screen.getByTestId('link-phone'), { target: { value: '6000000401' } });
        fireEvent.click(screen.getByTestId('link-phone-submit'));
        const note = await screen.findByTestId('link-note');
        expect(note).toHaveTextContent('हा नंबर सापडला नाही');
        expect(note).not.toHaveTextContent('कार्ड');
    });

    it('on the number path the code line names nobody and is whole Marathi (no "च्या फोनवर" without a name)', async () => {
        mockStartLink.mockResolvedValue({ ticket: 't-1', codeSent: true, displayName: null, level: null });
        render(<LinkByCardSheet farmId={FARM} onLinked={() => undefined} onCancel={() => undefined} />);
        fireEvent.change(screen.getByTestId('link-phone'), { target: { value: '6000000401' } });
        fireEvent.click(screen.getByTestId('link-phone-submit'));
        const line = await screen.findByTestId('link-code-sent');
        expect(line.textContent).toBe('या नंबरवर कोड पाठवला — त्याची परवानगी लागेल.');
        expect(line.textContent?.startsWith('च्या')).toBe(false);
    });

    it('the card path still says "no such card" for an unknown card code', async () => {
        mockResolve.mockRejectedValue(refusal('identity.not_found'));
        render(<LinkByCardSheet farmId={FARM} onLinked={() => undefined} onCancel={() => undefined} />);
        fireEvent.change(screen.getByTestId('scanner-typed-input'), { target: { value: 'SS-7K4M-29QX' } });
        fireEvent.click(screen.getByTestId('scanner-typed-submit'));
        expect(await screen.findByTestId('link-note')).toHaveTextContent('या कोडचं कार्ड सापडलं नाही');
    });
});

describe('WID fix pass 1 — a new card that cannot be given states the rule', () => {
    const tapNewCard = async () => {
        render(<WorkerCardSheet farmId={FARM} worker={worker} onClose={() => undefined} isNative={false} />);
        fireEvent.click(screen.getByTestId('card-reissue'));
        fireEvent.click(screen.getByTestId('card-reissue-confirm'));
        await waitFor(() => expect(mockReissue).toHaveBeenCalledTimes(1));
        return screen.findByTestId('card-note');
    };

    it('a मुकादम is told only the owner can issue a new card — not "try again"', async () => {
        mockReissue.mockRejectedValue({ response: { status: 409, data: { error: 'identity.owner_only' } } });
        const note = await tapNewCard();
        expect(note).toHaveTextContent('नवीन कार्ड फक्त शेताचे मालकच देऊ शकतात.');
        expect(note).not.toHaveTextContent('पुन्हा प्रयत्न करा');
    });

    it('a farm that does not hold his proof hears the rule, not which farm does', async () => {
        mockReissue.mockRejectedValue(refusal('identity.not_found'));
        const note = await tapNewCard();
        expect(note).toHaveTextContent('ज्या शेतावर याचं कार्ड बनलं किंवा फोन पडताळला, तेच शेत नवीन कार्ड देऊ शकतं.');
        expect(note).not.toHaveTextContent('पुन्हा प्रयत्न करा');
    });

    it('a second number that needs the move says so (H2), never "try again"', async () => {
        mockSendCode.mockRejectedValue({ response: { status: 409, data: { error: 'identity.use_move' } } });
        render(<WorkerCardSheet farmId={FARM} worker={worker} onClose={() => undefined} isNative={false} />);
        fireEvent.click(screen.getByTestId('card-verify'));
        const note = await screen.findByTestId('card-note');
        expect(note).toHaveTextContent('याचा एक नंबर आधीच पडताळलेला आहे');
        expect(note).not.toHaveTextContent('पुन्हा प्रयत्न करा');
    });
});

describe('WID fix pass 1 — "छापा" prints the card alone', () => {
    it('carries a print sheet that shows only the card, in its colours; the installed app has neither', () => {
        const { unmount } = render(<WorkerCardSheet farmId={FARM} worker={worker} onClose={() => undefined} isNative={false} />);
        const css = screen.getByTestId('card-print-style').textContent ?? '';
        expect(css).toContain('@media print');
        expect(css).toContain('body * { visibility: hidden !important; }');
        expect(css).toContain('#wid-print-card, #wid-print-card * { visibility: visible !important; }');
        expect(css).toContain('print-color-adjust: exact');
        expect(document.getElementById('wid-print-card')).not.toBeNull();
        unmount();
        render(<WorkerCardSheet farmId={FARM} worker={worker} onClose={() => undefined} isNative />);
        expect(screen.queryByTestId('card-print-style')).toBeNull();
        expect(screen.queryByTestId('card-print')).toBeNull();
    });
});

describe('WID fix pass 1 — the add-worker boxes', () => {
    it('the phone hint has no Latin "x" and the PIN hint is not a real 6-digit PIN', () => {
        render(<AddMemberWizard onAdd={vi.fn()} onAdded={vi.fn()} onCancel={() => undefined} onLinkByCard={vi.fn()} />);
        const phoneHint = screen.getByTestId('add-worker-phone').getAttribute('placeholder') ?? '';
        const pinHint = screen.getByTestId('add-worker-pin').getAttribute('placeholder') ?? '';
        expect(phoneHint).toBe('10 अंकी नंबर');
        expect(phoneHint).not.toMatch(/[A-Za-z]/);
        expect(pinHint).toBe('6 अंकी पिन');
        expect(pinHint).not.toMatch(/^\d{6}$/);
    });
});
