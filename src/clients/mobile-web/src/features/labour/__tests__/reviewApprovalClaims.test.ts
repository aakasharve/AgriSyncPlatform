// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Phase 2 -> Phase 1 (honesty backstop), Task T4 — done-condition 4.
 *
 * `reviewApprove.test.ts` locks the undo WINDOW: what is enqueued, when, and
 * what `पूर्ववत करा` cancels. This file locks what the screen is allowed to SAY
 * at the moment that window closes — a different property, and one that had no
 * test at all. Kept separate on purpose, so a wording change can never be
 * mistaken for a change to the undo behaviour, or vice versa.
 *
 * The path under test enqueues locally and fires a best-effort sync trigger
 * whose result is deliberately discarded (`triggerSyncBestEffort` catches and
 * returns). Both are mocked here, so there is no server in this file at all.
 * Every string the farmer sees on this path has to survive that.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

const mockEnqueue = vi.fn();
vi.mock('../../../application/usecases/sync/VerifyLogCommand', () => ({
    VerifyLogCommand: { enqueue: (...args: unknown[]) => mockEnqueue(...args) },
}));

const mockTriggerNow = vi.fn();
vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: (...args: unknown[]) => mockTriggerNow(...args) },
}));

import ReviewSheet from '../components/ReviewSheet';
import { EMPTY_LABOUR_DATA } from '../labourMock';
import type { LabourData, ReviewItem } from '../labourMock';
import { t as translate } from '../../../i18n/translations';
import { SYNC_HONESTY_I18N_KEYS } from '../../sync/status/syncHonestyState';

const PAST_ANIM_MS = 450;
const PAST_UNDO_WINDOW_MS = 3100;

/** The app's ONLY phrase for "the server has this" — `पाठवलं ✓`. */
const SERVER_HAS_IT = translate(SYNC_HONESTY_I18N_KEYS.ON_SERVER, 'mr');
/** The app's phrase for "this is on the handset" — `फोनवर सेव्ह ✓`. */
const ON_THE_PHONE = translate(SYNC_HONESTY_I18N_KEYS.ON_PHONE, 'mr');

function makeItem(id: string, status: ReviewItem['status'] = 'Confirmed'): ReviewItem {
    return { id, who: `who-${id}`, initial: 'र', tone: 'or', detail: `detail-${id}`, status, points: {} };
}

function dataWith(review: ReviewItem[]): LabourData {
    return { ...EMPTY_LABOUR_DATA, review };
}

describe('T4 — the approval screen claims only what a local enqueue can evidence', () => {
    let onToast: ReturnType<typeof vi.fn<(m: string) => void>>;

    beforeEach(() => {
        vi.useFakeTimers();
        mockEnqueue.mockReset();
        mockEnqueue.mockResolvedValue('client-request-id');
        mockTriggerNow.mockReset();
        mockTriggerNow.mockResolvedValue(undefined);
        onToast = vi.fn<(m: string) => void>();
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    const mount = (items: ReviewItem[]) =>
        render(React.createElement(ReviewSheet, {
            open: true, data: dataWith(items), onClose: vi.fn(), onToast,
        }));

    const runToCompletion = async (testId: string) => {
        fireEvent.click(screen.getByTestId(testId));
        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_ANIM_MS); });
        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_UNDO_WINDOW_MS); });
    };

    const everyToast = (): string => onToast.mock.calls.map((c) => String(c[0])).join('\n');

    it('never says the attendance is settled — nothing has settled anything', async () => {
        mount([makeItem('s1', 'Confirmed')]);

        await runToCompletion('review-approve-s1');

        // The specific claim: `हजेरीही निश्चित` = "attendance is settled too".
        // It fired after a local enqueue and a fire-and-forget push whose answer
        // is discarded, on a device that may be in a field with no signal.
        expect(everyToast()).not.toContain('निश्चित');
    });

    it('never borrows the phrase the app reserves for a real server acknowledgement', async () => {
        mount([makeItem('s2', 'Confirmed')]);

        await runToCompletion('review-approve-s2');

        // `पाठवलं ✓` is produced ONLY by `deriveSyncHonestyState` returning
        // ON_SERVER, which requires `acknowledgedCount > 0`. This path has no
        // acknowledgement of any kind, so the phrase must not appear here — and
        // what IS true, that the mutation is on the phone, is said instead.
        expect(everyToast()).not.toContain(SERVER_HAS_IT);
        expect(everyToast()).toContain(ON_THE_PHONE);
    });

    it('one action reads the same on the overlay, the undo bar and the toast', async () => {
        mount([makeItem('s3', 'Confirmed')]);

        fireEvent.click(screen.getByTestId('review-approve-s3'));

        // Surface 1 — the confirm overlay, during the animation.
        expect(screen.getByText('मंजूर केलं')).toBeInTheDocument();

        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_ANIM_MS); });

        // Surface 2 — the undo bar, during the window.
        expect(screen.getByTestId('review-undo-bar')).toHaveTextContent('मंजूर केलं');

        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_UNDO_WINDOW_MS); });

        // Surface 3 — the toast, after the send. One action, one tense.
        expect(everyToast()).toContain('मंजूर केलं');
    });

    it('शंका is reported in the tense it is actually in, not as an instruction', async () => {
        mount([makeItem('s4', 'Confirmed')]);

        await runToCompletion('review-query-s4');

        expect(everyToast()).toContain('शंका नोंदवली');
        // The imperative `शंका नोंदवा` ("raise a doubt") used as a confirmation.
        // It told the farmer to do the thing they had just done, while the
        // overlay beside it used the past tense for the same tap.
        expect(everyToast()).not.toContain('शंका नोंदवा —');
    });

    it('bulk approval makes no bigger claim than a single one', async () => {
        mount([makeItem('s5', 'Confirmed'), makeItem('s6', 'Confirmed')]);

        await runToCompletion('review-approve-all');

        expect(everyToast()).not.toContain('निश्चित');
        expect(everyToast()).not.toContain(SERVER_HAS_IT);
        expect(everyToast()).toContain('सगळं मंजूर केलं');
    });

    it('the toast is not the overlay repeated — the farmer can tell the window has closed', async () => {
        // If the two were byte-identical the farmer would see the same words
        // twice and have no signal that the undo window had elapsed and the
        // record had actually gone. That is what the second half is for.
        mount([makeItem('s7', 'Confirmed')]);

        await runToCompletion('review-approve-s7');

        expect(onToast).toHaveBeenCalled();
        expect(String(onToast.mock.calls.at(-1)?.[0])).not.toBe('मंजूर केलं');
    });

    it('a failure names a remedy that exists, and claims nothing at all', async () => {
        mockEnqueue.mockRejectedValue(new Error('boom'));
        mount([makeItem('s8', 'Confirmed')]);

        await runToCompletion('review-approve-s8');

        expect(everyToast()).toContain('पुन्हा प्रयत्न करा');
        // Nothing reached the phone's queue either, so neither phrase applies.
        expect(everyToast()).not.toContain(ON_THE_PHONE);
        expect(everyToast()).not.toContain(SERVER_HAS_IT);
    });

    it('says nothing whatsoever while the undo window is still open', async () => {
        // The strongest form of "claims only what it can evidence": before the
        // window elapses there is no enqueue, so there must be no toast.
        mount([makeItem('s9', 'Confirmed')]);

        fireEvent.click(screen.getByTestId('review-approve-s9'));
        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_ANIM_MS); });

        expect(mockEnqueue).not.toHaveBeenCalled();
        expect(onToast).not.toHaveBeenCalled();
    });
});
