/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * dfesAnswerSignal — tiny in-memory pub/sub so the Day Understanding Score
 * card can refetch the moment a DFES gap question is answered (Task 4, spec:
 * dfes-farmer-facing-deploy-readiness-2026-08-14). Founder ruling A: "the
 * number he is looking at must reflect it before he looks away."
 *
 * Why this exists instead of a prop: DayUnderstandingCard (owns the
 * useDayUnderstanding fetch) and MeterQuestionHost (owns useDfesQuestion,
 * nested inside LedgerRecognitionPanel) are SIBLINGS under mainView.tsx's
 * `renderLogView` — a route-render function `routeContext.ts` documents as
 * deliberately hook-free ("Keeps route render functions free of hook calls,
 * which would violate React's rules-of-hooks when called conditionally
 * inside the cascade"). Threading a refetch trigger between them as a prop
 * would mean lifting new state through AppFeatureContexts -> routeContext ->
 * AppRouter -> mainView for a single counter — a much larger, riskier change
 * than this task's actual requirement. Both real components already own
 * their own hooks, so each subscribes/notifies directly instead.
 *
 * Deliberately UNSCOPED (no farmId/plotId/date) — review round 1 verified this
 * is safe, not an oversight: the one subscriber (DayUnderstandingCard) always
 * refetches its OWN farmId/dayDate regardless of which farm/day the answer
 * was for, so a cross-day/cross-farm notify costs at most one redundant GET
 * and can never display another day's score. Adding scope would only be
 * needed if a future subscriber's refetch depended on which question was
 * answered — YAGNI until that exists.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** DayUnderstandingCard subscribes in a useEffect to learn about new answers. */
export function subscribeDfesAnswered(listener: Listener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/**
 * MeterQuestionHost wires this in as useDfesQuestion's onAnswered.
 *
 * FIX (review round 1, Task 4) — each listener runs in its OWN try/catch. A
 * bare `listeners.forEach(l => l())` would let one throwing subscriber (a)
 * abort the forEach and starve every subscriber registered after it, and
 * (b) propagate back into useDfesQuestion's recordOutcome, where it would be
 * misattributed as a failed server write (see useDfesQuestion.ts's own
 * try/catch around this call for why that matters — a failed write must
 * never move the number, so a THROWING subscriber must never be mistaken for
 * one).
 */
export function notifyDfesAnswered(): void {
    listeners.forEach((listener) => {
        try {
            listener();
        } catch {
            // Isolate — one broken subscriber must never prevent the others
            // from being notified, and must never surface as a caller error.
        }
    });
}
