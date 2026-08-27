/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { HelpCircle } from 'lucide-react';
import { LabourEvent } from '../../../../../types';
import { t as translateForced } from '../../../../../i18n/translations';

// Font rule (CHARTER): Marathi body text -> Noto Sans Devanagari. The
// "not certain I heard this" flag is Marathi copy shown inline with the
// farmer's own transcript quote, so it must set this explicitly.
const MARATHI_BODY = "'Noto Sans Devanagari', sans-serif";

interface LabourReviewProps {
    labourEntries: LabourEvent[];
    totalWorkerCount: number;
}

const LabourReview: React.FC<LabourReviewProps> = ({ labourEntries, totalWorkerCount }) => {
    if (labourEntries.length === 0) return null;

    return (
        <div className="mb-6 rounded-2xl border border-orange-200 bg-orange-50/60 p-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-700">Labour Review</p>
                    <p className="mt-1 text-sm font-semibold text-stone-700">
                        Total workers: {totalWorkerCount} ({labourEntries.map(entry => entry.count || ((entry.maleCount || 0) + (entry.femaleCount || 0))).join(' + ')})
                    </p>
                </div>
            </div>

            <div className="mt-3 space-y-2">
                {labourEntries.map((entry, index) => (
                    <div key={`${entry.id}-${index}`} className="rounded-xl border border-orange-100 bg-white/90 px-3 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-orange-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-orange-700">
                                {entry.activity || 'Labour'}
                            </span>
                            <span className="text-sm font-bold text-stone-800">
                                {entry.count || ((entry.maleCount || 0) + (entry.femaleCount || 0))} workers
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
                ))}
            </div>
        </div>
    );
};

export default LabourReview;
