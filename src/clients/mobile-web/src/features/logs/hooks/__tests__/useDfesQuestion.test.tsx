// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('../../services/dfesQuestionApi', () => ({
    fetchRecentQuestionEvents: vi.fn(async () => []),
    recordQuestionEvent: vi.fn(async () => ({ id: 'e1' })),
}));

import { useDfesQuestion } from '../useDfesQuestion';
import * as api from '../../services/dfesQuestionApi';
import type { DailyQuestionInputs } from '../../services/dfesQuestionEngine';

const inputs = (): Omit<DailyQuestionInputs, 'recentEvents'> => ({
    crop: 'grapes', todayLocalDate: '2026-07-11',
    score: { score: 40, outcome: 'SCORED',
        dimensions: [{ dimension: 'DOSE', applicable: true, weight: 20, coverage: 0, confidenceFactor: 1, contribution: 0 }] },
    engagement: { totalRichDays: 0, unlockStatus: 'locked' },
});

describe('useDfesQuestion (Phase 5)', () => {
    beforeEach(() => vi.clearAllMocks());

    it('selects the top gap question from the recent feed', async () => {
        const { result } = renderHook(() => useDfesQuestion('farm-1', null, inputs(), true));
        await waitFor(() => expect(result.current.selected?.question.questionKey).toBe('gap.dose'));
    });

    it('records telemetry when recordOutcome is called', async () => {
        const { result } = renderHook(() => useDfesQuestion('farm-1', null, inputs(), true));
        await waitFor(() => expect(result.current.selected).not.toBeNull());
        await act(async () => { await result.current.recordOutcome({ response: '10 ml' }); });
        expect(api.recordQuestionEvent).toHaveBeenCalledTimes(1);
    });

    it('makes ZERO network calls and selects nothing when disabled', async () => {
        const { result } = renderHook(() => useDfesQuestion('farm-1', null, inputs(), false));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(api.fetchRecentQuestionEvents).not.toHaveBeenCalled();
        expect(result.current.selected).toBeNull();
    });
});
