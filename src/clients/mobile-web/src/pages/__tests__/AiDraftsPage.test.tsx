// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: 2026-08-14-founder-decisions-launch-cohort-and-scope — fix rounds 1-4; plr-d10 (I17); lane OF (founder D-59).
 *
 * "नेट नसताना केलेल्या नोंदी" after lane OF: VOICE recordings no longer live here (they wait in सेट-अप केंद्र › आवाज
 * नोंदी and open "तपासा आणि जतन करा" — never the old hand-filled form this page used to open). What stays is the bill /
 * sale-slip photos made without internet. The honesty rules the earlier rounds pinned on this page carry over:
 *   - a photo cannot be opened here yet: the row says so plainly and that it is kept (no dead "open" button);
 *   - a removal is his explicit decision, with the right noun and gender, and only a "yes" marks it reviewed;
 *   - the row's time comes from the SAME instant the rest of the app dates the note from (`resolveRecordedInstant`);
 *   - one title bar named like the hub row, one मागे; plain Marathi only.
 * And the new rule: nothing of the old form is reachable from here.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import type { UnreviewedAiResult } from '../../infrastructure/sync/PendingAiResultsReader';

const mockListUnreviewedAiResults = vi.fn();
const mockMarkAiResultReviewed = vi.fn();
const mockResolveRecordedInstant = vi.fn((..._args: unknown[]) => '2026-08-13T15:00:00.000Z');

vi.mock('../../infrastructure/sync/PendingAiResultsReader', () => ({
    listUnreviewedAiResults: (...args: unknown[]) => mockListUnreviewedAiResults(...args),
    markAiResultReviewed: (...args: unknown[]) => mockMarkAiResultReviewed(...args),
    resolveRecordedInstant: (...args: unknown[]) => mockResolveRecordedInstant(...args),
}));
const manualEntryMounted = vi.fn();
vi.mock('../../features/logs/components/ManualEntry', () => ({ default: () => { manualEntryMounted(); return null; } }));

import AiDraftsPage from '../AiDraftsPage';

const job = (id: number, operationType: string): UnreviewedAiResult => ({
    id,
    operationType,
    context: { farmId: 'farm-1', userId: 'user-1', operation: operationType === 'voice_parse' ? 'voice' : 'receipt', plotId: 'plot-a' },
    status: 'completed',
    createdAt: '2026-08-14T18:30:00.000Z',
    updatedAt: '2026-08-14T18:31:00.000Z',
    retryCount: 0,
    result: { operationType, receivedAtUtc: '2026-08-14T19:00:00.000Z', payload: {} },
} as unknown as UnreviewedAiResult);

const VOICE = job(7, 'voice_parse');
const BILL = job(9, 'receipt_extract');
const SLIP = job(11, 'patti_extract');

beforeEach(() => {
    vi.clearAllMocks();
    mockListUnreviewedAiResults.mockResolvedValue([VOICE, BILL, SLIP]);
    mockMarkAiResultReviewed.mockResolvedValue(undefined);
});

afterEach(() => {
    cleanup();
});

describe('AiDraftsPage — lane OF (D-59): bill / slip photos only; voice lives in आवाज नोंदी', () => {
    it('lists the bill and the slip photo, never the voice recording, and nothing opens the old form', async () => {
        render(<AiDraftsPage onBack={vi.fn()} />);
        expect(await screen.findByTestId('ai-draft-row-9')).toBeInTheDocument();
        expect(screen.getByTestId('ai-draft-row-11')).toBeInTheDocument();
        expect(screen.queryByTestId('ai-draft-row-7')).toBeNull();
        expect(screen.getByTestId('ai-drafts-list')).toHaveTextContent('बिलाचा फोटो');
        expect(screen.getByTestId('ai-drafts-list')).toHaveTextContent('पट्टीचा फोटो');
        expect(screen.getByTestId('ai-drafts-list')).not.toHaveTextContent('आवाज नोंद');
        expect(screen.queryByRole('button', { name: 'उघडा' })).toBeNull();
        expect(manualEntryMounted).not.toHaveBeenCalled();
    });

    it('only voice waiting: the page says nothing of photos is left (the voice is counted in आवाज नोंदी)', async () => {
        mockListUnreviewedAiResults.mockResolvedValue([VOICE]);
        render(<AiDraftsPage onBack={vi.fn()} />);
        expect(await screen.findByTestId('ai-drafts-empty')).toBeInTheDocument();
    });
});

