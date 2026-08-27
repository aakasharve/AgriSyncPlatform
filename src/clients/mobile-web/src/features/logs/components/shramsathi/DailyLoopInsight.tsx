/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DailyLoopInsight — the "variable reward" fact line on the Saved-to-Ledger
 * success card (Task 1B, spec: dfes-companion-2026-07-11). Mirrors
 * `DailyLoopClarity`'s structure: sits directly BELOW the clarity line, one
 * calm Marathi sentence, never a grade/points/shame.
 *
 * The `insight.line` from the Task 1A intelligence module (`insights.ts`)
 * already carries Devanagari numerals (via `toMarathiNumber`) and is fully
 * composed — this component renders it verbatim. It does NOT re-wrap,
 * translate, or re-format any part of it (dignity contract, see
 * `insightTypes.ts`).
 *
 * Styled slightly secondary to `DailyLoopClarity` (smaller, lighter weight)
 * since it sits below the primary reward line.
 *
 * `render=false` is the safe default from Task 1A — this component also
 * guards on it independently (not just the mainView call site), so it is
 * correct even if reused elsewhere.
 */
import React from 'react';
import type { Insight } from '../../intelligence/insightTypes';

interface DailyLoopInsightProps {
    insight: Insight;
}

// Font rule (CHARTER): Marathi body text -> Noto Sans Devanagari.
const MARATHI_BODY = "'Noto Sans Devanagari', sans-serif";

const DailyLoopInsight: React.FC<DailyLoopInsightProps> = ({ insight }) => {
    if (!insight.render) {
        return null;
    }

    return (
        <p
            data-testid="daily-loop-insight"
            className="mb-6 text-center text-sm font-semibold leading-snug text-stone-500"
            style={{ fontFamily: MARATHI_BODY }}
        >
            {insight.line}
        </p>
    );
};

export default DailyLoopInsight;
