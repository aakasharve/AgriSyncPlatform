/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * dfesTodayWork — pure "what Sathi believes was done TODAY" signal (wave-3.6).
 *
 * Ruling 4 (2026-08-15): Sathi may acknowledge the work before asking his question, but
 * only when recognition confidence is high. This module supplies the WHAT; the
 * confidence half lives in `dfesQuestionEngine.isWorkRecognitionConfident`.
 *
 * HONEST GRANULARITY — the same rule dfesPreviousLog.ts and dfesScheduleWindow.ts
 * already follow: a log's own activity titles are free voice text and may be in any
 * language, so this NEVER quotes them. It reports the CATEGORY the day's work falls
 * into, spoken with the SAME four approved Marathi labels the app already ships
 * (CATEGORY_LABEL_MR) — reused verbatim, never invented — and classified with the SAME
 * executed-count logic dayState.ts already uses.
 *
 * ANTI-FABRICATION (P4): null when the log recorded no executed work in any category.
 * There is no default, no "probably a spray". No recognised work means no
 * acknowledgement clause, and the engine then asks the neutral question.
 *
 * Scoped to the ONE log the question is about, not to the day's whole ledger: the
 * question is a follow-up on that specific record (wave-3.2's per-log scoping), so
 * naming work from a different log would be the wrong subject even when it is real.
 *
 * PURE: no Date.now(), no network, no React/DOM.
 *
 * spec: dfes-companion-2026-07-11 (wave-3.6)
 */
import type { DailyLog } from '../../../types';
import { CATEGORY_LABEL_MR, type OperationCategory } from './dfesScheduleWindow';
import { getExecutionCountByCategory } from '../../../shared/utils/dayState';

/** The work Sathi believes this log recorded, in approved Marathi. */
export interface TodayWorkContext {
    /** Marathi category label, verbatim from CATEGORY_LABEL_MR — never a quoted title. */
    activityMr: string;
}

/**
 * Which single category best describes a log that recorded several kinds of work. Same
 * spray-first ordering dfesPreviousLog and dfesScheduleWindow use, and for the same
 * reason: a spray is the most specific, most memorable thing a farmer did, general
 * activity the least.
 */
const CATEGORY_ORDER: readonly OperationCategory[] = ['FOLIAR_SPRAY', 'FERTIGATION', 'IRRIGATION', 'ACTIVITY'];

/** What this log recorded, or null when it recorded no executed work at all. */
export function computeTodayWork(savedLog: DailyLog | undefined | null): TodayWorkContext | null {
    if (!savedLog) return null;
    const category = CATEGORY_ORDER.find(candidate => getExecutionCountByCategory([savedLog], candidate) > 0);
    return category ? { activityMr: CATEGORY_LABEL_MR[category] } : null;
}
