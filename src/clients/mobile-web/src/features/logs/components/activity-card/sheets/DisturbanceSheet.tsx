/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The stoppage ("Issues & Blockers") sheet of the activity card — moved out of ActivityCard.tsx unchanged in
 * behaviour so the card stays under the file-size cap, and given his language (PLR-D10 I13, LP-27).
 */
import React from 'react';
import { AlertTriangle, Cloud, Wrench, X, Zap } from 'lucide-react';
import type { DisturbanceEvent } from '../../../../../types';
import { useActivityCardStrings } from '../activityCardStrings';

const SCOPE_COLOURS = {
    FULL_DAY: 'bg-red-50 border-red-200 text-red-800',
    PARTIAL: 'bg-amber-50 border-amber-200 text-amber-800',
    DELAYED: 'bg-yellow-50 border-yellow-200 text-yellow-800',
} as const;

const iconFor = (group: string = '') => {
    const g = group.toLowerCase();
    if (g.includes('machinery')) return <Wrench className="text-amber-600" size={24} />;
    if (g.includes('electricity') || g.includes('power')) return <Zap className="text-amber-600" size={24} />;
    if (g.includes('weather') || g.includes('rain')) return <Cloud className="text-blue-600" size={24} />;
    return <AlertTriangle className="text-amber-600" size={24} />;
};

const DisturbanceSheet: React.FC<{ disturbance: DisturbanceEvent; onClose: () => void }> = ({ disturbance, onClose }) => {
    const s = useActivityCardStrings();
    const interpretation = s.shown(disturbance.systemInterpretation);
    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end justify-center">
            <div className="bg-white rounded-t-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom-6 fade-in-20" data-testid="disturbance-sheet">
                {/* Header */}
                <div className="sticky top-0 bg-white border-b border-stone-200 p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        {iconFor(disturbance.group)}
                        <div>
                            <h3 className="font-bold text-lg text-stone-800">{s.blockers}</h3>
                            <p className="text-xs text-stone-500">{s.disturbanceKind(disturbance.group)}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-stone-100 rounded-full">
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4">
                    <div className={`inline-block px-3 py-1.5 rounded-full text-sm font-bold border ${SCOPE_COLOURS[disturbance.scope || 'PARTIAL']}`}>
                        {s.scope(disturbance.scope)}
                    </div>

                    <div className="bg-stone-50 rounded-xl p-4 border border-stone-200">
                        <div className="text-xs font-bold text-stone-500 uppercase mb-1">{s.reason}</div>
                        <div className="text-base text-stone-800 font-medium">{disturbance.reason || s.notSpecified}</div>
                    </div>

                    {disturbance.note && (
                        <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
                            <div className="text-xs font-bold text-amber-700 uppercase mb-1">{s.details}</div>
                            <div className="text-sm text-stone-700">{disturbance.note}</div>
                        </div>
                    )}

                    {disturbance.blockedSegments && disturbance.blockedSegments.length > 0 && (
                        <div className="bg-stone-50 rounded-xl p-4 border border-stone-200">
                            <div className="text-xs font-bold text-stone-500 uppercase mb-2">{s.affectedAreas}</div>
                            <div className="flex flex-wrap gap-2">
                                {disturbance.blockedSegments.map((seg, idx) => (
                                    <span key={idx} className="px-3 py-1 bg-white rounded-lg text-xs font-medium text-stone-700 border border-stone-200">
                                        {s.segment(seg)}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {(disturbance.sourceText || interpretation) && (
                        <div className="bg-gradient-to-br from-slate-50 to-stone-50 rounded-xl p-4 border border-stone-200">
                            <div className="text-xs font-bold text-stone-500 uppercase mb-2">{s.youSaidSheet}</div>
                            {disturbance.sourceText && (
                                <div className="text-sm italic text-stone-600 mb-2">"{disturbance.sourceText}"</div>
                            )}
                            {interpretation && (
                                <div className="text-xs text-stone-500 mt-1">
                                    <span className="font-bold">{s.interpretation}</span> {interpretation}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DisturbanceSheet;
