// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID fix pass 3 add-on (P5). A code whose five tries are
 * spent says "this code can no longer be used — ask for a new one", because a fresh code works today. Only the daily
 * cap (per person or per farm) keeps "too many wrong codes today — try again tomorrow". Both answers, both languages.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const lang = vi.hoisted(() => ({ value: 'mr' as string }));
vi.mock('../../../../i18n/LanguageContext', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useOptionalLanguage: () => ({ language: lang.value }),
}));

const mockSendCode = vi.fn();
const mockVerify = vi.fn();
const mockResolve = vi.fn();
const mockLink = vi.fn();
vi.mock('../../data/workerIdentityClient', () => ({
    resolveCard: (...a: unknown[]) => mockResolve(...a),
    startLink: vi.fn(),
    linkWorker: (...a: unknown[]) => mockLink(...a),
    sendWorkerCode: (...a: unknown[]) => mockSendCode(...a),
    verifyWorkerCode: (...a: unknown[]) => mockVerify(...a),
    reissueCard: vi.fn(),
    identityErrorCode: (error: unknown) => {
        const data = (error as { response?: { data?: { error?: unknown } } } | null)?.response?.data;
        return typeof data?.error === 'string' ? data.error : null;
    },
}));
vi.mock('../cardPicture', () => ({ renderCardPicture: vi.fn() }));

import { WorkerCardSheet } from '../WorkerCardSheet';
import { LinkByCardSheet } from '../LinkByCardSheet';

const FARM = 'aaaaaaaa-0000-4000-8000-00000000000a';
const refusal = (error: string) => ({ response: { status: 409, data: { error } } });
const worker = { id: 'w-ramesh', displayName: 'रमेश पाटील', isActive: true, cardCode: 'SS-7K4M-29QX', identityLevel: 'Card', needsPhoneAndPin: false };

const USED_UP = {
    mr: 'हा कोड आता चालणार नाही. नवीन कोड मागवा.',
    en: 'This code can no longer be used. Ask for a new code.',
};
const TOMORROW = {
    mr: 'आज खूप चुकीचे कोड टाकले गेले — उद्या पुन्हा करा.',
    en: 'Too many wrong codes today — try again tomorrow.',
};

beforeEach(() => {
    vi.clearAllMocks();
    lang.value = 'mr';
});
afterEach(() => cleanup());

async function verifyAndRefuse(error: string) {
    mockSendCode.mockResolvedValue({ ticket: 't-1', phoneTail: '0101' });
    mockVerify.mockRejectedValue(refusal(error));
    render(<WorkerCardSheet farmId={FARM} worker={worker} onClose={() => undefined} isNative={false} />);
    fireEvent.click(screen.getByTestId('card-verify'));
    fireEvent.change(await screen.findByTestId('card-code-input'), { target: { value: '1234' } });
    fireEvent.click(screen.getByTestId('card-code-submit'));
    await waitFor(() => expect(mockVerify).toHaveBeenCalledTimes(1));
    return screen.findByTestId('card-note');
}

describe.each(['mr', 'en'] as const)('WID fix pass 3 add-on — the two "no more tries" answers (%s)', (language) => {
    it('a code used up by its five tries asks for a new code, never "tomorrow"', async () => {
        lang.value = language;
        const note = await verifyAndRefuse('identity.code_used_up');
        expect(note).toHaveTextContent(USED_UP[language]);
        expect(note).not.toHaveTextContent(TOMORROW[language]);
    });

    it('only the daily cap says "too many wrong codes today — try again tomorrow"', async () => {
        lang.value = language;
        const note = await verifyAndRefuse('identity.too_many_tries');
        expect(note).toHaveTextContent(TOMORROW[language]);
        expect(note).not.toHaveTextContent(USED_UP[language]);
    });

    it('the link sheet says the same for a used-up link code', async () => {
        lang.value = language;
        mockResolve.mockResolvedValue({ status: 'Active', displayName: 'रमेश पाटील', level: 'Card' });
        mockLink.mockRejectedValue(refusal('identity.code_used_up'));
        render(<LinkByCardSheet farmId={FARM} onLinked={() => undefined} onCancel={() => undefined} />);
        fireEvent.change(screen.getByTestId('scanner-typed-input'), { target: { value: 'SS-7K4M-29QX' } });
        fireEvent.click(screen.getByTestId('scanner-typed-submit'));
        fireEvent.click(await screen.findByTestId('link-confirm'));
        expect(await screen.findByTestId('link-note')).toHaveTextContent(USED_UP[language]);
    });
});
