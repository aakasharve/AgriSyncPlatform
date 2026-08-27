/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Daily Clarity Loop v1 — the morning TRIGGER (spec: dfes-companion-2026-07-11).
 *
 * One calm line at the very top of the home idle view, answering "काय राहिलं".
 * Wave 2.4 split the N === 0 case in two, because "nothing LEFT" and "nothing
 * TOLD" are different days and the old single line claimed the second for both.
 * The founder's 2026-08-27 ruling then removed the first of those two:
 *   N > 0                          → आज {N} कामं बाकी (today N tasks left)
 *   N === 0, closurePercent === 0  → आज काहीच सांगितलं नाही… (nothing told yet;
 *                                    give a reason, or just say "no work today")
 *   N === 0, closurePercent  > 0   → NOTHING. This card does not render at all.
 *                                    See below.
 *
 * WHY THE SETTLED LINE IS GONE (founder review of `?preview=oversight&waiting=none`,
 * 2026-08-27 — superseding ruling A2 of 2026-08-26)
 * ---------------------------------------------------------------------------
 * On 2026-08-26 the founder read the oversight strip reporting FOUR rows
 * waiting for him and, directly beneath it, this component's "आज सगळं सांगून
 * झालं — काही बाकी नाही" ("today everything is told — nothing left"). Both
 * numbers were true about different subjects — the strip counts rows awaiting
 * HIS DECISION, this line counted TODAY'S UNLOGGED TASKS — but a farmer does
 * not parse that distinction; he read "4 pending" above "all done". Ruling A2
 * kept the line and gated it on the strip's own published count.
 *
 * On 2026-08-27 he looked again, at the state where the gate PASSES — strip in
 * its rest state, this line spoken beneath it — and ruled on the duplication
 * itself: *"there are two line only keep which is on the oversight bar."* Two
 * true, agreeing sentences saying the same thing one above the other is still
 * one sentence too many, and he has now seen both and picked the strip's.
 *
 * So the line is DELETED at its source rather than withheld at render time.
 * That is a stronger fix than the gate it replaces — there is no longer a
 * second all-clear surface that could disagree with the strip under any input
 * — and it is why `features/oversight/oversightWaitingSignal.ts` and its
 * `AppHeader` publisher went with it: this component was that signal's only
 * consumer, and a cross-subtree store with nothing to gate is scaffolding, not
 * a guard. What replaces it is `features/oversight/__tests__/
 * oneAllClearSurface.test.tsx`, which mounts the real header above the real
 * hero and proves the screen holds exactly one all-clear claim.
 *
 * WHAT DID **NOT** MOVE TO THE STRIP. The founder also asked for the ring on
 * the oversight bar, and it went — as a shell. The NUMBER in it did not:
 * `closurePercent` is a proportion of today's planned work, and the strip's
 * subject is a count of rows awaiting the owner. They have no shared
 * denominator, so they cannot honestly share one control (doctrine `P4`), and
 * the ring below still carries the closure percent for the two states this
 * card does still render. On a settled day the strip is now the only surface,
 * and that day's closure percent has no home — reported, not silently dropped.
 *
 * It REUSES a count the app already computes (todayDayState.pendingCount) —
 * nothing new is calculated here. The carried signal is derived from the SAME
 * today-pending set (its overdue subset), so it can only ever QUALIFY the N above
 * — never contradict it (Fix 1). It shows as a soft sub-line: for one carried
 * task, its title ("काल पासून: …"); for several, "(यातील {k} काल पासून)" with
 * k ≤ N always. This replaces the old standalone "काल {M} …" count that could
 * diverge above N, and the separate "Yesterday not fully closed" banner. Tapping
 * the hero focuses the existing recorder (no new navigation). Reward here is
 * clarity/control — never points, never scolding.
 */
import React from 'react';
import { useLanguage } from '../../../../i18n/LanguageContext';

interface DailyLoopHeroProps {
    /** Tasks left today (todayDayState.pendingCount) — already folds in carry-forward. */
    pendingCount: number;
    /**
     * How many of TODAY's pending tasks genuinely carried over (dueDate < today).
     * A strict subset of pendingCount, so 0 ≤ carriedCount ≤ pendingCount ALWAYS.
     * 0 hides the carried sub-line.
     */
    carriedCount: number;
    /** Title of the single carried task, when carriedCount === 1 — names it instead of a bare count. */
    carriedTitle?: string;
    /** Day-closure ring fill, 0–100 (todayDayState.closurePercent). */
    closurePercent: number;
    /** Focus the existing recorder — reuses the crop-selector focus pattern. */
    onFocusRecorder: () => void;
}

// Font rules (CHARTER): Marathi body → Noto Sans Devanagari; numbers → DM Sans.
const MARATHI_BODY = "'Noto Sans Devanagari', sans-serif";
const NUMBER_FONT = "'DM Sans', sans-serif";

// Splits a "…{count}…" template so the numeral renders in DM Sans while the
// surrounding Marathi keeps Noto Sans Devanagari — honouring both font rules.
const withCount = (template: string, count: number): React.ReactNode => {
    const [before, after = ''] = template.split('{count}');
    return (
        <>
            {before}
            <span style={{ fontFamily: NUMBER_FONT }}>{count}</span>
            {after}
        </>
    );
};

