/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Transcript Timeline Component
 * Displays farmer's logs chronologically for emotional connection
 * Uses CropSymbol for consistent crop image display across the app
 * Supports clicking entries to load them for editing
 */

import React, { useState } from 'react';
import { Clock, FileText, ChevronDown, ChevronUp, Edit3, Keyboard } from 'lucide-react';
import { LogTimelineEntry } from '../logs.types';
import { CropSymbol } from '../../context/components/CropSelector';

// ============================================
// TRANSCRIPT ENTRY COMPONENT
// ============================================

interface TranscriptEntryProps {
    entry: LogTimelineEntry;
    onClick?: (logId: string) => void;
}

const TranscriptEntry: React.FC<TranscriptEntryProps> = ({ entry, onClick }) => {
    const isClickable = !!onClick;

    return (
        <div
            className={`bg-slate-50/80 rounded-xl p-3 border border-slate-100 transition-all duration-200 ${isClickable
                    ? 'hover:border-emerald-300 hover:shadow-md hover:bg-emerald-50/30 cursor-pointer group'
                    : 'hover:border-slate-200 hover:shadow-sm'
                }`}
            onClick={() => onClick?.(entry.logId)}
        >
            {/* Time + Source Row */}
            <div className="flex items-center gap-2 mb-2">
                <Clock size={12} className="text-slate-400" />
                <span className="text-xs font-semibold text-slate-500">
                    {entry.displayTime}
                </span>
                {entry.source === 'VOICE' && (
                    <span className="text-[10px] bg-purple-100/70 text-purple-700 px-1.5 py-0.5 rounded-full font-semibold">
                        🎙️ Voice
                    </span>
                )}
                {entry.source === 'MANUAL' && (
                    <span className="text-[10px] bg-blue-100/70 text-blue-700 px-1.5 py-0.5 rounded-full font-semibold flex items-center gap-0.5">
                        <Keyboard size={10} /> Manual
                    </span>
                )}

                {/* Edit indicator on hover */}
                {isClickable && (
                    <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                        <Edit3 size={10} /> Tap to Edit
                    </span>
                )}
            </div>

            {/* Crop Context Chips - Using CropSymbol for consistency */}
            <div className="flex flex-wrap gap-1.5 mb-2">
                {entry.contexts.slice(0, 3).map((ctx, idx) => (
                    <span
                        key={idx}
                        className="inline-flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-200 shadow-sm"
                    >
                        {/* Crop Image (xs size = 16x16) */}
                        <span className="flex-shrink-0 w-4 h-4 rounded-full overflow-hidden flex items-center justify-center bg-slate-50">
                            <CropSymbol name={ctx.cropIconName} size="xs" />
                        </span>
                        <span className="text-xs font-semibold text-slate-700">{ctx.cropName}</span>
                        {ctx.plotName && (
                            <span className="text-[10px] text-slate-400 font-medium">• {ctx.plotName}</span>
                        )}
                    </span>
                ))}
                {entry.contexts.length > 3 && (
                    <span className="text-xs text-slate-400 font-medium self-center">
                        +{entry.contexts.length - 3} more
                    </span>
                )}
            </div>

            {/* Transcript - The emotional connection (farmer's own words) */}
            {entry.displayTranscript && (
                <p className="text-sm text-slate-700 leading-relaxed bg-white/50 px-2 py-1.5 rounded-lg border-l-2 border-slate-200 italic">
                    "{entry.displayTranscript}"
                </p>
            )}

            {/* Micro summary - what was logged (compact badges) */}
            <div className="flex flex-wrap gap-1 mt-2">
                {entry.loggedItems.activities > 0 && (
                    <span className="text-[10px] bg-emerald-100/70 text-emerald-700 px-1.5 py-0.5 rounded-full font-semibold">
                        {entry.loggedItems.activities} activity
                    </span>
                )}
                {entry.loggedItems.observations > 0 && (
                    <span className="text-[10px] bg-sky-100/70 text-sky-700 px-1.5 py-0.5 rounded-full font-semibold">
                        {entry.loggedItems.observations} note
                    </span>
                )}
                {entry.loggedItems.irrigation > 0 && (
                    <span className="text-[10px] bg-cyan-100/70 text-cyan-700 px-1.5 py-0.5 rounded-full font-semibold">
                        💧 irrigation
                    </span>
                )}
                {entry.loggedItems.labour > 0 && (
                    <span className="text-[10px] bg-amber-100/70 text-amber-700 px-1.5 py-0.5 rounded-full font-semibold">
                        {entry.loggedItems.labour} labour
                    </span>
                )}
                {entry.loggedItems.expenses > 0 && (
                    <span className="text-[10px] bg-red-100/70 text-red-700 px-1.5 py-0.5 rounded-full font-semibold">
                        ₹ {entry.loggedItems.expenses} expense
                    </span>
                )}
            </div>
        </div>
    );
};

// ============================================
// TRANSCRIPT TIMELINE COMPONENT
// ============================================

interface TranscriptTimelineProps {
    entries: LogTimelineEntry[];
    maxDisplay?: number;
    onEntryClick?: (logId: string) => void;
}

const TranscriptTimeline: React.FC<TranscriptTimelineProps> = ({
    entries,
    maxDisplay = 3,
    onEntryClick
}) => {
    const [expanded, setExpanded] = useState(false);
    const displayEntries = expanded ? entries : entries.slice(0, maxDisplay);

    if (entries.length === 0) return null;

    return (
        <div className="mt-3 pt-3 border-t border-slate-100">
            {/* Header */}
            <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5 uppercase tracking-wide">
                    <FileText size={13} className="text-slate-400" />
                    Today's Logs ({entries.length})
                </span>
                {entries.length > maxDisplay && (
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="text-xs text-blue-600 font-bold flex items-center gap-0.5 hover:text-blue-700 transition-colors px-2 py-1 rounded-lg hover:bg-blue-50"
                    >
                        {expanded ? (
                            <>Show less <ChevronUp size={14} /></>
                        ) : (
                            <>+{entries.length - maxDisplay} more <ChevronDown size={14} /></>
                        )}
                    </button>
                )}
            </div>

            {/* Timeline Entries */}
            <div className="space-y-2">
                {displayEntries.map((entry) => (
                    <TranscriptEntry
                        key={entry.id}
                        entry={entry}
                        onClick={onEntryClick}
                    />
                ))}
            </div>
        </div>
    );
};

export default TranscriptTimeline;
export { TranscriptEntry };
