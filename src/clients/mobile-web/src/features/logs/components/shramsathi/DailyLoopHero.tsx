/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Daily Clarity Loop v1 — the morning TRIGGER (spec: dfes-companion-2026-07-11).
 *
 * One calm line at the very top of the home idle view, answering "काय राहिलं":
 *   आज {N} कामं बाकी              (today N tasks left)   — when N > 0
 *   आजचा दिवस मोकळा — बोलून नोंदवा (day free, just speak) — when N === 0
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

    return (
        <button
            type="button"
            onClick={onFocusRecorder}
            data-testid="daily-loop-hero"
            className="w-full text-left rounded-2xl border border-stone-200 bg-white p-4 shadow-sm flex items-center gap-4 transition-transform active:scale-[0.99]"
        >
            {/* Amber day-closure ring, kept beside the line. */}
            <div
                className="w-12 h-12 shrink-0 rounded-full p-1"
                style={{ background: `conic-gradient(#059669 ${closurePercent * 3.6}deg, #fde68a 0deg)` }}
                aria-hidden="true"
            >
                <div
                    className="w-full h-full rounded-full bg-white flex items-center justify-center text-[10px] font-black text-stone-700"
                    style={{ fontFamily: NUMBER_FONT }}
                >
                    {closurePercent}%
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
    );
};

export default DailyLoopHero;
