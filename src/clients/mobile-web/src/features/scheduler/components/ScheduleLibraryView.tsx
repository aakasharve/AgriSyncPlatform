import React, { useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, Clock, Eye, Layers, Users, X } from 'lucide-react';
import { CropProfile, CropScheduleTemplate } from '../../../types';
import { ScheduleLibrarySort, getSchedulesForCrop, getStageNote } from '../library/scheduleLibrary';
import { getOperationName } from '../../../features/scheduler/planning/ClientPlanEngine';

interface ScheduleLibraryViewProps {
    crop?: CropProfile;
    adoptedScheduleId?: string | null;
    onAdopt: (templateId: string) => void;
}

const formatPeriodicTiming = (frequencyMode: string, frequencyValue: number): string => {
    if (frequencyMode === 'PER_WEEK') return `${frequencyValue}x/week`;
    return `Every ${frequencyValue} day${frequencyValue > 1 ? 's' : ''}`;
};

const getStageActivities = (template: CropScheduleTemplate, stageId: string): Array<{ label: string; timing: string; }> => {
    const periodic = template.periodicExpectations
        .filter(item => item.stageId === stageId)
        .map(item => ({
            label: getOperationName(item.operationTypeId),
            timing: formatPeriodicTiming(item.frequencyMode, item.frequencyValue)
        }));

    const oneTime = template.oneTimeExpectations
        .filter(item => item.stageId === stageId)
        .map(item => ({
            label: getOperationName(item.operationTypeId),
            timing: `Day ${item.targetDayFromRef}`
        }));

    return [...periodic, ...oneTime];
};

