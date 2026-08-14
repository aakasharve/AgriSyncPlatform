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
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** DayUnderstandingCard subscribes in a useEffect to learn about new answers. */
export function subscribeDfesAnswered(listener: Listener): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** MeterQuestionHost wires this in as useDfesQuestion's onAnswered. */
export function notifyDfesAnswered(): void {
    listeners.forEach((listener) => listener());
}
