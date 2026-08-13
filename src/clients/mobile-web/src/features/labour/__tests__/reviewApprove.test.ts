// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * reviewApprove tests — Task 3.1 (Stage 3, spec:
 * 2026-07-13-labour-attendance-approval-design).
 *
 * Locks the तपासणी approve/query -> real `verify_log` wiring
 * (`ReviewSheet.sendVerification`):
 *   - A `Confirmed` item reaches "verified"/"disputed" in ONE `verify_log`
 *     mutation (Confirmed -> Verified/Disputed is a valid one-hop
 *     transition per `VerificationStateMachine`).
 *   - A `Draft` (or unknown/undefined) item needs TWO mutations, in
 *     order: 'confirmed' first, then the final status — the state machine
 *     forbids a one-hop Draft -> Verified/Disputed.
 *   - A `Verified` item disputing (शंका) also goes in one hop
 *     (Verified -> Disputed is valid; only Draft needs the extra step).
 *   - शंका always carries the (non-empty) reason `DailyLog.Verify` requires
 *     for a Disputed transition.
 *   - A rejected `enqueue()` propagates — the caller must not fabricate
 *     success on a failed mutation.
 *
 * Task 3.2 adds a second describe block below: the confirm-animation + 3s
 * undo-before-send wiring around `sendVerification` (ReviewSheet itself,
 * rendered with fake timers). The file is `.ts` (not `.tsx`) so component
 * rendering uses `React.createElement` rather than JSX. `@vitest-environment
 * jsdom` (default is `node` per vitest.config.ts) is required for both
 * blocks now that one of them renders a component — this does not change
 * behaviour for the Task 3.1 pure-function tests.
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

import ReviewSheet, { sendVerification } from '../components/ReviewSheet';
import { EMPTY_LABOUR_DATA } from '../labourMock';
import type { LabourData, ReviewItem } from '../labourMock';