const ScheduleLibraryView: React.FC<ScheduleLibraryViewProps> = ({ crop, adoptedScheduleId, onAdopt }) => {
    const [sortBy, setSortBy] = useState<ScheduleLibrarySort>('HIGHEST_ADOPTION');
    const [search, setSearch] = useState('');
    const [detailTemplate, setDetailTemplate] = useState<CropScheduleTemplate | null>(null);

    const schedules = useMemo(() => {
        if (!crop) return [];
        return getSchedulesForCrop(crop.name, sortBy);
    }, [crop, sortBy]);

    const filteredSchedules = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return schedules;
        return schedules.filter(item =>
            item.name.toLowerCase().includes(query) || item.createdBy.toLowerCase().includes(query)
        );
    }, [schedules, search]);

    if (!crop) {
        return (
            <div className="text-center py-10 border-2 border-dashed border-stone-200 rounded-3xl bg-stone-50/50">
                <BookOpen className="mx-auto text-stone-300 mb-3" size={34} />
                <p className="text-stone-500 font-bold">Select a crop to open the Schedule Library.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-sm">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search owner or schedule"
                        className="sm:col-span-2 px-3 py-2 rounded-xl border border-stone-200 text-sm font-medium outline-none focus:border-emerald-500"
                    />
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as ScheduleLibrarySort)}
                        className="px-3 py-2 rounded-xl border border-stone-200 text-sm font-bold bg-white outline-none focus:border-emerald-500"
                    >
                        <option value="HIGHEST_ADOPTION">Highest Adoption Score</option>
                        <option value="MOST_FOLLOWED">Most Followed</option>
                        <option value="SHORTEST_DURATION">Shortest Duration</option>
                        <option value="NEWEST">Newest</option>
                    </select>
                </div>
            </div>

            <div className="space-y-3">
                {filteredSchedules.map(template => {
                    const isAdopted = template.id === adoptedScheduleId;
                    return (
                        <div key={template.id} className="bg-white rounded-2xl border border-stone-200 p-4 shadow-sm">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h3 className="font-black text-stone-800 leading-tight">{template.name}</h3>
                                    <p className="text-xs text-stone-500 mt-1">Created by: {template.createdBy}</p>
                                </div>
                                {isAdopted && (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-emerald-100 text-emerald-700">
                                        <CheckCircle2 size={12} /> Adopted
                                    </span>
                                )}
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-4">
                                <div className="rounded-xl bg-stone-50 p-2.5 border border-stone-100">
                                    <div className="text-[10px] uppercase font-bold text-stone-400">Duration</div>
                                    <div className="text-sm font-black text-stone-800 mt-0.5">{template.totalDurationDays || '-'} days</div>
                                </div>
                                <div className="rounded-xl bg-emerald-50 p-2.5 border border-emerald-100">
                                    <div className="text-[10px] uppercase font-bold text-emerald-600">Adoption</div>
                                    <div className="text-sm font-black text-emerald-700 mt-0.5">{template.adoptionScore || 0}/100</div>
                                </div>
                                <div className="rounded-xl bg-blue-50 p-2.5 border border-blue-100">
                                    <div className="text-[10px] uppercase font-bold text-blue-600">Detail</div>
                                    <div className="text-sm font-black text-blue-700 mt-0.5">{template.detailScore || 0}/100</div>
                                </div>
                                <div className="rounded-xl bg-amber-50 p-2.5 border border-amber-100">
                                    <div className="text-[10px] uppercase font-bold text-amber-600">Followers</div>
                                    <div className="text-sm font-black text-amber-700 mt-0.5">{template.followersCount || 0}</div>
                                </div>
                                <div className="rounded-xl bg-stone-50 p-2.5 border border-stone-100">
                                    <div className="text-[10px] uppercase font-bold text-stone-400">Stages</div>
                                    <div className="text-sm font-black text-stone-800 mt-0.5">{template.stages.length}</div>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 mt-4">
                                <button
                                    onClick={() => setDetailTemplate(template)}
                                    className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-stone-200 text-xs font-bold text-stone-700 hover:bg-stone-50"
                                >
                                    <Eye size={14} /> View
                                </button>
                                {!isAdopted && (
                                    <button
                                        onClick={() => onAdopt(template.id)}
                                        className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700"
                                    >
                                        Adopt
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {detailTemplate && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                    <div className="bg-white w-full max-w-2xl rounded-3xl border border-stone-200 shadow-2xl max-h-[90vh] overflow-hidden">
                        <div className="px-5 py-4 border-b border-stone-100 flex items-start justify-between gap-3">
                            <div>
                                <h3 className="font-black text-stone-800">{detailTemplate.name}</h3>
                                <p className="text-xs text-stone-500 mt-1">Stage-wise schedule with fixed stage notes</p>
                            </div>
                            <button
                                onClick={() => setDetailTemplate(null)}
                                className="p-2 rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-5 overflow-y-auto max-h-[75vh] space-y-3">
                            {detailTemplate.stages
                                .sort((a, b) => a.orderIndex - b.orderIndex)
                                .map(stage => {
                                    const activities = getStageActivities(detailTemplate, stage.id);
                                    return (
                                        <div key={stage.id} className="rounded-2xl border border-stone-200 p-4">
                                            <div className="flex items-center justify-between gap-3">
                                                <h4 className="font-bold text-stone-800">{stage.name}</h4>
                                                <span className="text-xs font-bold text-stone-500">
                                                    Day {stage.dayStart} - {stage.dayEnd}
                                                </span>
                                            </div>
                                            <div className="mt-3 space-y-2">
                                                {activities.length === 0 ? (
                                                    <p className="text-xs text-stone-500">No mandatory activities defined for this stage.</p>
                                                ) : activities.map((item, index) => (
                                                    <div key={`${stage.id}_${index}`} className="flex items-center justify-between text-sm rounded-lg bg-stone-50 px-3 py-2">
                                                        <span className="text-stone-700 font-medium">{item.label}</span>
                                                        <span className="text-xs text-stone-500 font-bold">{item.timing}</span>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="mt-3 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2">
                                                <p className="text-[11px] uppercase tracking-wide font-bold text-amber-700">Stage Notes</p>
                                                <p className="text-sm text-amber-900 mt-1">{getStageNote(stage)}</p>
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ScheduleLibraryView;