const DailyLoopHero: React.FC<DailyLoopHeroProps> = ({
    pendingCount,
    carriedCount,
    carriedTitle,
    closurePercent,
    onFocusRecorder,
}) => {
    const { t } = useLanguage();
    const hasWork = pendingCount > 0;
    const showCarried = hasWork && carriedCount > 0;

    // Wave 2.4 (spec: dfes-companion-2026-07-11) — the ring and the line are
    // driven by ONE fact so they can never state opposite things.
    //
    // Before: the ring showed `closurePercent` unconditionally and the line
    // showed the empty-day invite whenever `pendingCount === 0`. On an
    // untouched day that put a 100% ring beside "आज काहीच सांगितलं नाही" ("you
    // told me nothing today") — both derived from "nothing planned, nothing
    // logged", saying opposite things.
    //
    // `closurePercent` is now honest at the source (dayState.ts): a day with
    // nothing planned and nothing recorded scores 0, and anything the farmer
    // has actually done pushes it above 0. So with no work pending:
    //   closurePercent === 0 -> nothing has happened yet: there is no closure
    //                           to report, so the ring shows NO NUMBER (a
    //                           neutral track and a dash — not a "0%" that
    //                           reads as failure; the farmer has done nothing
    //                           wrong) and the line invites them to speak.
    //   closurePercent  > 0  -> the day HAS been recorded/completed, so the
    //                           line must not claim they told us nothing.
    const nothingRecordedYet = !hasWork && closurePercent === 0;

    // FOUNDER RULING 2026-08-27 — THE SETTLED DAY HAS NO LINE HERE ANY MORE.
    //
    // "आज सगळं सांगून झालं — काही बाकी नाही" was this card's ENTIRE content in
    // the N === 0, day-recorded case; the ring beside it only qualified the
    // sentence. The founder read that sentence directly beneath the oversight
    // strip's own all-clear and ruled: keep the strip's, drop this one (see
    // the file header). Unconditional, not gated — under NO input does this
    // component speak an all-clear now, which is why the ruling could retire
    // `oversightWaitingSignal` rather than tighten it.
    //
    // Withholding only the SENTENCE was considered and rejected for the same
    // reason it was rejected on 2026-08-26: the card would become a bare
    // percentage floating in an empty box, which reads as its own vague
    // reassurance. The whole card stands down.
    //
    // The other two states are untouched, and deliberately so. "आज N कामं
    // बाकी" and "आज काहीच सांगितलं नाही" are not all-clears and do not restate
    // the strip — work outstanding and records outstanding are both true at
    // once — so gating or deleting them would be hiding true lines to
    // manufacture agreement.
    if (!hasWork && !nothingRecordedYet) {
        return null;
    }

    return (
        // The spacing/entrance wrapper lives HERE, not at the call site
        // (`mainView.tsx`), because this component has a state in which it
        // renders nothing at all (the settled day, above). Left outside, `mb-4`
        // would survive that `return null` as a 16px ghost gap under the
        // oversight strip — a visible artefact of a card that is not there.
        <div className="mb-4 animate-in slide-in-from-top-4 duration-300 delay-100">
        <button
            type="button"
            onClick={onFocusRecorder}
            data-testid="daily-loop-hero"
            className="w-full text-left rounded-2xl border border-stone-200 bg-white p-4 shadow-sm flex items-center gap-4 transition-transform active:scale-[0.99]"
        >
            {/* Amber day-closure ring, kept beside the line. On a day nothing
                has been told about there is nothing to fill it with, so it
                stays a flat amber track carrying a dash instead of a number. */}
            <div
                className="w-12 h-12 shrink-0 rounded-full p-1"
                style={{
                    background: nothingRecordedYet
                        ? '#fde68a'
                        : `conic-gradient(#059669 ${closurePercent * 3.6}deg, #fde68a 0deg)`
                }}
                aria-hidden="true"
            >
                <div
                    data-testid="daily-loop-hero-ring"
                    className="w-full h-full rounded-full bg-white flex items-center justify-center text-[10px] font-black text-stone-700"
                    style={{ fontFamily: NUMBER_FONT }}
                >
                    {nothingRecordedYet ? '—' : `${closurePercent}%`}
                </div>
            </div>

            <div className="min-w-0 flex-1">
                <p
                    data-testid="daily-loop-hero-line"
                    className="text-lg font-black leading-snug text-stone-900"
                    style={{ fontFamily: MARATHI_BODY }}
                >
                    {/* Two branches, not three: the settled sentence
                        (`dfes.dailyLoopDaySettled`) is no longer rendered by
                        anything — founder ruling 2026-08-27, file header. The
                        key stays in `dfesTranslations.ts` because his Marathi
                        is approved copy and `oneAllClearSurface.test.tsx`
                        reads it FROM the table to assert it reaches no
                        screen; retyping it in the test would let a copy edit
                        silently pass. */}
                    {hasWork
                        ? withCount(t('dfes.dailyLoopTasksLeft'), pendingCount)
                        : t('dfes.dailyLoopDayFree')}
                </p>
                {showCarried && (
                    <p
                        data-testid="daily-loop-hero-carried"
                        className="mt-0.5 text-sm font-semibold text-amber-700"
                        style={{ fontFamily: MARATHI_BODY }}
                    >
                        {carriedCount === 1 && carriedTitle
                            ? t('dfes.dailyLoopCarriedOne').replace('{title}', carriedTitle)
                            : withCount(t('dfes.dailyLoopCarriedMany'), carriedCount)}
                    </p>
                )}
            </div>
        </button>
        </div>
    );
};

export default DailyLoopHero;