describe('sendVerification — तपासणी approve/query drives real verify_log', () => {
    beforeEach(() => {
        mockEnqueue.mockReset();
        mockEnqueue.mockResolvedValue('client-request-id');
        mockTriggerNow.mockReset();
        mockTriggerNow.mockResolvedValue(undefined);
    });

    it('approving a Confirmed item enqueues exactly ONE verify_log mutation with verificationStatus "verified"', async () => {
        await sendVerification('r1', 'Confirmed', 'verified');

        expect(mockEnqueue).toHaveBeenCalledTimes(1);
        expect(mockEnqueue).toHaveBeenCalledWith({ dailyLogId: 'r1', verificationStatus: 'verified', reason: undefined });
    });

    it('approving a Draft item enqueues TWO mutations, in order: confirmed then verified', async () => {
        await sendVerification('r2', 'Draft', 'verified');

        expect(mockEnqueue).toHaveBeenCalledTimes(2);
        expect(mockEnqueue.mock.calls[0][0]).toEqual({ dailyLogId: 'r2', verificationStatus: 'confirmed' });
        expect(mockEnqueue.mock.calls[1][0]).toEqual({ dailyLogId: 'r2', verificationStatus: 'verified', reason: undefined });
    });

    it('an unknown/undefined status is treated the same as Draft — two-step', async () => {
        await sendVerification('r-unknown', undefined, 'verified');

        expect(mockEnqueue).toHaveBeenCalledTimes(2);
        expect(mockEnqueue.mock.calls[0][0]).toEqual({ dailyLogId: 'r-unknown', verificationStatus: 'confirmed' });
        expect(mockEnqueue.mock.calls[1][0]).toEqual({ dailyLogId: 'r-unknown', verificationStatus: 'verified', reason: undefined });
    });

    it('शंका on a Confirmed item sends ONE disputed mutation with the reason', async () => {
        await sendVerification('r3', 'Confirmed', 'disputed', 'मालकाने शंका घेतली आहे.');

        expect(mockEnqueue).toHaveBeenCalledTimes(1);
        expect(mockEnqueue).toHaveBeenCalledWith({
            dailyLogId: 'r3',
            verificationStatus: 'disputed',
            reason: 'मालकाने शंका घेतली आहे.',
        });
    });

    it('शंका on a Draft item enqueues confirmed THEN disputed, in order, with the reason on the final step', async () => {
        await sendVerification('r4', 'Draft', 'disputed', 'शंका आहे');

        expect(mockEnqueue).toHaveBeenCalledTimes(2);
        expect(mockEnqueue.mock.calls[0][0]).toEqual({ dailyLogId: 'r4', verificationStatus: 'confirmed' });
        expect(mockEnqueue.mock.calls[1][0]).toEqual({ dailyLogId: 'r4', verificationStatus: 'disputed', reason: 'शंका आहे' });
    });

    it('शंका on a Verified item also goes in one hop (Verified -> Disputed is valid)', async () => {
        await sendVerification('r5', 'Verified', 'disputed', 'शंका');

        expect(mockEnqueue).toHaveBeenCalledTimes(1);
        expect(mockEnqueue).toHaveBeenCalledWith({ dailyLogId: 'r5', verificationStatus: 'disputed', reason: 'शंका' });
    });

    it('triggers a best-effort sync push after enqueueing so the mutation reaches the server promptly', async () => {
        await sendVerification('r6', 'Confirmed', 'verified');

        expect(mockTriggerNow).toHaveBeenCalledTimes(1);
    });

    it('propagates a rejected enqueue() — never swallows a failed mutation as a fake success', async () => {
        mockEnqueue.mockRejectedValueOnce(new Error('Payload validation failed'));

        await expect(sendVerification('r7', 'Confirmed', 'verified')).rejects.toThrow('Payload validation failed');
    });

    it('stops after the first step if Draft->Confirmed rejects — never attempts the invalid one-hop transition', async () => {
        mockEnqueue.mockRejectedValueOnce(new Error('boom'));

        await expect(sendVerification('r8', 'Draft', 'verified')).rejects.toThrow('boom');
        expect(mockEnqueue).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// Task 3.2 — confirm animation + 3s undo-before-send (ReviewSheet itself)
// ---------------------------------------------------------------------------

function makeItem(id: string, status: ReviewItem['status'] = 'Confirmed'): ReviewItem {
    return { id, who: `who-${id}`, initial: 'र', tone: 'or', detail: `detail-${id}`, status, points: {} };
}

function dataWith(review: ReviewItem[]): LabourData {
    return { ...EMPTY_LABOUR_DATA, review };
}

// A little past CONFIRM_ANIM_MS (380ms) — puts the batch into the
// undo-bar-visible "pending" stage without yet elapsing the 3s window.
const PAST_ANIM_MS = 450;
// A little past UNDO_WINDOW_MS (3000ms) from the pending stage.
const PAST_UNDO_WINDOW_MS = 3100;

describe('ReviewSheet — confirm animation + 3s undo-before-send (Task 3.2)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mockEnqueue.mockReset();
        mockEnqueue.mockResolvedValue('client-request-id');
        mockTriggerNow.mockReset();
        mockTriggerNow.mockResolvedValue(undefined);
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it('undo tapped within the window enqueues ZERO mutations and restores the card', async () => {
        const onToast = vi.fn();
        render(React.createElement(ReviewSheet, {
            open: true, data: dataWith([makeItem('r1', 'Confirmed')]), onClose: vi.fn(), onToast,
        }));

        fireEvent.click(screen.getByTestId('review-approve-r1'));
        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_ANIM_MS); });

        // Card has collapsed out of the list; undo bar is up. Nothing sent yet.
        expect(screen.queryByTestId('review-card-r1')).toBeNull();
        expect(screen.getByTestId('review-undo-bar')).toBeInTheDocument();
        expect(mockEnqueue).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('review-undo-button'));

        // Let the window that WOULD have elapsed pass — undo must have
        // cancelled the timer, so nothing fires.
        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_UNDO_WINDOW_MS); });

        expect(mockEnqueue).not.toHaveBeenCalled();
        expect(mockTriggerNow).not.toHaveBeenCalled();
        expect(screen.getByTestId('review-card-r1')).toBeInTheDocument();
        expect(screen.queryByTestId('review-undo-bar')).toBeNull();
    });

    it('window elapses untouched -> enqueues the correct mutation(s) (Draft: confirmed then verified)', async () => {
        const onToast = vi.fn();
        render(React.createElement(ReviewSheet, {
            open: true, data: dataWith([makeItem('r2', 'Draft')]), onClose: vi.fn(), onToast,
        }));

        fireEvent.click(screen.getByTestId('review-approve-r2'));
        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_ANIM_MS); });
        expect(mockEnqueue).not.toHaveBeenCalled(); // still just sitting in the undo window

        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_UNDO_WINDOW_MS); });

        expect(mockEnqueue).toHaveBeenCalledTimes(2);
        expect(mockEnqueue.mock.calls[0][0]).toEqual({ dailyLogId: 'r2', verificationStatus: 'confirmed' });
        expect(mockEnqueue.mock.calls[1][0]).toEqual({ dailyLogId: 'r2', verificationStatus: 'verified', reason: undefined });
        expect(onToast).toHaveBeenCalledWith('मंजूर केलं — मी लिहून घेतलं ✓');
        expect(screen.queryByTestId('review-undo-bar')).toBeNull();
    });

    it('unmounting with a pending send FLUSHES it immediately — the mutation is still enqueued, not dropped', async () => {
        const onToast = vi.fn();
        const { unmount } = render(React.createElement(ReviewSheet, {
            open: true, data: dataWith([makeItem('r3', 'Confirmed')]), onClose: vi.fn(), onToast,
        }));

        fireEvent.click(screen.getByTestId('review-approve-r3'));
        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_ANIM_MS); }); // now inside the undo window, NOT elapsed

        expect(mockEnqueue).not.toHaveBeenCalled();

        unmount();
        // Flush the fire-and-forget send's microtasks (no more timers are
        // scheduled at this point — the flush already cleared the undo
        // timer and called finalizeBatch directly).
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });

        expect(mockEnqueue).toHaveBeenCalledTimes(1);
        expect(mockEnqueue).toHaveBeenCalledWith({ dailyLogId: 'r3', verificationStatus: 'verified', reason: undefined });
        expect(mockTriggerNow).toHaveBeenCalledTimes(1);
        // Guarded by mountedRef — no toast fires for a truly unmounted sheet.
        expect(onToast).not.toHaveBeenCalled();
    });

    it('सगळं मंजूर then undo cancels the WHOLE batch — zero mutations, every card restored', async () => {
        const onToast = vi.fn();
        render(React.createElement(ReviewSheet, {
            open: true, data: dataWith([makeItem('r4', 'Confirmed'), makeItem('r5', 'Confirmed')]), onClose: vi.fn(), onToast,
        }));

        fireEvent.click(screen.getByTestId('review-approve-all'));
        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_ANIM_MS); });

        expect(screen.queryByTestId('review-card-r4')).toBeNull();
        expect(screen.queryByTestId('review-card-r5')).toBeNull();
        expect(screen.getByTestId('review-undo-bar')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('review-undo-button'));
        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_UNDO_WINDOW_MS); });

        expect(mockEnqueue).not.toHaveBeenCalled();
        expect(screen.getByTestId('review-card-r4')).toBeInTheDocument();
        expect(screen.getByTestId('review-card-r5')).toBeInTheDocument();
    });

    it('closing the sheet (open -> false) while a send is pending also flushes it', async () => {
        const onToast = vi.fn();
        const { rerender } = render(React.createElement(ReviewSheet, {
            open: true, data: dataWith([makeItem('r6', 'Confirmed')]), onClose: vi.fn(), onToast,
        }));

        fireEvent.click(screen.getByTestId('review-approve-r6'));
        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_ANIM_MS); });
        expect(mockEnqueue).not.toHaveBeenCalled();

        await act(async () => {
            rerender(React.createElement(ReviewSheet, {
                open: false, data: dataWith([makeItem('r6', 'Confirmed')]), onClose: vi.fn(), onToast,
            }));
            await vi.advanceTimersByTimeAsync(0);
        });

        expect(mockEnqueue).toHaveBeenCalledTimes(1);
        expect(mockEnqueue).toHaveBeenCalledWith({ dailyLogId: 'r6', verificationStatus: 'verified', reason: undefined });
        // The component is still mounted (just visually closed) — toast IS expected.
        expect(onToast).toHaveBeenCalledWith('मंजूर केलं — मी लिहून घेतलं ✓');
    });
});

