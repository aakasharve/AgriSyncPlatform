/**
 * ScheduleSelector.tsx
 * 
 * Component for browsing and selecting a schedule template from the library.
 * Shown during crop/plot setup to enforce schedule-first architecture.
 * 
 * Displays: Name, Owner badge, Duration, Stage count, Description
 * On selection: shows stage preview
 */

import React, { useMemo, useState } from 'react';
import {
    Calendar, Clock, Layers, User, Building2, Shield, Sparkles,
    ChevronDown, ChevronUp, Check
} from 'lucide-react';
import { ScheduleOwnerType } from '../scheduler.types';
import { getAllTemplates, getTemplatesForCrop } from '../../../infrastructure/reference/TemplateCatalog';

interface ScheduleSelectorProps {
    cropCode: string;  // Filter templates by crop
    selectedTemplateId: string | null;
    onSelect: (templateId: string) => void;
}

// Owner type badge configuration
const OWNER_BADGES: Record<ScheduleOwnerType, { label: string; icon: React.ReactNode; color: string; bg: string }> = {
    'SYSTEM_DEFAULT': {
        label: 'System Default',
        icon: <Shield size={12} strokeWidth={3} />,
        color: 'text-stone-600',
        bg: 'bg-stone-100'
    },
    'EXPERT': {
        label: 'Expert',
        icon: <Sparkles size={12} strokeWidth={3} />,
        color: 'text-amber-700',
        bg: 'bg-amber-50 border border-amber-200'
    },
    'INSTITUTION': {
        label: 'Institution',
        icon: <Building2 size={12} strokeWidth={3} />,
        color: 'text-blue-700',
        bg: 'bg-blue-50 border border-blue-200'
    },
    'USER': {
        label: 'My Schedule',
        icon: <User size={12} strokeWidth={3} />,
        color: 'text-emerald-700',
        bg: 'bg-emerald-50 border border-emerald-200'
    },
};

const ScheduleSelector: React.FC<ScheduleSelectorProps> = ({ cropCode, selectedTemplateId, onSelect }) => {
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const templates = useMemo(() => {
        if (!cropCode) return getAllTemplates();
        return getTemplatesForCrop(cropCode);
    }, [cropCode]);

    if (templates.length === 0) {
        return (
            <div className="text-center py-8">
                <div className="text-stone-400 text-sm font-medium">
                    No schedule templates found for this crop.
                </div>
                <div className="text-stone-300 text-xs mt-1">
                    A default schedule will be generated automatically.
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="text-center mb-4">
                <p className="text-xs font-bold text-stone-400 uppercase tracking-widest">
                    Select a Schedule Template
                </p>
                <p className="text-stone-500 text-sm mt-1">
                    {templates.length} template{templates.length !== 1 ? 's' : ''} available
                </p>
            </div>

            {templates.map(template => {
                const isSelected = selectedTemplateId === template.id;
                const isExpanded = expandedId === template.id;
                const badge = OWNER_BADGES[template.ownerType];

                return (
                    <div
                        key={template.id}
                        className={`
                            relative rounded-2xl border-2 transition-all duration-300 overflow-hidden
                            ${isSelected
                                ? 'border-emerald-400 bg-emerald-50/50 shadow-lg shadow-emerald-100/50 ring-2 ring-emerald-200 ring-offset-1'
                                : 'border-stone-100 bg-white hover:border-stone-200 hover:shadow-md'
                            }
                        `}
                    >
                        {/* Main Card - Clickable to Select */}
                        <button
                            onClick={() => onSelect(template.id)}
                            className="w-full text-left p-5"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    {/* Template Name */}
                                    <h4 className={`font-black text-base leading-tight mb-1.5 ${isSelected ? 'text-emerald-800' : 'text-stone-800'}`}>
                                        {template.name}
                                    </h4>

                                    {/* Owner Badge */}
                                    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${badge.bg} ${badge.color}`}>
                                        {badge.icon}
                                        <span>{template.createdBy}</span>
                                    </div>

                                    {/* Description */}
                                    {template.description && (
                                        <p className="text-stone-400 text-xs mt-2 line-clamp-2 leading-relaxed">
                                            {template.description}
                                        </p>
                                    )}

                                    {/* Stats Row */}
                                    <div className="flex items-center gap-4 mt-3">
                                        <div className="flex items-center gap-1 text-stone-400">
                                            <Calendar size={12} strokeWidth={2.5} />
                                            <span className="text-xs font-bold">{template.totalDurationDays || '—'} days</span>
                                        </div>
                                        <div className="flex items-center gap-1 text-stone-400">
                                            <Layers size={12} strokeWidth={2.5} />
                                            <span className="text-xs font-bold">{template.stages.length} stages</span>
                                        </div>
                                        <div className="flex items-center gap-1 text-stone-400">
                                            <Clock size={12} strokeWidth={2.5} />
                                            <span className="text-xs font-bold">
                                                {template.periodicExpectations.length + template.oneTimeExpectations.length} tasks
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Selection indicator */}
                                <div className={`
                                    w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-1 transition-all
                                    ${isSelected
                                        ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30'
                                        : 'border-2 border-stone-200'
                                    }
                                `}>
                                    {isSelected && <Check size={16} strokeWidth={3} />}
                                </div>
                            </div>
                        </button>

                        {/* Expand/Collapse Stages Preview */}
                        <div className="px-5 pb-1">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedId(isExpanded ? null : template.id);
                                }}
                                className="flex items-center gap-1 text-xs font-bold text-stone-400 hover:text-stone-600 transition-colors pb-3"
                            >
                                {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                <span>{isExpanded ? 'Hide' : 'View'} Stage Details</span>
                            </button>
                        </div>

                        {/* Stages Preview (Expanded) */}
                        {isExpanded && (
                            <div className="px-5 pb-5 animate-in slide-in-from-top-2 fade-in duration-200">
                                <div className="bg-stone-50 rounded-xl p-4 space-y-2">
                                    {template.stages.map((stage, idx) => (
                                        <div
                                            key={stage.id}
                                            className="flex items-center gap-3"
                                        >
                                            {/* Stage number dot */}
                                            <div className={`
                                                w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0
                                                ${isSelected ? 'bg-emerald-500 text-white' : 'bg-stone-200 text-stone-500'}
                                            `}>
                                                {idx + 1}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <span className="text-xs font-bold text-stone-700 truncate block">
                                                    {stage.name}
                                                </span>
                                            </div>
                                            <span className="text-[10px] font-bold text-stone-400 flex-shrink-0">
                                                Day {stage.dayStart}–{stage.dayEnd}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default ScheduleSelector;
