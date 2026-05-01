/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { LabourEvent } from '../../../../../types';

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
