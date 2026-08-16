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
import {
    readPendingQuestionAnswer, withPendingMerged, abandonStalePendingQuestionAnswer,
} from '../services/pendingQuestionAnswer';

export interface UseDfesQuestionResult {
    selected: SelectedQuestion | null;
    loading: boolean;
    recordOutcome: (outcome: QuestionOutcome) => Promise<void>;
    /**
     * wave-3.7 — the moment the current question was put in front of the farmer.
     * Exposed because the respeak path defers the write until AFTER a trip to the
     * microphone, and `shownAtUtc` must survive that trip rather than being re-stamped
     * to the moment he finished speaking.
     */
    shownAtUtc: string;
}

export function useDfesQuestion(
    farmId: string,
    plotId: string | null,
    inputs: Omit<DailyQuestionInputs, 'recentEvents'>,
    enabled = true,
    // Task 4 (spec: dfes-farmer-facing-deploy-readiness-2026-08-14) — optional,
    // trailing, following this file's own idiom for `enabled` above. Invoked
    // AFTER recordQuestionEvent resolves, so a caller (MeterQuestionHost) can
    // trigger the Day Understanding Score refetch (DayUnderstandingCard/
    // useDayUnderstanding) the moment the server has accepted the answer.
    onAnswered?: () => void,
): UseDfesQuestionResult {
    const [selected, setSelected] = useState<SelectedQuestion | null>(null);
    const [loading, setLoading] = useState(enabled);
    const shownAtRef = useRef<string>('');
    const recordedRef = useRef(false);
    // Mirrored into state (the ref stays the write path's source of truth) so a consumer
    // that RENDERS with it — the respeak route, which must carry the shown-at moment
    // across a trip to the microphone — re-renders when a new question is selected.
    const [shownAtUtc, setShownAtUtc] = useState('');

    useEffect(() => {
        // Flag gate: no farm or feature OFF → do not touch the network.
        if (!enabled || !farmId) {
            setSelected(null);
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);

        // wave-3.7 — a stash that outlived its day is abandoned honestly (a SKIP row: he
        // was shown the question and never answered it), never deleted silently, and never
        // left to hold today's one-question-per-day guard shut forever. Fire-and-forget:
        // the follow-up must never block or delay the question surface.
        void abandonStalePendingQuestionAnswer(inputs.todayLocalDate);

        // Captured SYNCHRONOUSLY, before the fetch. The settle path may clear the slot
        // while this request is in flight, and a guard that opened in that window would put
        // a second question in front of him on the same day.
        const pendingAtStart = readPendingQuestionAnswer();

        fetchRecentQuestionEvents(farmId)
            .then((recentEvents) => {
                if (cancelled) return;
                const pick = selectDailyQuestion({
                    ...inputs,
                    // wave-3.7 — while an answer is pending NO server row exists yet, so
                    // the stash stands in as a synthetic one. Client-side only; it never
                    // reaches the server.
                    recentEvents: withPendingMerged(recentEvents, inputs.todayLocalDate, pendingAtStart),
                });
                setSelected(pick);
                shownAtRef.current = new Date().toISOString();
                setShownAtUtc(shownAtRef.current);
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
        let wroteToServer = false;
        try {
            await recordQuestionEvent(farmId, plotId, selected, outcome, shownAtRef.current);
            wroteToServer = true;
        } catch {
            recordedRef.current = false; // allow a retry on transient failure
        }
        if (!wroteToServer) return;
        // FIX (review round 1, Task 4) — onAnswered?.() lives OUTSIDE the
        // try/catch above, gated on the `wroteToServer` flag, and in its OWN
        // try/catch. It used to sit INSIDE that try block: if a subscriber
        // threw, execution fell into the SAME catch that resets
        // recordedRef.current on a genuinely failed write — misattributing
        // the subscriber's bug as a failed server write and re-arming the
        // guard. The next tap would then insert a SECOND question_events row
        // for an event the server had already recorded (the table is
        // append-only). Only after the server has the answer — a failed
        // write must never move the number, or the farmer is shown a score
        // the server does not agree with. Fired for every outcome the server
        // accepts (bare ack/dismiss included): Task 3 already guards the
        // SERVER-side recompute to fire only when an answer could credit
        // something (DailyRichnessDerivationService), so calling this
        // unconditionally costs at most one extra read-only GET on a no-op
        // ack/dismiss — cheaper and less fragile than duplicating that
        // "would this credit" rule here, where it could silently drift out
        // of sync.
        try {
            onAnswered?.();
        } catch {
            // Swallow — the write already succeeded; a broken subscriber is
            // the subscriber's problem, never a reason to retry the write.
            // (notifyDfesAnswered also isolates each of ITS listeners, so in
            // production this only guards a directly-injected onAnswered.)
        }
    }, [farmId, plotId, selected, onAnswered]);

    return { selected, loading, recordOutcome, shownAtUtc };
}
