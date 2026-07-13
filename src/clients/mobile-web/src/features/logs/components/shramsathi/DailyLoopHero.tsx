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
 * nothing new is calculated here. The carried/overdue signal ("काल राहिलं") is
 * folded in BESIDE it, replacing the separate "Yesterday not fully closed"
 * banner. Tapping the hero focuses the existing recorder (no new navigation).
 * Reward here is clarity/control — never points, never scolding.
 */
import React from 'react';
import { useLanguage } from '../../../../i18n/LanguageContext';

interface DailyLoopHeroProps {
    /** Tasks left today (todayDayState.pendingCount) — already folds in carry-forward. */
    pendingCount: number;
    /** Yesterday's leftover (yesterdayDayState.pendingCount); 0 hides the carried line. */
    carriedCount: number;
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
                        {withCount(t('dfes.dailyLoopCarried'), carriedCount)}
                    </p>
                )}
            </div>
        </button>
    );
};

export default DailyLoopHero;
