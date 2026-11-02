// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 1, item 11 (founder D-71, 2026-11-02).
//
// An erasure request waits 30 days and can be cancelled until then. The screen says so, in Marathi and in English,
// before he asks; the answer names the day erasure starts (the server's date); his waiting request is listed with that
// date and "विनंती रद्द करा"; a cancel goes to the server and the screen says what the server answered.

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../infrastructure/api/apiFetch', () => ({ apiFetch: vi.fn() }));

import { apiFetch } from '../../../infrastructure/api/apiFetch';
import { formatDataRightsDate, tDataRights } from '../../../i18n/dataRightsTranslations';
import ErasureRequestScreen from '../ErasureRequestScreen';

const fetchMock = apiFetch as unknown as ReturnType<typeof vi.fn>;
const STARTS = '2026-12-02T10:00:00Z';
const waiting = (id: string, extra: Record<string, unknown> = {}) => ({
    requestId: id, status: 'Requested', requestedAtUtc: '2026-11-02T10:00:00Z', erasureStartsAtUtc: STARTS,
    endedAtUtc: null, mayCancel: true, askedByMe: true, ...extra,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

let list: unknown[];
let cancelStatus: number;

beforeEach(() => {
    list = [];
    cancelStatus = 200;
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
        if (path === '/shramsafal/me/erasure/requests') return json(list);
        if (path === '/shramsafal/me/erasure/request') {
            list = [waiting('r-new')];
            return json({ requestId: 'r-new', requestedAtUtc: '2026-11-02T10:00:00Z', erasureStartsAtUtc: STARTS, status: 'Requested' }, 202);
        }
        if (path.endsWith('/cancel') && init?.method === 'POST') {
            if (cancelStatus === 200) list = [waiting('r-1', { status: 'Cancelled', mayCancel: false, endedAtUtc: '2026-11-03T10:00:00Z' })];
            return json(cancelStatus === 200 ? { requestId: 'r-1', status: 'Cancelled' } : { error: 'ShramSafal.ErasureRequest.AlreadyStarted' }, cancelStatus);
        }
        return json({}, 404);
    });
});
afterEach(() => cleanup());

describe('the screen says the 30 days and the cancel before he asks', () => {
    it.each([
        ['mr-IN', 'विनंती केल्यानंतर ३० दिवस काहीही मिटवले जात नाही. या ३० दिवसांत तुम्ही विनंती रद्द करू शकता. ३० दिवसांनंतरच मिटवणे सुरू होते.'],
        ['en-IN', 'After you ask, nothing is erased for 30 days. You can cancel the request during those 30 days. Erasure starts only after 30 days.'],
    ] as const)('%s', async (locale, words) => {
        render(<ErasureRequestScreen forceLocale={locale} />);
        expect(screen.getByTestId('erasure-wait-note')).toHaveTextContent(words);
        fireEvent.click(screen.getByTestId('erasure-open-confirm'));
        expect(screen.getByTestId('erasure-confirm-dialog')).toHaveTextContent(locale === 'mr-IN' ? '३० दिवसांनी मिटवणे सुरू होईल' : 'Erasure starts 30 days after your request');
    });

    it('no word on the screen is the AI word or an emoji, in either language', () => {
        for (const locale of ['mr-IN', 'en-IN'] as const) {
            for (const key of ['erasure.wait', 'erasure.slaWithDate', 'recent.statusWaiting', 'recent.statusCancelled', 'recent.cancelAction',
                'recent.cancelDone', 'recent.cancelStarted', 'recent.cancelError', 'recent.loadError', 'recent.kindErasure']) {
                const words = tDataRights(locale, key);
                expect(words).not.toBe(key);
                expect(words).not.toMatch(/\bAI\b|एआय/);
                expect(words).not.toMatch(/\p{Extended_Pictographic}/u);
            }
        }
    });
});

describe('after he asks: the day erasure starts, and his waiting request with a cancel', () => {
    it('names the server\'s date and lists the request as waiting, with "विनंती रद्द करा"', async () => {
        render(<ErasureRequestScreen forceLocale="mr-IN" />);
        fireEvent.click(screen.getByTestId('erasure-open-confirm'));
        fireEvent.click(screen.getByTestId('erasure-confirm-submit'));

        const day = formatDataRightsDate('mr-IN', STARTS);
        expect(day).not.toBe('');
        expect(await screen.findByTestId('erasure-success-sla')).toHaveTextContent(`${day} रोजी मिटवणे सुरू होईल`);
        expect(await screen.findByTestId('recent-request-status-r-new')).toHaveTextContent(`थांबलेली — ${day} रोजी मिटवणे सुरू होईल`);
        expect(screen.getByTestId('recent-request-r-new')).toHaveTextContent('माहिती मिटवणे');
        expect(screen.getByTestId('recent-request-cancel-r-new')).toHaveTextContent('विनंती रद्द करा');
    });
});

describe('the cancel action', () => {
    it('cancels on the server, says nothing was erased, and the request then reads as cancelled', async () => {
        list = [waiting('r-1')];
        render(<ErasureRequestScreen forceLocale="mr-IN" />);
        fireEvent.click(await screen.findByTestId('recent-request-cancel-r-1'));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/shramsafal/me/erasure/r-1/cancel', expect.objectContaining({ method: 'POST' })));
        expect(await screen.findByTestId('erasure-notice-cancelDone')).toHaveTextContent('विनंती रद्द केली. काहीही मिटवले नाही.');
        await waitFor(() => expect(screen.getByTestId('recent-request-status-r-1')).toHaveTextContent('रद्द केली — काहीही मिटवले नाही'));
        expect(screen.queryByTestId('recent-request-cancel-r-1')).toBeNull();
    });

    it('after it has started the server refuses (409), and the screen says it has started, not that it failed', async () => {
        list = [waiting('r-1')];
        cancelStatus = 409;
        render(<ErasureRequestScreen forceLocale="en-IN" />);
        fireEvent.click(await screen.findByTestId('recent-request-cancel-r-1'));
        expect(await screen.findByTestId('erasure-notice-cancelStarted'))
            .toHaveTextContent('Erasure has already started, so it can no longer be cancelled.');
    });

    it('no cancel action where the server says he may not cancel (asked on his behalf, or no longer waiting)', async () => {
        list = [waiting('r-2', { mayCancel: false, askedByMe: false }), waiting('r-3', { status: 'InProgress', mayCancel: false })];
        render(<ErasureRequestScreen forceLocale="en-IN" />);
        expect(await screen.findByTestId('recent-request-r-2')).toHaveTextContent('Asked on your behalf by ShramSafal');
        expect(screen.queryByTestId('recent-request-cancel-r-2')).toBeNull();
        expect(screen.getByTestId('recent-request-status-r-3')).toHaveTextContent('In progress');
        expect(screen.queryByTestId('recent-request-cancel-r-3')).toBeNull();
    });
});
