import React from 'react';
import { HelpCircle, Mic, Edit3, X } from 'lucide-react';
import { UnclearSegment } from '../../../features/logs/logs.types';
import { UNCLEAR_MESSAGES } from '../../utils/marathiPrompts';

interface UnclearSegmentCardProps {
    segment: UnclearSegment;
    onRelog: (segmentId: string) => void;
    onManualEdit: (segmentId: string) => void;
    onDismiss: (segmentId: string) => void;
}

const UnclearSegmentCard: React.FC<UnclearSegmentCardProps> = ({
    segment,
    onRelog,
    onManualEdit,
    onDismiss
}) => {
    const message = UNCLEAR_MESSAGES[segment.reason] || UNCLEAR_MESSAGES.unknown;

    return (
        <div className="unclear-segment-card bg-gradient-to-br from-amber-50 to-emerald-50/60 border border-amber-200 rounded-2xl p-4 mb-3 border-l-4 border-l-amber-300 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shadow-sm">
                    <HelpCircle className="text-amber-600" size={18} />
                </div>
                <span className="text-sm font-semibold text-amber-800">
                    मला हे नीट कळलं नाही
                </span>
            </div>

            <div className="bg-white rounded-xl p-3 mb-3 border border-amber-100 shadow-inner">
                <p className="text-base text-slate-700 leading-relaxed font-medium">
                    <span className="bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded">
                        "{segment.rawText}"
                    </span>
                </p>
            </div>

            <div className="mb-3">
                <p className="text-sm text-amber-800 font-medium mb-1">
                    {segment.userMessage}
                </p>
                {segment.userMessageEn && (
                    <p className="text-xs text-stone-500">
                        {segment.userMessageEn}
                    </p>
                )}
            </div>

            {message.suggestion && (
                <div className="bg-white/70 rounded-lg p-2.5 mb-4 border border-amber-100/70">
                    <p className="text-xs text-amber-700 flex items-start gap-1.5 font-medium">
                        <span>•</span>
                        <span>{message.suggestion}</span>
                    </p>
                </div>
            )}

            <div className="flex gap-2">
                <button
                    onClick={() => onRelog(segment.id)}
                    className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 text-white py-2.5 px-4 rounded-xl font-medium text-sm hover:bg-emerald-700 active:bg-emerald-800 transition-colors shadow-sm"
                >
                    <Mic size={16} />
                    <span>पुन्हा बोला</span>
                </button>

                <button
                    onClick={() => onManualEdit(segment.id)}
                    className="flex items-center justify-center gap-2 bg-white text-emerald-700 py-2.5 px-4 rounded-xl font-medium text-sm border border-emerald-200 hover:bg-emerald-50 active:bg-emerald-100 transition-colors shadow-sm"
                >
                    <Edit3 size={16} />
                    <span>लिहा</span>
                </button>

                <button
                    onClick={() => onDismiss(segment.id)}
                    className="flex items-center justify-center text-stone-400 p-2.5 rounded-xl hover:bg-stone-100 hover:text-stone-600 transition-colors"
                    title="नको, सोडून द्या"
                >
                    <X size={18} />
                </button>
            </div>
        </div>
    );
};

export default UnclearSegmentCard;
