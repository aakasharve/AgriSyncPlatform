/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { MessageSquare, AlertCircle, Lightbulb, Bell, Info } from 'lucide-react';
import { ObservationNote, LogVerificationStatus } from '../../../types';
import TrustBadge from '../../../shared/components/ui/TrustBadge';

interface ObservationEventCardProps {
    observation: ObservationNote;
    cropName?: string;
    plotName?: string;
    verificationStatus?: LogVerificationStatus;
}

const ObservationEventCard: React.FC<ObservationEventCardProps> = ({
    observation,
    cropName,
    plotName,
    verificationStatus
}) => {

    // Visual styling based on type and severity
    const getVisualStyle = () => {
        const baseClasses = "border-2 rounded-xl p-4 transition-all";

        // Severity-based border
        const severityBorder = {
            'urgent': 'border-red-300 bg-red-50',
            'important': 'border-amber-300 bg-amber-50',
            'normal': 'border-stone-200 bg-stone-50'
        }[observation.severity];

        return `${baseClasses} ${severityBorder}`;
    };

    // Icon based on note type
    const getIcon = () => {
        const iconClasses = "flex-shrink-0";
        const color = {
            'urgent': 'text-red-600',
            'important': 'text-amber-600',
            'normal': 'text-stone-600'
        }[observation.severity];

        const Icon = {
            'issue': AlertCircle,
            'tip': Lightbulb,
            'reminder': Bell,
            'observation': Info,
            'unknown': MessageSquare
        }[observation.noteType];

        return <Icon className={`${iconClasses} ${color}`} size={20} />;
    };

    // Type label
    const getTypeLabel = () => {
        return {
            'issue': 'Issue',
            'tip': 'Tip',
            'reminder': 'Reminder',
            'observation': 'Observation',
            'unknown': 'Note'
        }[observation.noteType];
    };

    const displayText = observation.textCleaned || observation.textRaw;

    return (
        <div className={getVisualStyle()}>
            <div className="flex items-start gap-3">
                {getIcon()}

                <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-bold uppercase tracking-wide text-stone-500">
                            {getTypeLabel()}
                        </span>

                        {observation.severity !== 'normal' && (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${observation.severity === 'urgent'
                                ? 'bg-red-200 text-red-700'
                                : 'bg-amber-200 text-amber-700'
                                }`}>
                                {observation.severity}
                            </span>
                        )}

                        {observation.source === 'voice' && (
                            <span className="text-[10px] text-stone-400 font-medium">
                                🎙️ Voice
                            </span>
                        )}

                        {verificationStatus && <TrustBadge status={verificationStatus} size="sm" />}
                    </div>

                    {/* Content */}
                    <p className="text-sm text-stone-800 leading-relaxed mb-2">
                        {displayText}
                    </p>

                    {/* Tags */}
                    {observation.tags && observation.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            {observation.tags.map((tag, idx) => (
                                <span
                                    key={idx}
                                    className="text-[10px] bg-white border border-stone-200 text-stone-600 px-2 py-0.5 rounded-full font-medium"
                                >
                                    {tag}
                                </span>
                            ))}
                        </div>
                    )}

                    {/* Context info */}
                    {(cropName || plotName) && (
                        <div className="mt-2 pt-2 border-t border-stone-200 text-[10px] text-stone-400">
                            {cropName && plotName && `${cropName} • ${plotName}`}
                            {cropName && !plotName && cropName}
                            {!cropName && plotName && plotName}
                        </div>
                    )}

                    {/* AI confidence indicator (for debugging/trust) */}
                    {observation.aiConfidence !== undefined && observation.aiConfidence < 60 && (
                        <div className="mt-2 text-[9px] text-stone-400 italic">
                            Categorized with {observation.aiConfidence}% confidence
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ObservationEventCard;
