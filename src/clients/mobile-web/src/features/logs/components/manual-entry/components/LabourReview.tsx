/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { HelpCircle } from 'lucide-react';
import { LabourEvent } from '../../../../../types';
import { t as translateForced } from '../../../../../i18n/translations';
import { useLanguage } from '../../../../../i18n/LanguageContext';
import { toMarathiNumber } from '../../../services/disciplineRecognition';

// Font rule (CHARTER): Marathi body text -> Noto Sans Devanagari. The
// "not certain I heard this" flag is Marathi copy shown inline with the
// farmer's own transcript quote, so it must set this explicitly.
const MARATHI_BODY = "'Noto Sans Devanagari', sans-serif";

interface LabourReviewProps {
    labourEntries: LabourEvent[];
    totalWorkerCount: number;
}

const LabourReview: React.FC<LabourReviewProps> = ({ labourEntries, totalWorkerCount }) => {
    const { language, t } = useLanguage();
    if (labourEntries.length === 0) return null;

    // Task 21 (Labour V2 R1) — Devanagari digits, gated on language, exactly
    // the `DailySummaryCard.tsx` precedent. Do not hand-roll a converter.
    const formatCount = (value: number): string =>
        language === 'mr' ? toMarathiNumber(value) : String(value);

    return (
        <div className="mb-6 rounded-2xl border border-orange-200 bg-orange-50/60 p-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    {/* Task 21 — "Labour Review" and the "Total workers: N
                        (breakdown)" line below have NO founder-approved Marathi
                        equivalent anywhere in the codebase (searched
                        i18n/oversightTranslations.ts, i18n/translations.ts,
                        LabourUiKit.tsx, LabourHub.tsx, WeeklyDashboard.tsx).
                        Left in English rather than inventing copy — see the
                        task report's PENDING list for the proposed Marathi. */}
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-700">Labour Review</p>
                    <p className="mt-1 text-sm font-semibold text-stone-700">
                        Total workers: {totalWorkerCount} ({labourEntries.map(entry => entry.count || ((entry.maleCount || 0) + (entry.femaleCount || 0))).join(' + ')})
                    </p>
                </div>
            </div>

            <div className="mt-3 space-y-2">
                {labourEntries.map((entry, index) => {
                    const count = entry.count || ((entry.maleCount || 0) + (entry.femaleCount || 0));
                    return (
                    <div key={`${entry.id}-${index}`} className="rounded-xl border border-orange-100 bg-white/90 px-3 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                            {/* `workSummary.labour` is already-shipped, founder-approved
                                copy — reused as-is from QuickLogSheet.tsx/ReviewInboxSheet.tsx
                                (mr: 'कामगार', en: 'Labour'), never invented here. */}
                            <span className="rounded-full bg-orange-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-orange-700">
                                {entry.activity || t('workSummary.labour')}
                            </span>
                            {/* "{N} मजूर" is LabourHub.tsx's own already-shipped convention
                                for a worker-count line (see `toMr(labour.headcount)} मजूर`) —
                                reused as-is, not invented. */}
                            <span className="text-sm font-bold text-stone-800">
                                {language === 'mr' ? `${formatCount(count)} मजूर` : `${count} workers`}
                            </span>
                        </div>
                        {entry.provenanceVerified === false && (entry.sourceText || entry.systemInterpretation) && (
                            <div
                                data-testid="provenance-unverified-flag"
                                className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50/80 px-2.5 py-1.5"
                            >
                                <HelpCircle size={13} className="mt-0.5 flex-shrink-0 text-amber-500" />
                                <span
                                    className="text-[11px] font-semibold leading-snug text-amber-700"
                                    style={{ fontFamily: MARATHI_BODY }}
                                >
                                    {translateForced('voice.unverifiedSourceLabel', 'mr')}
                                </span>
                            </div>
                        )}
                        {entry.sourceText && (
                            <p className="mt-2 text-xs italic text-stone-500">"{entry.sourceText}"</p>
                        )}
                        {entry.systemInterpretation && (
                            <p className="mt-1 text-[11px] font-medium text-stone-600">{entry.systemInterpretation}</p>
                        )}
                    </div>
                    );
                })}
            </div>
        </div>
    );
};

export default LabourReview;
