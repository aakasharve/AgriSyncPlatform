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
        <div className="unclear-segment-card bg-gradient-to-br from-red-50 to-red-100/50 
                        border border-red-200 rounded-2xl p-4 mb-3
                        border-l-4 border-l-red-400 shadow-sm">

            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center shadow-sm">
                    <HelpCircle className="text-red-500" size={18} />
                </div>
                <span className="text-sm font-semibold text-red-700">
                    समजलं नाही
                </span>
            </div>

            {/* The unclear text - highlighted */}
            <div className="bg-white rounded-xl p-3 mb-3 border border-red-100 shadow-inner">
                <p className="text-base text-slate-700 leading-relaxed font-medium">
                    <span className="bg-red-50 text-red-700 px-1.5 py-0.5 rounded">
                        "{segment.rawText}"
                    </span>
                </p>
            </div>

            {/* Empathetic message */}
            <div className="mb-3">
                <p className="text-sm text-red-700 font-medium mb-1">
                    {segment.userMessage}
                </p>
                {segment.userMessageEn && (
                    <p className="text-xs text-red-400">
                        {segment.userMessageEn}
                    </p>
                )}
            </div>

            {/* Suggestion hint */}
            {message.suggestion && (
                <div className="bg-white/60 rounded-lg p-2.5 mb-4 border border-red-100/50">
                    <p className="text-xs text-red-500 flex items-start gap-1.5 font-medium">
                        <span>💡</span>
                        <span>{message.suggestion}</span>
                    </p>
                </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">

                {/* Primary: Re-log with voice */}
                <button
                    onClick={() => onRelog(segment.id)}
                    className="flex-1 flex items-center justify-center gap-2 
                               bg-red-500 text-white py-2.5 px-4 rounded-xl
                               font-medium text-sm 
                               hover:bg-red-600 active:bg-red-700
                               transition-colors shadow-sm"
                >
                    <Mic size={16} />
                    <span>पुन्हा बोला</span>
                </button>

                {/* Secondary: Manual entry */}
                <button
                    onClick={() => onManualEdit(segment.id)}
                    className="flex items-center justify-center gap-2
                               bg-white text-red-600 py-2.5 px-4 rounded-xl
                               font-medium text-sm border border-red-200
                               hover:bg-red-50 active:bg-red-100
                               transition-colors shadow-sm"
                >
                    <Edit3 size={16} />
                    <span>लिहा</span>
                </button>

                {/* Tertiary: Dismiss */}
                <button
                    onClick={() => onDismiss(segment.id)}
                    className="flex items-center justify-center
                               text-red-300 p-2.5 rounded-xl
                               hover:bg-red-50 hover:text-red-400
                               transition-colors"
                    title="नको, सोडून द्या"
                >
                    <X size={18} />
                </button>
            </div>
        </div>
    );
};

export default UnclearSegmentCard;
