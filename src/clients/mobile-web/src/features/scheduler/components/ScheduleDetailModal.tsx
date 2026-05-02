import React from 'react';
import { X, Calendar, Droplets, Sprout, SprayCan, Hammer, Clock, AlertCircle } from 'lucide-react';
import { BlockStatus } from './DayCard';
import { DailyLog } from '../../../types';

export interface ScheduleDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    data: {
        dateLabel: string;
        dayNumber: number;
        category: 'IRRIGATION' | 'NUTRITION' | 'SPRAY' | 'ACTIVITY';
        status: BlockStatus;
        note?: string; // One-time intervention note (e.g. "Hydrogen Cyanamide")
        baseline?: string; // Periodic rule (e.g. "Every 3 days")
        logData?: DailyLog; // If status is DONE, what was actually logged
    } | null;
}

const ScheduleDetailModal: React.FC<ScheduleDetailModalProps> = ({ isOpen, onClose, data }) => {
    if (!isOpen || !data) return null;

    // Helper to get iconography and colors
    const getConfig = () => {
        switch (data.category) {
            case 'IRRIGATION': return { icon: Droplets, color: 'text-blue-500', bg: 'bg-blue-50', border: 'border-blue-100', title: 'Irrigation Plan' };
            case 'NUTRITION': return { icon: Sprout, color: 'text-emerald-500', bg: 'bg-emerald-50', border: 'border-emerald-100', title: 'Nutrition Plan' };
            case 'SPRAY': return { icon: SprayCan, color: 'text-rose-500', bg: 'bg-rose-50', border: 'border-rose-100', title: 'Spray Application' };
            case 'ACTIVITY': return { icon: Hammer, color: 'text-amber-500', bg: 'bg-amber-50', border: 'border-amber-100', title: 'Field Activity' };
        }
    };

    const config = getConfig();
    const Icon = config.icon;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">

                {/* Header */}
                <div className={`px-6 py-5 border-b ${config.border} ${config.bg} flex justify-between items-center`}>
                    <div className="flex items-center gap-3">
                        <div className={`p-2 bg-white rounded-xl shadow-sm ${config.color}`}>
                            <Icon size={20} />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-stone-800 leading-tight">{config.title}</h3>
                            <div className="text-xs font-medium text-stone-500 flex items-center gap-1 mt-0.5">
                                <Calendar size={10} /> {data.dateLabel} (Day {data.dayNumber})
                            </div>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 -mr-2 text-stone-400 hover:text-stone-600 active:scale-95 transition-transform">
                        <X size={20} />
                    </button>
                </div>

                {/* Body Content */}
                <div className="p-6 space-y-6">

                    {/* 1. Status Indicator */}
                    <div className="flex items-center gap-3">
                        <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${data.status === 'DONE' ? 'bg-emerald-100 text-emerald-700' :
                                data.status === 'PENDING' ? 'bg-amber-100 text-amber-700' :
                                    data.status === 'PLANNED' ? 'bg-blue-50 text-blue-600' : 'bg-stone-100 text-stone-500'
                            }`}>
                            {data.status === 'NOT_REQUIRED' ? 'No Scheduled Task' : data.status}
                        </div>
                        {data.status === 'DONE' && <span className="text-xs text-stone-400">Completed via Log</span>}
                    </div>

                    {/* 2. The "Simple Plan" Display */}
                    <div className="space-y-4">
                        {/* SPECIAL INTERVENTION (One-Time) */}
                        {data.note ? (
                            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-2xl relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-16 h-16 bg-yellow-100 rounded-bl-full -mr-8 -mt-8 opacity-50" />
                                <h4 className="text-xs font-bold text-yellow-800 uppercase tracking-widest mb-1 flex items-center gap-1">
                                    <AlertCircle size={12} /> Special Intervention
                                </h4>
                                <p className="text-lg font-black text-stone-800 leading-tight">
                                    {data.note}
                                </p>
                                {/* Heuristic: Determine type if possible */}
                                {data.category === 'SPRAY' && <p className="text-xs text-stone-500 mt-2">Apply strictly as per quantity.</p>}
                            </div>
                        ) : (
                            /* BASELINE (Periodic) */
                            <div className="p-4 bg-stone-50 border border-stone-100 rounded-2xl">
                                <h4 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-1 flex items-center gap-1">
                                    <Clock size={12} /> Routine Plan
                                </h4>
                                <p className="text-base font-medium text-stone-700">
                                    {data.baseline || "Follow standard baseline protocol."}
                                </p>
                                {data.category === 'NUTRITION' && !data.baseline && (
                                    <p className="text-sm text-stone-500 mt-1">
                                        Use <strong>Basil Dose</strong> (Standard NPK) if no specific fertigation is planned.
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    {/* 3. Logged Details (If Done) */}
                    {data.status === 'DONE' && data.logData && (
                        <div className="border-t border-stone-100 pt-4">
                            <h4 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-2">Actually Completed</h4>
                            <div className="text-sm text-stone-600 bg-emerald-50/50 p-3 rounded-xl border border-emerald-100">
                                {/* Simple JSON dump or specific field rendering */}
                                <p>Logged on this day.</p>
                            </div>
                        </div>
                    )}

                </div>

                {/* Footer / Action */}
                <div className="p-4 bg-stone-50 border-t border-stone-100">
                    <button onClick={onClose} className="w-full py-3 rounded-xl font-bold text-stone-600 hover:bg-stone-200 transaction-colors">
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ScheduleDetailModal;
