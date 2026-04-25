import React from 'react';
import { FarmContext, TodayCounts, CropProfile } from '../../../types';
import { MapPin, Calendar, CheckSquare, Droplets, Users, Package, Tractor, DollarSign, Bell, MessageSquare } from 'lucide-react';
import { CropSymbol } from './CropSelector';
import { getCropTheme } from '../../../shared/utils/colorTheme';

interface ContextBannerProps {
    date: string;
    context: FarmContext | null;
    activeCrop: CropProfile | undefined;
    activePlotName: string | undefined;
    todayCounts: TodayCounts;
}

const ContextBanner: React.FC<ContextBannerProps> = ({
    date,
    context,
    activeCrop,
    activePlotName,
    todayCounts,
}) => {

    const formatDate = (d: string) => {
        return new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
    };

    // --- DERIVE THEME ---
    // If multiple crops are mixed, fallback to neutral. If single crop (or multiple plots of same crop), use that crop's theme.
    // However, 'activeCrop' is passed from ManualEntry which seems to only support 1 crop for now. 
    // If context has multiple crops, activeCrop might be undefined or just the first one. 
    // Let's rely on props passed.

    const theme = activeCrop ? getCropTheme(activeCrop.color) : getCropTheme('bg-slate-500');
    const workDoneCount = todayCounts.cropActivities
        + todayCounts.irrigation
        + todayCounts.labour
        + todayCounts.inputs
        + todayCounts.machinery
        + todayCounts.activityExpenses;

    // Stats Helper
    const StatBadge = ({ label, count, colorClass, bgClass, borderClass }: { label: string, count: number, colorClass: string, bgClass: string, borderClass: string }) => {
        if (count === 0) return null;
        return (
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border shadow-sm ${bgClass} ${borderClass}`}>
                <span className={`text-[10px] font-bold uppercase tracking-wider opacity-80 ${colorClass}`}>{label}</span>
                <span className={`text-[11px] font-black ${colorClass}`}>{count}</span>
            </div>
        );
    };

    return (
        <div className="mb-6 animate-in fade-in slide-in-from-top-2">
            {/* MAIN CARD */}
            <div className={`
                relative overflow-hidden rounded-3xl bg-white
                border border-slate-100/60
                shadow-xl ${theme.shadow} 
                transition-all duration-300
            `}>
                {/* GLOSSY BACKGROUND ACCENT */}
                <div className={`absolute top-0 right-0 w-64 h-64 ${theme.bg} opacity-[0.07] rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none`} />

                <div className="relative z-10 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">

                    {/* LEFT: ICON & INFO */}
                    <div className="flex items-center gap-4">
                        {/* 3D GLASS ICON CONTAINER */}
                        <div className={`
                            relative w-16 h-16 rounded-2xl flex items-center justify-center shrink-0
                            bg-gradient-to-br from-white to-slate-50
                            shadow-lg border border-white/50
                        `}>
                            {/* Inner Color Ring */}
                            <div className={`absolute inset-0 rounded-2xl border-[3px] opacity-20 ${theme.border}`} />
                            <div className="relative z-10 transform ml-0.5 mt-0.5">
                                {activeCrop ? <CropSymbol name={activeCrop.iconName} size="md" /> : <MapPin size={28} className="text-slate-400" />}
                            </div>
                        </div>

                        <div>
                            {/* Date Badge */}
                            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">
                                <Calendar size={11} className="text-slate-300" />
                                {formatDate(date)}
                            </div>

                            {/* PLOT NAME - Glassmorphed Tag look */}
                            <h2 className="text-xl font-black text-slate-800 leading-tight">
                                <span className={`
                                    relative inline-block z-10
                                    after:absolute after:inset-0 after:-z-10 after:bg-gradient-to-r after:${theme.slideBgSelected} after:opacity-20 after:-skew-x-6 after:rounded-md
                                    px-1 -ml-1
                                `}>
                                    {activePlotName || 'Multiple Selection'}
                                </span>
                            </h2>

                            {/* Crop & Phase */}
                            <div className="flex items-center gap-2 mt-1">
                                {activeCrop && (
                                    <span className={`text-sm font-bold ${theme.text}`}>
                                        {activeCrop.name}
                                    </span>
                                )}
                                {/* If we had Phase info explicitly passed, show it here. For now, mimicking structure */}
                            </div>
                        </div>
                    </div>

                    {/* RIGHT: STATS PILLS (Compact & Icon Only) */}
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        {/* Define Stat Config locally or outside */}
                        {[
                            { key: 'workDone', label: 'Work Done', count: workDoneCount, icon: <CheckSquare size={14} />, color: 'text-emerald-600', bg: 'bg-emerald-50', ring: 'ring-emerald-100' },
                            { key: 'irrigation', label: 'Irrigation', count: todayCounts.irrigation, icon: <Droplets size={14} />, color: 'text-blue-600', bg: 'bg-blue-50', ring: 'ring-blue-100' },
                            { key: 'inputs', label: 'Inputs', count: todayCounts.inputs, icon: <Package size={14} />, color: 'text-purple-600', bg: 'bg-purple-50', ring: 'ring-purple-100' },
                            { key: 'labour', label: 'Labour', count: todayCounts.labour, icon: <Users size={14} />, color: 'text-orange-600', bg: 'bg-orange-50', ring: 'ring-orange-100' },
                            { key: 'machinery', label: 'Machinery', count: todayCounts.machinery, icon: <Tractor size={14} />, color: 'text-stone-600', bg: 'bg-stone-50', ring: 'ring-stone-100' },
                            { key: 'expenses', label: 'Expenses', count: todayCounts.activityExpenses, icon: <DollarSign size={14} />, color: 'text-rose-600', bg: 'bg-rose-50', ring: 'ring-rose-100' },
                            { key: 'tasks', label: 'Tasks', count: todayCounts.reminders, icon: <Bell size={14} />, color: 'text-indigo-600', bg: 'bg-indigo-50', ring: 'ring-indigo-100' },
                            { key: 'observations', label: 'Observations', count: todayCounts.observations, icon: <MessageSquare size={14} />, color: 'text-amber-600', bg: 'bg-amber-50', ring: 'ring-amber-100' },
                        ].map(stat => {
                            const count = stat.count || 0;
                            // ALWAYS show icons? Or only if active? User said "show first 6 Buckets... in front of those icons"
                            // If count is 0, maybe dim it? Let's show all 6 but dim 0s.
                            const isActive = count > 0;

                            return (
                                <div key={stat.key} title={stat.label} aria-label={`${stat.label}: ${count}`} className={`
                                    flex items-center gap-1.5 px-2 py-1.5 rounded-lg border transition-all duration-300
                                    ${isActive ? `${stat.bg} ${stat.color} border-transparent ring-1 ${stat.ring}` : 'bg-slate-50 text-slate-300 border-slate-100'}
                                `}>
                                    <span className={`text-[11px] font-black leading-none ${isActive ? stat.color : 'text-slate-300'}`}>
                                        {count}
                                    </span>
                                    {stat.icon}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ContextBanner;
