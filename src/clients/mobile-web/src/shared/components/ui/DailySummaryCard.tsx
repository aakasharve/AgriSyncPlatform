import React from 'react';
import { useLanguage } from '../../../i18n/LanguageContext';

interface DailySummaryStats {
    logsCount: number;
    totalSpent: number;
    pendingTasks: number;
    verifiedCount: number;
    unverifiedCount: number;
}

interface DailySummaryCardProps {
    date: string;
    stats: DailySummaryStats;
    onClick?: () => void;
    isToday?: boolean;
    onCloseToday?: () => void; // BH-1
}

export const DailySummaryCard: React.FC<DailySummaryCardProps> = ({
    date,
    stats,
    onClick,
    isToday = false,
    onCloseToday
}) => {
    const { t } = useLanguage();

    return (
        <div
            onClick={onClick}
            className={`
        relative overflow-hidden rounded-3xl p-6 transition-all duration-300 active:scale-[0.97] cursor-pointer group
        ${isToday
                    ? 'bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-lg shadow-emerald-500/30 ring-1 ring-emerald-400/30'
                    : 'bg-white border border-stone-100 shadow-soft hover:shadow-medium hover:border-emerald-100'
                }
      `}
        >
            <div className="flex items-center justify-between mb-5 relative z-10">
                <div>
                    <p className={`text-xs font-bold uppercase tracking-widest mb-1 ${isToday ? 'text-emerald-100' : 'text-stone-400'}`}>
                        {isToday ? t('common.today') : date}
                    </p>
                    <div className="flex items-baseline gap-1.5">
                        <span className={`text-3xl font-display font-extrabold ${isToday ? 'text-white' : 'text-stone-800'}`}>
                            {stats.logsCount}
                        </span>
                        <span className={`text-sm font-medium ${isToday ? 'text-emerald-100' : 'text-stone-500'}`}>
                            {t('dfes.activitiesLogged')}
                        </span>
                    </div>
                </div>

                {/* BH-1: Close Today Button (if today) */}
                {isToday && onCloseToday ? (
                    <button
                        onClick={(e) => { e.stopPropagation(); onCloseToday(); }}
                        className="px-4 py-2 bg-white/20 hover:bg-white/30 backdrop-blur-md text-white text-xs font-bold rounded-full transition-all border border-white/30"
                    >
                        {t('dfes.closeToday')}
                    </button>
                ) : (
                    /* Visual Indicator of "Completeness" for past days */
                    <div className="flex -space-x-2">
                        {stats.unverifiedCount > 0 ? (
                            <div className="w-12 h-12 rounded-full bg-amber-100 border-4 border-white flex items-center justify-center text-amber-600 font-bold shadow-sm">
                                {stats.unverifiedCount}
                            </div>
                        ) : (
                            <div className={`w-12 h-12 rounded-full border-4 border-white flex items-center justify-center shadow-sm ${isToday ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-600'}`}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="flex items-center gap-2 text-sm relative z-10">
                <span className={`px-2.5 py-1 rounded-lg font-bold text-xs ${stats.unverifiedCount > 0
                        ? 'bg-amber-100 text-amber-800'
                        : isToday ? 'bg-white/20 text-white backdrop-blur-sm' : 'bg-surface-100 text-stone-600'
                    }`}>
                    {stats.unverifiedCount > 0
                        ? `${stats.unverifiedCount} ${t('dfes.needsReview')}`
                        : t('dfes.allVerified')}
                </span>
                {stats.totalSpent > 0 && (
                    <span className={`px-2.5 py-1 rounded-lg font-bold text-xs ${isToday ? 'bg-white/20 text-white backdrop-blur-sm' : 'bg-surface-100 text-stone-600'}`}>
                        ₹{stats.totalSpent.toLocaleString()}
                    </span>
                )}
            </div>

            {/* Decorative Background for Today Card */}
            {isToday && (
                <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-emerald-400/30 rounded-full blur-3xl pointer-events-none" />
            )}
        </div>
    );
};
