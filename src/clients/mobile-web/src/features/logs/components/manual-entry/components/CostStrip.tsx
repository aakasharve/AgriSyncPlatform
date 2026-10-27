/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import Button from '../../../../../shared/components/ui/Button';
import { useReviewFormStrings } from '../reviewFormStrings';

interface CostStripProps {
    selectedLogId: string | null;
    manualTotalCost: number | undefined;
    setManualTotalCost: (value: number | undefined) => void;
    onSaveDay: () => void;
}

const CostStrip: React.FC<CostStripProps> = ({
    selectedLogId,
    manualTotalCost,
    setManualTotalCost,
    onSaveDay,
}) => {
    // PLR-D10 I13 (LP-27) — in his language only (reviewFormStrings: English as it was, Marathi approved/proposed).
    const str = useReviewFormStrings();
    return (
        <div className="mt-8 mb-4 max-w-xl mx-auto animate-in slide-in-from-bottom-2 fade-in duration-500">
            <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-2 pl-5 flex items-center justify-between gap-4">

                {/* Input Section */}
                <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="bg-emerald-100 p-2 rounded-full text-emerald-700 shrink-0">
                        <img src="/assets/rupee_gold.png" alt="" className="w-5 h-5" />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] font-bold text-stone-400 leading-none mb-0.5" data-testid="manual-total-label">{str.totalPaid}</span>
                        <div className="flex items-center">
                            <span className="text-stone-400 font-bold mr-1">₹</span>
                            <input
                                type="number"
                                placeholder="0"
                                className="font-bold text-lg text-stone-800 outline-none bg-transparent w-full placeholder:text-stone-300"
                                value={manualTotalCost || ''}
                                onChange={e => setManualTotalCost(parseFloat(e.target.value))}
                            />
                        </div>
                    </div>
                </div>

                {/* Action Button */}
                <Button
                    onClick={onSaveDay}
                    data-testid="manual-save-button"
                    className={`rounded-xl px-8 py-4 text-white shadow-lg shrink-0 whitespace-nowrap text-lg font-bold transition-colors ${selectedLogId
                        ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-200'
                        : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200'
                        }`}
                >
                    {selectedLogId ? str.saveEdit : str.saveNew}
                </Button>
            </div>
        </div>
    );
};

export default CostStrip;