describe('AiDraftsPage — a photo row (IMPORTANT 2)', () => {
    it('says plainly it cannot be opened here yet, and that it is kept', async () => {
        render(<AiDraftsPage onBack={vi.fn()} />);
        expect(await screen.findByTestId('ai-draft-not-openable-9')).toHaveTextContent(
            'हा फोटो इथे अजून उघडता येत नाही. काढून टाका, किंवा इथेच राहू द्या.',
        );
    });

    it('a removal asks with the right noun ("this bill photo", masculine); a "no" marks nothing', async () => {
        mockListUnreviewedAiResults.mockResolvedValue([BILL]);
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
        render(<AiDraftsPage onBack={vi.fn()} />);
        fireEvent.click(await screen.findByTitle('काढून टाका'));
        expect(confirmSpy.mock.calls[0][0]).toBe('हा बिलाचा फोटो काढून टाकायचा? तो शेतनोंदीत जाणार नाही.');
        expect(mockMarkAiResultReviewed).not.toHaveBeenCalled();
        confirmSpy.mockRestore();
    });

    it('a "yes" marks it reviewed and the list is read again', async () => {
        mockListUnreviewedAiResults.mockResolvedValueOnce([BILL]).mockResolvedValueOnce([]);
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        render(<AiDraftsPage onBack={vi.fn()} />);
        fireEvent.click(await screen.findByTitle('काढून टाका'));
        await waitFor(() => expect(mockMarkAiResultReviewed).toHaveBeenCalledWith(9));
        expect(await screen.findByTestId('ai-drafts-empty')).toBeInTheDocument();
        confirmSpy.mockRestore();
    });

    it('formats the row from resolveRecordedInstant, not job.result.receivedAtUtc directly (round 3)', async () => {
        mockListUnreviewedAiResults.mockResolvedValue([BILL]);
        render(<AiDraftsPage onBack={vi.fn()} />);
        await screen.findByTestId('ai-draft-row-9');
        expect(mockResolveRecordedInstant).toHaveBeenCalledWith(BILL);
        // 15:00 UTC is 20:30 IST: रात्री, on the 13th — never the drain day (14th) or English.
        expect(screen.getByText('13 ऑग, रात्री 8:30')).toBeInTheDocument();
        expect(screen.queryByText(/14 ऑग|Aug|AM|PM/)).not.toBeInTheDocument();
    });
});

describe('AiDraftsPage — one title bar with मागे, plain Marathi', () => {
    it('the list is titled like the hub row, and मागे goes back', async () => {
        const onBack = vi.fn();
        render(<AiDraftsPage onBack={onBack} />);
        await screen.findByTestId('ai-draft-row-9');
        expect(screen.getByTestId('page-title')).toHaveTextContent('नेट नसताना केलेल्या नोंदी');
        expect(screen.getAllByTestId('page-back')).toHaveLength(1);
        fireEvent.click(screen.getByTestId('page-back'));
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('the whole list page is plain Marathi: no English word a farmer would see, never "AI" or "draft"', async () => {
        render(<AiDraftsPage onBack={vi.fn()} />);
        await screen.findByTestId('ai-draft-row-9');
        const page = screen.getByTestId('ai-drafts-list');
        expect(page.textContent ?? '').not.toMatch(/[A-Za-z]/);
        for (const el of Array.from(page.querySelectorAll('[title],[aria-label]'))) {
            expect(`${el.getAttribute('title') ?? ''}${el.getAttribute('aria-label') ?? ''}`).not.toMatch(/[A-Za-z]/);
        }
        expect(page.textContent ?? '').not.toMatch(/ड्राफ्ट/);
    });

    it('nothing waiting: says so in Marathi', async () => {
        mockListUnreviewedAiResults.mockResolvedValue([]);
        render(<AiDraftsPage onBack={vi.fn()} />);
        const empty = await screen.findByTestId('ai-drafts-empty');
        expect(empty).toHaveTextContent('सगळ्या नोंदी पाहून झाल्या');
        expect(empty).toHaveTextContent('नेट नसताना केलेली एकही नोंद बाकी नाही.');
    });
});
