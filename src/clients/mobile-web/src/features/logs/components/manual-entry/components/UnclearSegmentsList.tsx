/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import UnclearSegmentCard from '../../../../../shared/components/ui/UnclearSegmentCard';
import { UnclearSegment } from '../../../../logs/logs.types';

interface UnclearSegmentsListProps {
    unclearSegments: UnclearSegment[];
    correctionId: string | null;
    correctionText: string;
    setCorrectionText: (value: string) => void;
    onDismiss: (id: string) => void;
    onManualEdit: (id: string) => void;
    onSubmitCorrection: () => void;
}

const UnclearSegmentsList: React.FC<UnclearSegmentsListProps> = ({
    unclearSegments,
    correctionId,
    correctionText,
    setCorrectionText,
    onDismiss,
    onManualEdit,
    onSubmitCorrection,
}) => {
    if (unclearSegments.length === 0) return null;

    return (
        <div className="mb-6 space-y-2 animate-in slide-in-from-top-4">
            {unclearSegments.map(seg => (
                <div key={seg.id}>
                    <UnclearSegmentCard
                        segment={seg}
                        onRelog={(id) => {
                            // Simple reset for now, essentially dismiss + user can speak again globally
                            onDismiss(id);
                        }}
                        onManualEdit={onManualEdit}
                        onDismiss={onDismiss}
                    />
                    {/* Correction Input Overlay */}
                    {correctionId === seg.id && (
                        <div className="ml-4 mr-4 -mt-2 mb-4 bg-white p-3 rounded-b-xl border-x border-b border-red-100 shadow-sm animate-in fade-in">
                            <label className="text-xs font-bold text-slate-500 mb-1 block">Correct Meaning:</label>
                            <div className="flex gap-2">
                                <input
                                    autoFocus
                                    type="text"
                                    value={correctionText}
                                    onChange={e => setCorrectionText(e.target.value)}
                                    className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
                                    placeholder="What did you mean?"
                                />
                                <button
                                    onClick={onSubmitCorrection}
                                    className="bg-emerald-600 text-white px-3 py-2 rounded-lg text-xs font-bold"
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};

export default UnclearSegmentsList;
