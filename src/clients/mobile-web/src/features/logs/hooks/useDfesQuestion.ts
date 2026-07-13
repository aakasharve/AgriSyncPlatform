/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useDfesQuestion — wires the pure D8 selector to the telemetry endpoints (Phase 5).
 * Fetches the recent-event cooldown feed, runs selectDailyQuestion, and exposes
 * recordOutcome() to append the append-only question_events row. The `enabled`
 * flag (caller passes FEATURE_FLAGS.stageQuestions) gates the FETCH entirely — a
 * both-flags-OFF production build makes ZERO network calls.
 *
 * spec: dfes-companion-2026-07-11
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    selectDailyQuestion, type DailyQuestionInputs, type SelectedQuestion,
} from '../services/dfesQuestionEngine';
import {
    fetchRecentQuestionEvents, recordQuestionEvent, type QuestionOutcome,
} from '../services/dfesQuestionApi';

export interface UseDfesQuestionResult {
    selected: SelectedQuestion | null;
    loading: boolean;
    recordOutcome: (outcome: QuestionOutcome) => Promise<void>;
}

export function useDfesQuestion(
    farmId: string,
    plotId: string | null,
    inputs: Omit<DailyQuestionInputs, 'recentEvents'>,
    enabled = true,
): UseDfesQuestionResult {
    const [selected, setSelected] = useState<SelectedQuestion | null>(null);
    const [loading, setLoading] = useState(enabled);
    const shownAtRef = useRef<string>('');
    const recordedRef = useRef(false);

    useEffect(() => {
        // Flag gate: no farm or feature OFF → do not touch the network.
        if (!enabled || !farmId) {
            setSelected(null);
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        fetchRecentQuestionEvents(farmId)
            .then((recentEvents) => {
                if (cancelled) return;
                const pick = selectDailyQuestion({ ...inputs, recentEvents });
                setSelected(pick);
                shownAtRef.current = new Date().toISOString();
                recordedRef.current = false;
            })
            .catch(() => { if (!cancelled) setSelected(null); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, farmId, inputs.todayLocalDate]);

    const recordOutcome = useCallback(async (outcome: QuestionOutcome) => {
        if (!selected || recordedRef.current) return;
        recordedRef.current = true;
        try {
            await recordQuestionEvent(farmId, plotId, selected, outcome, shownAtRef.current);
        } catch {
            recordedRef.current = false; // allow a retry on transient failure
        }
    }, [farmId, plotId, selected]);

    return { selected, loading, recordOutcome };
}
