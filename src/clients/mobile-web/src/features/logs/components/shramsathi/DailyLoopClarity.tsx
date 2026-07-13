/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Daily Clarity Loop v1 — the REWARD line (spec: dfes-companion-2026-07-11).
 *
 * One calm, dignified line on the "Saved to Ledger" success card, sitting
 * directly ABOVE Sathi's one gentle question. It answers "am I in control?"
 * with a plain fact — "{done} पूर्ण, {left} बाकी" (done / left) — never a
 * grade, never points, never scolding. This is the control-affirming reward
 * the farmer earns for logging; the question sits just below it.
 *
 * REUSES counts the app already computes (todayDayState.completedCount /
 * .pendingCount) — nothing new is calculated here. Decision 3B: there is NO
 * fact/insight fallback in v1; on a no-question day this line stands alone.
 */
import React from 'react';
import { useLanguage } from '../../../../i18n/LanguageContext';

interface DailyLoopClarityProps {
    /** Tasks completed today (todayDayState.completedCount). */
    done: number;
    /** Tasks left today (todayDayState.pendingCount). */
    left: number;
}

// Font rules (CHARTER): Marathi body → Noto Sans Devanagari; numbers → DM Sans.
const MARATHI_BODY = "'Noto Sans Devanagari', sans-serif";
const NUMBER_FONT = "'DM Sans', sans-serif";

// Interleaves the {done}/{left} numerals (DM Sans) with the surrounding Marathi
// text (Noto Sans Devanagari), honouring both font rules in one line.
const DailyLoopClarity: React.FC<DailyLoopClarityProps> = ({ done, left }) => {
    const { t } = useLanguage();
    const parts = t('dfes.dailyLoopClarity').split(/(\{done\}|\{left\})/);

    return (
        <p
            data-testid="daily-loop-clarity"
            className="mb-6 text-center text-lg font-black leading-snug text-stone-800"
            style={{ fontFamily: MARATHI_BODY }}
        >
            {parts.map((part, idx) => {
                if (part === '{done}') {
                    return <span key={idx} style={{ fontFamily: NUMBER_FONT }}>{done}</span>;
                }
                if (part === '{left}') {
                    return <span key={idx} style={{ fontFamily: NUMBER_FONT }}>{left}</span>;
                }
                return <React.Fragment key={idx}>{part}</React.Fragment>;
            })}
        </p>
    );
};

export default DailyLoopClarity;
