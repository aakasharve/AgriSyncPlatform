/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Daily Clarity Loop v1 — the morning TRIGGER (spec: dfes-companion-2026-07-11).
 *
 * One calm line at the very top of the home idle view, answering "काय राहिलं".
 * Wave 2.4 splits the N === 0 case in two, because "nothing LEFT" and "nothing
 * TOLD" are different days and the old single line claimed the second for both:
 *   N > 0                          → आज {N} कामं बाकी (today N tasks left)
 *   N === 0, closurePercent === 0  → आज काहीच सांगितलं नाही… (nothing told yet;
 *                                    give a reason, or just say "no work today")
 *   N === 0, closurePercent  > 0   → आज सगळं सांगून झालं — काही बाकी नाही.
 *                                    (today is told, nothing left) — ONLY when
 *                                    the oversight strip is also claiming
 *                                    nothing is waiting; see ruling A2 below.
 *
 * WHAT THIS HEADER USED TO CLAIM, AND WHY IT WAS FALSE (founder review of
 * `?preview=oversight`, 2026-08-26 — ruling A2)
 * ---------------------------------------------------------------------------
 * It said: "The ring beside it reads from the SAME fact, so the two can never
 * contradict." That was true of the RING and of nothing else. The founder read
 * the oversight strip reporting FOUR rows waiting for him and, directly
 * beneath it, this component's "आज सगळं सांगून झालं — काही बाकी नाही"
 * ("today everything is told — nothing left"). Both numbers were true and
 * neither was fabricated — the strip counts logs awaiting HIS APPROVAL, this
 * line counts TODAY'S UNLOGGED TASKS — but a farmer does not parse that
 * distinction. He reads "4 pending" above "all done". Doctrine P4 is about
 * what reaches the farmer, and what reached him was false.
 *
 * The settled line is NOT deleted (founder ruling A2: "the line stays"). It is
 * now gated on the strip's OWN published count as well as on N, via
 * `useOversightWaitingSignal` — read `features/oversight/oversightWaitingSignal.ts`
 * for why that is a forwarded number rather than a second computation, and for
 * why `null` there means "the strip is making no claim" and must never be read
 * as zero. So the header's claim is finally true of both neighbours: the ring
 * cannot contradict this line because it shares `todayDayState`, and the strip
 * cannot contradict it because this line will not render unless the strip has
 * said, positively, that nothing is waiting.
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
// Ruling A2 — the oversight strip's own count, forwarded by `AppHeader`. Not a
// prop: `mainView.renderLogView` is a plain function, not a component
// (`routeContext.ts` keeps it hook-free), so it cannot subscribe on this
// component's behalf, and the fact lives in a sibling subtree with no prop
// path down. See that module's header.
import { useOversightWaitingSignal } from '../../../oversight/oversightWaitingSignal';

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
    const oversightWaiting = useOversightWaitingSignal();
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

    // RULING A2 — "nothing left" is a claim about the WHOLE screen, so it needs
    // both neighbours' agreement, not just the ring's.
    //
    // `oversightWaiting` is what the oversight strip is currently saying:
    //   0     it is in its rest state — it has positively claimed nothing is
    //         waiting. The only value on which this line may be spoken.
    //   > 0   it is showing that many waiting rows. Saying "काही बाकी नाही"
    //         underneath it is the exact defect the founder found.
    //   null  it is checking, cannot confirm, or is not on screen. UNKNOWN IS
    //         NOT NONE (`oversightSelectors.ts`'s own rule) — a claim needs
    //         evidence, and there is none here, so the line stays unsaid.
    // No `?? 0` anywhere near it: that would turn every "we do not know" back
    // into the reassurance this fix exists to withdraw.
    const mayClaimSettled = oversightWaiting === 0;

    // The settled line is this card's ENTIRE content in the N === 0,
    // day-recorded case — the ring beside it only qualifies the sentence. With
    // the sentence withheld the card would be a percentage floating in an
    // otherwise empty box directly under a strip saying four things are
    // waiting, which reads as its own vague reassurance. So the card stands
    // down and leaves the screen to the surface that DOES have something to
    // say. Nothing is lost that is not still one tap away in the strip's own
    // drawer, and no other state of this hero is affected: N > 0 still renders
    // its count, and the "nothing told yet" invite still renders its invite —
    // neither of those contradicts a positive waiting count (work outstanding
    // and records outstanding are both true at once), so neither is gated.
    if (!hasWork && !nothingRecordedYet && !mayClaimSettled) {
        return null;
    }

    return (
        // The spacing/entrance wrapper lives HERE, not at the call site
        // (`mainView.tsx`), because ruling A2 gave this component a state in
        // which it renders nothing at all. Left outside, `mb-4` would survive
        // that `return null` as a 16px ghost gap under the oversight strip —
        // a visible artefact of a card that deliberately said nothing.
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
                    {hasWork
                        ? withCount(t('dfes.dailyLoopTasksLeft'), pendingCount)
                        : nothingRecordedYet
                            ? t('dfes.dailyLoopDayFree')
                            : t('dfes.dailyLoopDaySettled')}
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
