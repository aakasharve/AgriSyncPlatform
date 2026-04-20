import React, { useMemo, useState } from 'react';
import { AlertTriangle, Bell, ChevronDown, ChevronUp, Lightbulb, Sprout } from 'lucide-react';
import { ObservationNote } from '../../../types';

interface ObservationsPanelProps {
    observations: ObservationNote[];
    dateStr: string;
}

const GROUP_ORDER: Array<ObservationNote['noteType']> = ['issue', 'reminder', 'observation', 'tip', 'unknown'];

const GROUP_STYLE: Record<ObservationNote['noteType'], { label: string; border: string; bg: string; icon: React.ReactNode }> = {
    observation: { label: 'Observation', border: 'border-emerald-200', bg: 'bg-emerald-50/70', icon: <Sprout size={14} className="text-emerald-700" /> },
    tip: { label: 'Tip', border: 'border-emerald-200', bg: 'bg-emerald-50/70', icon: <Lightbulb size={14} className="text-emerald-700" /> },
    issue: { label: 'Issue', border: 'border-amber-200', bg: 'bg-amber-50/80', icon: <AlertTriangle size={14} className="text-amber-700" /> },
    reminder: { label: 'Reminder', border: 'border-blue-200', bg: 'bg-blue-50/80', icon: <Bell size={14} className="text-blue-700" /> },
    unknown: { label: 'Note', border: 'border-slate-200', bg: 'bg-slate-50/80', icon: <Sprout size={14} className="text-slate-600" /> },
};

const formatObservationTime = (timestamp?: string): string => {
    if (!timestamp) return '--:--';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '--:--';
    return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
};

const ObservationsPanel: React.FC<ObservationsPanelProps> = ({ observations, dateStr }) => {
    const [expandedIds, setExpandedIds] = useState<string[]>([]);

    const grouped = useMemo(() => {
        const next = new Map<ObservationNote['noteType'], ObservationNote[]>();
        GROUP_ORDER.forEach(type => next.set(type, []));

        observations.forEach(observation => {
            const bucket = next.get(observation.noteType || 'unknown') || [];
            bucket.push(observation);
            next.set(observation.noteType || 'unknown', bucket);
        });

        return GROUP_ORDER
            .map(type => ({ type, notes: next.get(type) || [] }))
            .filter(group => group.notes.length > 0);
    }, [observations]);

    const toggleExpanded = (id: string) => {
        setExpandedIds(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
    };

    if (observations.length === 0) {
        return (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center">
                <p className="text-sm font-semibold text-slate-500">No observations recorded for {dateStr}.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {grouped.map(group => {
                const style = GROUP_STYLE[group.type];
                return (
                    <div key={group.type} className="space-y-2">
                        <div className="flex items-center gap-2 px-1">
                            {style.icon}
                            <span className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
                                {style.label} ({group.notes.length})
                            </span>
                        </div>

                        <div className="space-y-2">
                            {group.notes.map(note => {
                                const expanded = expandedIds.includes(note.id);
                                const text = note.textCleaned || note.textRaw;
                                return (
                                    <button
                                        key={note.id}
                                        type="button"
                                        onClick={() => toggleExpanded(note.id)}
                                        className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${style.border} ${style.bg}`}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                                                        {style.label}
                                                    </span>
                                                    <span className="text-[11px] font-semibold text-slate-500">
                                                        {formatObservationTime(note.timestamp)}
                                                    </span>
                                                    {note.severity && note.severity !== 'normal' && (
                                                        <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                                                            {note.severity}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className={`mt-2 text-sm font-medium text-slate-800 ${expanded ? '' : 'line-clamp-2'}`}>
                                                    {text}
                                                </p>
                                                {note.tags && note.tags.length > 0 && (
                                                    <div className="mt-2 flex flex-wrap gap-2">
                                                        {note.tags.map(tag => (
                                                            <span key={`${note.id}-${tag}`} className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                                                                {tag}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="pt-0.5 text-slate-400">
                                                {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default ObservationsPanel;
