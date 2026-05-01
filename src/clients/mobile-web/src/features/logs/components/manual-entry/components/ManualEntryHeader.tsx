/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Users, Edit3, StickyNote } from 'lucide-react';
import ContextBanner from '../../../../context/components/ContextBanner';
import TranscriptTimeline from '../../TranscriptTimeline';
import MultiTargetDestinationCard from './MultiTargetDestinationCard';
import {
    FarmContext, CropProfile, FarmerProfile, LogTimelineEntry, DailyLog
} from '../../../../../types';
import type { TargetSelectionGroup } from '../types';

interface ManualEntryHeaderProps {
    context: FarmContext;
    activeCrop: CropProfile | undefined;
    selectedPlotSummary: string;
    currentCounts: any;
    selectedPlotIds: string[];
    selectedTargetGroups: TargetSelectionGroup[];
    profile: FarmerProfile;
    selectedLogId: string | null;
    todayLogs: DailyLog[];
    transcriptEntries: LogTimelineEntry[];
    onLogSelect: (logId: string) => void;
    onCancelEdit: () => void;
    transcript: string;
    setTranscript: (value: string) => void;
    /**
     * Slot for the unclear segments block. Rendered between the timeline and
     * the mode header inside the .space-y-4 wrapper to preserve original DOM
     * structure and spacing.
     */
    unclearSegmentsSlot?: React.ReactNode;
}

const ManualEntryHeader: React.FC<ManualEntryHeaderProps> = ({
    context,
    activeCrop,
    selectedPlotSummary,
    currentCounts,
    selectedPlotIds,
    selectedTargetGroups,
    profile,
    selectedLogId,
    todayLogs,
    transcriptEntries,
    onLogSelect,
    onCancelEdit,
    transcript,
    setTranscript,
    unclearSegmentsSlot,
}) => {
    return (
        <>
            {/* CONTEXT BANNER */}
            {/* HEADER CONTEXT BANNER */}
            <ContextBanner
                date={new Date().toISOString()}
                context={context}
                activeCrop={activeCrop}
                activePlotName={selectedPlotSummary}
                todayCounts={currentCounts as any}
            />

            {selectedPlotIds.length > 1 && (
                <MultiTargetDestinationCard groups={selectedTargetGroups} />
            )}

            {/* OPERATOR ATTRIBUTION */}
            <div className="px-4 py-2 flex justify-between items-center text-xs text-slate-500 bg-slate-50/50 border-b border-slate-100 mb-4 mx-4 rounded-b-xl -mt-2 pt-4">
                <div className="flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-slate-400" />
                    <span>Logging as: <strong className="text-slate-700">{profile.operators.find(op => op.id === profile.activeOperatorId)?.name || 'Unknown'}</strong></span>
                </div>
                {selectedLogId && (
                    <div className="flex items-center gap-1.5 bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full border border-amber-100">
                        <Edit3 className="w-3 h-3" />
                        <span>Editing Log by: <strong>{profile.operators.find(op => op.id === todayLogs.find(l => l.id === selectedLogId)?.meta?.createdByOperatorId)?.name || 'Unknown'}</strong></span>
                    </div>
                )}
            </div>

            {/* Editing indicator removed in favor of integrated header */}

            {/* HEADER & TIMELINE SECTION */}
            <div className="space-y-4 mb-6">
                {/* TODAY'S PAST LOGS TIMELINE */}
                {transcriptEntries.length > 0 && (
                    <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm animate-in slide-in-from-top-2">
                        <TranscriptTimeline
                            entries={transcriptEntries}
                            maxDisplay={3}
                            onEntryClick={onLogSelect}
                        />
                    </div>
                )}

                {/* UNCLEAR SEGMENTS CARD STACK */}
                {unclearSegmentsSlot}

                {/* MODE HEADER */}
                {/* MODE HEADER - Only show when editing */}
                {selectedLogId && (
                    <div className="flex items-center justify-between px-1 mb-2">
                        <div className="flex items-center gap-2">
                            <div className="p-2 rounded-xl bg-amber-100 text-amber-700">
                                <Edit3 size={18} />
                            </div>
                            <div>
                                <h3 className="font-bold text-sm uppercase tracking-wider text-amber-700">
                                    Fixing Past Record
                                </h3>
                                <p className="text-[10px] text-stone-400 font-medium">
                                    Changes will update this log
                                </p>
                            </div>
                        </div>

                        <button
                            onClick={onCancelEdit}
                            className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-lg font-bold transition-colors"
                        >
                            Cancel Edit
                        </button>
                    </div>
                )}

                {/* TRANSCRIPT EDITOR (If present) */}
                {transcript && (
                    <div className={`bg-white border rounded-2xl p-4 shadow-sm relative group transition-colors ${selectedLogId ? 'border-amber-200 bg-amber-50/10' : 'border-emerald-100'}`}>
                        <div className={`flex items-center gap-2 mb-2 ${selectedLogId ? 'text-amber-700' : 'text-emerald-700'}`}>
                            <StickyNote size={14} />
                            <span className="text-xs font-bold uppercase tracking-wider">Voice Transcript</span>
                        </div>
                        <textarea
                            value={transcript}
                            onChange={(e) => setTranscript(e.target.value)}
                            className="w-full text-lg font-medium text-stone-700 bg-transparent border-none outline-none resize-none p-0 leading-relaxed placeholder:text-stone-300 focus:ring-0"
                            rows={Math.max(2, Math.ceil(transcript.length / 40))}
                        />
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="text-[10px] bg-stone-100 text-stone-500 px-2 py-1 rounded-full font-bold">Editable</span>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
};

export default ManualEntryHeader;
