import React from 'react';
import { StatusBadge } from './StatusBadge';
import { SyncIndicator } from './SyncIndicator';
import { LogVerificationStatus } from '../../../domain/types/log.types';
import { useLanguage } from '../../../i18n/LanguageContext';

interface LogCardProps {
    date: Date;
    summary: string;
    status: LogVerificationStatus;
    syncStatus: 'SAVED' | 'PENDING' | 'SYNCED' | 'CONFLICT';
    operatorName: string;
    onClick?: () => void;
    // Dynamic content slots
    details?: React.ReactNode;
}

export const LogCard: React.FC<LogCardProps> = ({
    date,
    summary,
    status,
    syncStatus,
    operatorName,
    onClick,
    details
}) => {
    const { t } = useLanguage();

    return (
        <div
            onClick={onClick}
            className="group relative overflow-hidden bg-white rounded-2xl p-5 shadow-soft hover:shadow-medium border border-stone-100 transition-all duration-300 active:scale-[0.98] cursor-pointer"
        >
            {/* Header: Date & Sync Status */}
            <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-stone-400 uppercase tracking-widest font-display">
                    {date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                </span>
                <SyncIndicator status={syncStatus} />
            </div>

            {/* Main Content */}
            <div className="mb-4 relative z-10">
                <h3 className="text-lg font-bold text-stone-800 line-clamp-2 leading-relaxed font-display group-hover:text-emerald-800 transition-colors">
                    {summary}
                </h3>
                {details && (
                    <div className="mt-2 text-sm text-stone-500 font-medium">
                        {details}
                    </div>
                )}
            </div>

            {/* Footer: Operator & Status */}
            <div className="flex items-center justify-between pt-3 border-t border-stone-50 relative z-10">
                <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center text-[10px] font-bold border border-emerald-100">
                        {operatorName.charAt(0)}
                    </div>
                    <span className="text-xs text-stone-500 font-semibold">{operatorName}</span>
                </div>
                <StatusBadge status={status} size="sm" />
            </div>

            {/* Decorative Background Gradient (Subtle) */}
            <div className="absolute inset-0 bg-gradient-to-br from-white via-white to-stone-50 opacity-50 z-0" />

            {/* Hover Highlight */}
            <div className="absolute inset-0 border-2 border-transparent group-hover:border-emerald-500/10 rounded-2xl transition-colors pointer-events-none" />
        </div>
    );
};
