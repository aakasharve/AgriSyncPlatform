/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FOUNDER DECISION 3 — the farmer answers by speaking again, and HIS WORDS ARE KEPT.
 *
 * The bar this file has to clear is specific. `question_events.response` is NULL on every
 * row ever written, because the only live outcome was a bare acknowledgement with no text,
 * and the table is append-only by privilege so a row written on tap can never acquire the
 * answer afterwards. A "respeak" that still produced `response: null` would leave wave-3.11
 * with nothing to classify and would not deliver the decision at all. The load-bearing test
 * here is therefore `lands the spoken answer as TEXT on question_events.response`.
 *
 * spec: dfes-companion-2026-07-11 (wave-3.7)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SelectedQuestion, RecentQuestionEvent } from '../dfesQuestionEngine';

vi.mock('../dfesQuestionApi', () => ({ recordQuestionEvent: vi.fn().mockResolvedValue({ id: 'qe-1' }) }));

import { recordQuestionEvent } from '../dfesQuestionApi';
import {
    stashPendingQuestionAnswer, readPendingQuestionAnswer, clearPendingQuestionAnswer,
    settlePendingQuestionAnswer, abandonPendingQuestionAnswer,
    abandonStalePendingQuestionAnswer, withPendingMerged,
} from '../pendingQuestionAnswer';

const TODAY = '2026-08-16';

const selected = {
    question: { questionKey: 'gap.dose' },
    resolvedPromptMr: 'औषध किती वापरलं?',
    triggerReason: 'gap: DOSE',
    weatherContext: null,
    expectedStage: null,
    actualStageApplicability: null,
} as unknown as SelectedQuestion;

const stash = (over: Record<string, unknown> = {}) => stashPendingQuestionAnswer({
    questionKey: 'gap.dose',
    farmId: 'farm-1',
    plotId: 'plot-1',
    selected,
    shownAtUtc: '2026-08-16T04:00:00.000Z',
    sourceLogId: 'log-1',
    stashedLocalDate: TODAY,
    ...over,
});

beforeEach(() => {
    clearPendingQuestionAnswer();
    vi.mocked(recordQuestionEvent).mockClear();
    vi.mocked(recordQuestionEvent).mockResolvedValue({ id: 'qe-1' });
});

describe('the tap itself writes nothing', () => {
    it('stashing does not touch the server', () => {
        stash();
        // The whole point of deferring: a row written now could never acquire the answer.
        expect(recordQuestionEvent).not.toHaveBeenCalled();
        expect(readPendingQuestionAnswer()?.questionKey).toBe('gap.dose');
    });
});

describe('the spoken answer lands as text', () => {
    it('lands the spoken answer as TEXT on question_events.response', async () => {
        stash();

        await settlePendingQuestionAnswer({ transcript: 'दोनशे मिली घेतलं' });

        expect(recordQuestionEvent).toHaveBeenCalledWith(
            'farm-1', 'plot-1', selected,
            expect.objectContaining({
                skipped: false, response: 'दोनशे मिली घेतलं', dailyLogId: 'log-1',
            }),
            '2026-08-16T04:00:00.000Z');
    });

    it('attributes the answer to the log the QUESTION was about, not the new one', () => {
        // sourceLogId is Monday's spray log; the transcript arrives on a brand-new log.
        // Crediting the new log would leave Monday's gap open forever.
        stash({ sourceLogId: 'log-monday' });
        return settlePendingQuestionAnswer({ transcript: 'दोनशे मिली' }).then(() => {
            expect(vi.mocked(recordQuestionEvent).mock.calls[0][3].dailyLogId).toBe('log-monday');
        });
    });

    it('clears the stash so the same answer cannot be written twice', async () => {
        stash();
        await settlePendingQuestionAnswer({ transcript: 'दोनशे मिली' });
        await settlePendingQuestionAnswer({ transcript: 'दोनशे मिली' });
        expect(recordQuestionEvent).toHaveBeenCalledTimes(1);
    });

    it('never writes an empty transcript as an answer', async () => {
        stash();
        await settlePendingQuestionAnswer({ transcript: '   ' });
        expect(recordQuestionEvent).not.toHaveBeenCalled();
        expect(readPendingQuestionAnswer()).not.toBeNull();
    });

    it('swallows a failed write — the follow-up never surfaces as a failed save', async () => {
        stash();
        vi.mocked(recordQuestionEvent).mockRejectedValueOnce(new Error('offline'));
        await expect(settlePendingQuestionAnswer({ transcript: 'दोनशे मिली' })).resolves.toBe(false);
    });
});

describe('leaving without speaking', () => {
    it('records a skip, not an invented answer', async () => {
        stash();

        await abandonPendingQuestionAnswer();

        expect(recordQuestionEvent).toHaveBeenCalledWith(
            'farm-1', 'plot-1', selected,
            expect.objectContaining({ skipped: true, response: null, dailyLogId: 'log-1' }),
            '2026-08-16T04:00:00.000Z');
    });

    it('does nothing at all when no question was pending', async () => {
        await abandonPendingQuestionAnswer();
        expect(recordQuestionEvent).not.toHaveBeenCalled();
    });

    it('abandons a stash that outlived its day', async () => {
        stash({ stashedLocalDate: '2026-08-15' });
        await abandonStalePendingQuestionAnswer(TODAY);
        expect(vi.mocked(recordQuestionEvent).mock.calls[0][3].skipped).toBe(true);
        expect(readPendingQuestionAnswer()).toBeNull();
    });

    it('leaves TODAY\'s stash alone', async () => {
        stash();
        await abandonStalePendingQuestionAnswer(TODAY);
        expect(recordQuestionEvent).not.toHaveBeenCalled();
        expect(readPendingQuestionAnswer()).not.toBeNull();
    });
});

describe('the one-question-per-day guard while an answer is pending', () => {
    const merged = (recent: RecentQuestionEvent[] = []) => withPendingMerged(recent, TODAY);

    it('folds the pending question in as a synthetic row for today', () => {
        stash();
        const rows = merged();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            questionKey: 'gap.dose', createdAtLocalDate: TODAY, dailyLogId: 'log-1', skipped: false,
        });
    });

    it('does not mark the pending question as skipped', () => {
        // He has not decided yet. Calling it a skip would start SKIP_COOLDOWN_DAYS running
        // against a question he is on his way to answer.
        stash();
        expect(merged()[0].skipped).toBe(false);
    });

    it('merges nothing when no answer is pending', () => {
        expect(merged()).toEqual([]);
    });

    it('ignores a stash from another day', () => {
        stash({ stashedLocalDate: '2026-08-15' });
        expect(merged()).toEqual([]);
    });

    it('accepts an injected snapshot so a merge after an await still sees it', () => {
        // useDfesQuestion captures the stash BEFORE its fetch: the settle path may clear
        // the slot while that fetch is in flight, and a guard that opened in that window
        // would put a second question in front of him the same day.
        stash();
        const captured = readPendingQuestionAnswer();
        clearPendingQuestionAnswer();
        expect(withPendingMerged([], TODAY, captured)).toHaveLength(1);
        expect(withPendingMerged([], TODAY)).toHaveLength(0);
    });
});
