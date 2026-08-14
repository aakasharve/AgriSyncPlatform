// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useDfesQuestion — onAnswered notification (Task 4, spec:
 * dfes-farmer-facing-deploy-readiness-2026-08-14). Task 3 made the server
 * recompute the day's score when a question event is recorded; the client
 * must now notice so the farmer sees the number move before he looks away
 * (founder ruling A). This covers the HOOK's half of that wiring: an
 * `onAnswered` callback fires exactly once after `recordQuestionEvent`
 * resolves, and NEVER on a failed write — a failed write must never move the
 * number the farmer is looking at.
 *
 * Signature note: the brief's illustrative snippet calls
 * `useDfesQuestion({ farmId, plotId, onAnswered })` and `result.current.answer(...)`.
 * The REAL hook is positional — `useDfesQuestion(farmId, plotId, inputs, enabled, onAnswered)`
 * — and the answer method is `recordOutcome`, not `answer`. Adapted accordingly
 * (architect-verified, see task-4-brief.md).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../../services/dfesQuestionApi', () => ({
    fetchRecentQuestionEvents: vi.fn(async () => []),
    recordQuestionEvent: vi.fn(async () => ({ id: 'e1' })),
}));

import { useDfesQuestion } from '../useDfesQuestion';
import { recordQuestionEvent } from '../../services/dfesQuestionApi';
import type { DailyQuestionInputs } from '../../services/dfesQuestionEngine';

// Same fixture useDfesQuestion.test.tsx uses — a DOSE gap so selectDailyQuestion
// actually picks a question (recordOutcome no-ops while `selected` is null).
const inputs = (): Omit<DailyQuestionInputs, 'recentEvents'> => ({
    crop: 'grapes', todayLocalDate: '2026-07-11',
    score: { score: 40, outcome: 'SCORED',
        dimensions: [{ dimension: 'DOSE', applicable: true, weight: 20, coverage: 0, confidenceFactor: 1, contribution: 0 }] },
    engagement: { totalRichDays: 0, unlockStatus: 'locked' },
});

describe('useDfesQuestion — onAnswered (Task 4)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('notifies the caller after the answer is recorded, so the score can refetch', async () => {
        const onAnswered = vi.fn();
        const { result } = renderHook(() => useDfesQuestion('farm-1', null, inputs(), true, onAnswered));
        await waitFor(() => expect(result.current.selected).not.toBeNull());

        await act(async () => { await result.current.recordOutcome({ skipped: false, response: 'low' }); });

        expect(recordQuestionEvent).toHaveBeenCalled();
        expect(onAnswered).toHaveBeenCalledTimes(1);
    });

    it('does not notify when recording fails, so the number never moves on a failed write', async () => {
        vi.mocked(recordQuestionEvent).mockRejectedValueOnce(new Error('offline'));
        const onAnswered = vi.fn();
        const { result } = renderHook(() => useDfesQuestion('farm-1', null, inputs(), true, onAnswered));
        await waitFor(() => expect(result.current.selected).not.toBeNull());

        await act(async () => { await result.current.recordOutcome({ skipped: false, response: 'low' }); });

        expect(onAnswered).not.toHaveBeenCalled();
    });

    it('works with onAnswered omitted (backward compatible — no crash on a bare recordOutcome call)', async () => {
        const { result } = renderHook(() => useDfesQuestion('farm-1', null, inputs(), true));
        await waitFor(() => expect(result.current.selected).not.toBeNull());

        await act(async () => { await result.current.recordOutcome({ skipped: true }); });

        // Review round 1, item 2: "resolves.not.toThrow()" alone can't fail —
        // the hook's own try/catch swallows everything, including a THROW
        // from a bug in this call itself, and it also passes vacuously if
        // recordOutcome silently early-returns and does nothing. Assert the
        // real write actually happened.
        expect(recordQuestionEvent).toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // Review round 1, Finding 1 — a throwing onAnswered must never be
    // misattributed as a failed server write. It used to sit INSIDE the same
    // try/catch that resets recordedRef on a genuinely failed write, so a
    // throwing subscriber would wrongly re-arm the guard and let the NEXT tap
    // insert a SECOND question_events row for an event the server already
    // has (the table is append-only).
    // -------------------------------------------------------------------------
    it('does not re-arm the write guard when onAnswered throws — the server already has the write', async () => {
        const onAnswered = vi.fn(() => { throw new Error('subscriber exploded'); });
        const { result } = renderHook(() => useDfesQuestion('farm-1', null, inputs(), true, onAnswered));
        await waitFor(() => expect(result.current.selected).not.toBeNull());

        await act(async () => { await result.current.recordOutcome({ skipped: false, response: 'low' }); });
        expect(recordQuestionEvent).toHaveBeenCalledTimes(1);
        expect(onAnswered).toHaveBeenCalledTimes(1);

        // A second tap must NOT insert a second append-only row: recordedRef
        // must still be true even though onAnswered threw on the first call.
        await act(async () => { await result.current.recordOutcome({ skipped: true }); });
        expect(recordQuestionEvent).toHaveBeenCalledTimes(1);
    });

    // Review round 2: a companion test here — asserting
    // `await expect(act(...)).resolves.not.toThrow()` when onAnswered throws —
    // was REMOVED. It was vacuous: even the OLD buggy code already swallowed
    // any onAnswered throw inside its try/catch (that was the bug — the wrong
    // SIDE EFFECT on recordedRef, never an escaping throw), so the assertion
    // could not fail against either the broken or the fixed source, proven by
    // the disclosed RED run staying green on this exact test. The test above
    // ('does not re-arm the write guard...') already covers both real
    // requirements from Finding 1 with an assertion that genuinely
    // distinguishes fixed from broken (a real, git-stash-verified RED/GREEN
    // pair) — nothing is lost by not re-asserting the same fix a second way.
});