// ---------------------------------------------------------------------------
// Decision 4b (2026-07-19, screen honesty) — तपासणी wording, 14-day bound,
// bulk-approve single-sync-trigger, and badge-refresh (`onApproved`).
// ---------------------------------------------------------------------------

// `parseReviewDetailDate` (source) interprets a `detail` string as a LOCAL
// yyyy-MM-dd date (`new Date(detail + 'T00:00:00')`, no 'Z') — these tests
// must build fixture strings the same way, NOT via `toISOString()` (UTC),
// which can land on the wrong calendar day depending on the runner's TZ.
const toLocalIsoDate = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

describe('ReviewSheet — screen honesty (Decision 4b)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mockEnqueue.mockReset();
        mockEnqueue.mockResolvedValue('client-request-id');
        mockTriggerNow.mockReset();
        mockTriggerNow.mockResolvedValue(undefined);
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it('never claims the queue is "टीमच्या" (your team\'s) entries — the owner\'s own logs can be in it too', () => {
        render(React.createElement(ReviewSheet, {
            open: true, data: dataWith([makeItem('t1', 'Confirmed'), makeItem('t2', 'Confirmed')]), onClose: vi.fn(), onToast: vi.fn(),
        }));

        expect(screen.getByText('2 नोंदी — मंजूर करा')).toBeInTheDocument();
        expect(screen.queryByText(/टीमच्या/)).toBeNull();
    });

    it('bounds the queue to the last 14 days — an older item (a real backend ISO-date detail) never appears', () => {
        const today = new Date();
        const recentIso = toLocalIsoDate(today);
        const oldDate = new Date(today.getTime() - 30 * 86_400_000);
        const oldIso = toLocalIsoDate(oldDate);

        const recent: ReviewItem = { id: 'recent-1', who: 'रमेश', initial: 'र', tone: 'or', detail: recentIso, status: 'Confirmed', points: {} };
        const old: ReviewItem = { id: 'old-1', who: 'सुनीता', initial: 'सु', tone: 'em', detail: oldIso, status: 'Confirmed', points: {} };

        render(React.createElement(ReviewSheet, {
            open: true, data: dataWith([recent, old]), onClose: vi.fn(), onToast: vi.fn(),
        }));

        expect(screen.getByTestId('review-card-recent-1')).toBeInTheDocument();
        expect(screen.queryByTestId('review-card-old-1')).toBeNull();
        // The header count reflects the BOUNDED list, not the raw total (would say "2" if unbounded).
        expect(screen.getByText('1 नोंदी — मंजूर करा')).toBeInTheDocument();
    });

    it('reformats a real backend ISO-date detail (आज) instead of leaking the raw yyyy-MM-dd string', () => {
        const todayIso = toLocalIsoDate(new Date());
        const item: ReviewItem = { id: 'd1', who: 'रमेश', initial: 'र', tone: 'or', detail: todayIso, status: 'Confirmed', points: {} };

        render(React.createElement(ReviewSheet, {
            open: true, data: dataWith([item]), onClose: vi.fn(), onToast: vi.fn(),
        }));

        expect(screen.getByText('आज')).toBeInTheDocument();
        expect(screen.queryByText(todayIso)).toBeNull();
    });

    it('सगळं मंजूर on 3 items triggers sync ONCE for the whole batch, not once per item', async () => {
        const onToast = vi.fn();
        render(React.createElement(ReviewSheet, {
            open: true,
            data: dataWith([makeItem('b1', 'Confirmed'), makeItem('b2', 'Confirmed'), makeItem('b3', 'Confirmed')]),
            onClose: vi.fn(), onToast,
        }));

        fireEvent.click(screen.getByTestId('review-approve-all'));
        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_ANIM_MS); });
        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_UNDO_WINDOW_MS); });

        expect(mockEnqueue).toHaveBeenCalledTimes(3); // one per item (each Confirmed -> one-hop)
        expect(mockTriggerNow).toHaveBeenCalledTimes(1); // NOT 3 — the actual fix
        expect(onToast).toHaveBeenCalledWith('सगळं मंजूर केलं — मी लिहून घेतलं ✓');
    });

    it('calls onApproved after a successful single approve, so the caller can refresh the stale "तपासा N" badge', async () => {
        const onApproved = vi.fn();
        render(React.createElement(ReviewSheet, {
            open: true, data: dataWith([makeItem('a1', 'Confirmed')]), onClose: vi.fn(), onToast: vi.fn(), onApproved,
        }));

        fireEvent.click(screen.getByTestId('review-approve-a1'));
        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_ANIM_MS); });
        expect(onApproved).not.toHaveBeenCalled(); // still inside the undo window — nothing sent yet

        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_UNDO_WINDOW_MS); });
        expect(onApproved).toHaveBeenCalledTimes(1);
    });

    it('calls onApproved after a bulk सगळं मंजूर batch completes', async () => {
        const onApproved = vi.fn();
        render(React.createElement(ReviewSheet, {
            open: true,
            data: dataWith([makeItem('c1', 'Confirmed'), makeItem('c2', 'Confirmed')]),
            onClose: vi.fn(), onToast: vi.fn(), onApproved,
        }));

        fireEvent.click(screen.getByTestId('review-approve-all'));
        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_ANIM_MS); });
        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_UNDO_WINDOW_MS); });

        expect(onApproved).toHaveBeenCalledTimes(1);
    });

    it('does NOT call onApproved when every item in the batch fails to send', async () => {
        mockEnqueue.mockRejectedValue(new Error('boom'));
        const onApproved = vi.fn();
        render(React.createElement(ReviewSheet, {
            open: true, data: dataWith([makeItem('f1', 'Confirmed')]), onClose: vi.fn(), onToast: vi.fn(), onApproved,
        }));

        fireEvent.click(screen.getByTestId('review-approve-f1'));
        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_ANIM_MS); });
        await act(async () => { await vi.advanceTimersByTimeAsync(PAST_UNDO_WINDOW_MS); });

        expect(onApproved).not.toHaveBeenCalled();
    });
});
