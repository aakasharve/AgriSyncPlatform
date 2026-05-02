import React, { useState, useEffect, useMemo } from 'react';
import { Settings, Calendar, CalendarRange, Droplets, SprayCan, Sprout, Info, Layers, MapPin, Clock, User, Building2, Shield, Sparkles, CheckCircle2 } from 'lucide-react';
import { CropProfile, PlotScheduleInstance, CropScheduleTemplate, StageTemplate, StageOverride, ExpectationOverride, DailyLog, ResourceItem, PlannedTask } from '../types';
import { getTemplateForCrop, calculateDayNumber, getCurrentStage, createInitialScheduleInstance, derivePlannedItemsForDay, getScheduleById } from '../features/scheduler/planning/ClientPlanEngine';
import { getAllTemplates } from '../infrastructure/reference/TemplateCatalog';
import { getEffectivePhaseAndDay } from '../shared/utils/timelineUtils';
import SchedulerTimeline from '../features/scheduler/components/SchedulerTimeline';
import { getDateKey } from '../core/domain/services/DateKeyService';
import SlidingCropSelector from '../features/context/components/SlidingCropSelector';
import ScheduleMaker from '../features/scheduler/components/ScheduleMaker';
import ScheduleLibraryView from '../features/scheduler/components/ScheduleLibraryView';
import { computeDayState } from '../shared/utils/dayState';
import { financeSelectors } from '../features/finance/financeSelectors';
import { MoneyChip } from '../features/finance/components/MoneyChip';
import { MoneyLensDrawer } from '../features/finance/components/MoneyLensDrawer';
import { FinanceFilters } from '../features/finance/finance.types';
import OfflineEmptyState from '../shared/components/ui/OfflineEmptyState';
import LineageRibbon from '../features/schedule-authoring/components/LineageRibbon';

interface SchedulerPageProps {
    crops: CropProfile[];
    logs: DailyLog[]; // Received from App
    tasks?: PlannedTask[];
    onUpdateCrops: (crops: CropProfile[]) => void;
    userResources: ResourceItem[];
    onAddResource: (r: ResourceItem) => void;
    onOpenTaskCreator?: () => void; // Phase 2: Task Creation
    onCloseDay?: () => void;
}

const canonicalCropCode = (value: string): string => {
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    return normalized.endsWith('s') ? normalized.slice(0, -1) : normalized;
};

const SchedulerPage: React.FC<SchedulerPageProps> = ({
    crops,
    logs,
    tasks = [],
    onUpdateCrops,
    userResources,
    onAddResource,
    onOpenTaskCreator: _onOpenTaskCreator,
    onCloseDay
}) => {
    // Selection State
    const [selectedCropId, setSelectedCropId] = useState<string>('');
    const [selectedPlotIds, setSelectedPlotIds] = useState<string[]>([]);
    const [viewMode, setViewMode] = useState<'TIMELINE' | 'LIBRARY' | 'EDITOR'>('TIMELINE');

    // Editor State (for Rules - ONE PLOT ONLY)
    const [activeTemplate, setActiveTemplate] = useState<CropScheduleTemplate | null>(null);
    const [draftInstance, setDraftInstance] = useState<PlotScheduleInstance | null>(null);
    const [_openStageId, _setOpenStageId] = useState<string | null>(null);
    const [_isDirty, setIsDirty] = useState(false);
    const [moneyLensOpen, setMoneyLensOpen] = useState(false);
    const [moneyLensFilters, setMoneyLensFilters] = useState<FinanceFilters>({});
    const libraryTemplateCount = useMemo(() => {
        const allowedCropCodes = new Set(crops.map(crop => canonicalCropCode(crop.name)));
        const byCrop = new Map<string, number[]>();
        getAllTemplates().forEach(template => {
            const cropCode = canonicalCropCode(template.cropCode);
            if (!allowedCropCodes.has(cropCode)) {
                return;
            }

            const size = template.periodicExpectations.length + template.oneTimeExpectations.length;
            const bucket = byCrop.get(cropCode) ?? [];
            bucket.push(size);
            byCrop.set(cropCode, bucket);
        });

        let total = 0;
        byCrop.forEach(bucket => {
            total += Math.min(3, bucket.length);
        });
        return total;
    }, [crops]);

    // Derived Selection
    const activeCrop = crops.find(c => c.id === selectedCropId);

    // Get ALL active plots
    const activePlots = activeCrop
        ? activeCrop.plots.filter(p => selectedPlotIds.includes(p.id))
        : [];

    // Valid for Editing? (Exactly 1 plot)
    const canEdit = activePlots.length === 1;
    const editingPlot = canEdit ? activePlots[0] : null;
    const todayDateKey = getDateKey();

    const schedulerDayState = useMemo(() => computeDayState({
        logs,
        crops,
        tasks,
        date: todayDateKey,
        selectedCropIds: selectedCropId ? [selectedCropId] : undefined,
        selectedPlotIds: selectedPlotIds.length > 0 ? selectedPlotIds : undefined
    }), [logs, crops, tasks, todayDateKey, selectedCropId, selectedPlotIds]);

    const lastSprayLabel = schedulerDayState.lastActions.sprayDaysAgo === null
        ? 'No spray logged yet'
        : `${schedulerDayState.lastActions.sprayDaysAgo} days ago`;
    const lastIrrigationLabel = schedulerDayState.lastActions.irrigationDaysAgo === null
        ? 'No irrigation logged yet'
        : `${schedulerDayState.lastActions.irrigationDaysAgo} days ago`;

    const todaySpend = useMemo(
        () => financeSelectors.getTotalCost({
            fromDate: todayDateKey,
            toDate: todayDateKey,
            cropId: selectedCropId || undefined,
            plotId: selectedPlotIds[0]
        }),
        [todayDateKey, selectedCropId, selectedPlotIds, logs.length]
    );

    useEffect(() => {
        if (!selectedCropId && crops.length > 0) {
            const first = crops[0];
            setSelectedCropId(first.id);
            if (first.plots.length > 0) {
                setSelectedPlotIds([first.plots[0].id]);
            }
        }
    }, [selectedCropId, crops]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const targetCropId = window.sessionStorage.getItem('schedule_library_crop_id');
        if (!targetCropId) return;

        const targetCrop = crops.find(c => c.id === targetCropId);
        if (targetCrop) {
            setSelectedCropId(targetCrop.id);
            if (targetCrop.plots.length > 0) {
                setSelectedPlotIds([targetCrop.plots[0].id]);
            }
            setViewMode('LIBRARY');
        }

        window.sessionStorage.removeItem('schedule_library_crop_id');
    }, [crops]);

    // Initial Load / Plot Change Effect
    useEffect(() => {
        if (!activeCrop) {
            setActiveTemplate(null);
            setDraftInstance(null);
            return;
        }

        const template = getScheduleById(activeCrop.activeScheduleId || '') || getTemplateForCrop(activeCrop.name);
        setActiveTemplate(template);

        let localDirty = false;

        // We only manage DRAFT for the single editing plot
        if (editingPlot) {
            let instance = editingPlot.schedule;
            if (!instance) {
                const refDate = editingPlot.startDate || getDateKey();
                instance = createInitialScheduleInstance(editingPlot.id, activeCrop.name, refDate);
                if (activeCrop.activeScheduleId) {
                    const adopted = getScheduleById(activeCrop.activeScheduleId);
                    if (adopted) {
                        instance.templateId = adopted.id;
                        instance.referenceType = adopted.referenceType;
                    }
                }
                localDirty = true;
            }
            setDraftInstance(JSON.parse(JSON.stringify(instance)));
            setIsDirty(localDirty);
        } else {
            setDraftInstance(null);
        }

    }, [activeCrop?.id, selectedPlotIds.join(','), editingPlot?.id]);

    const handleSave = (scheduleOverride?: any) => {
        if (!activeCrop || !editingPlot) return;

        const instancesToSave = scheduleOverride || draftInstance;
        if (!instancesToSave) return;

        const updatedPlots = activeCrop.plots.map(p => {
            if (p.id === editingPlot.id) {
                return { ...p, schedule: instancesToSave };
            }
            return p;
        });

        const updatedCrops = crops.map(c => {
            if (c.id === activeCrop.id) {
                return { ...c, plots: updatedPlots };
            }
            return c;
        });

        onUpdateCrops(updatedCrops);
        setIsDirty(false);
        // If we saved an override, update draft too to match
        if (scheduleOverride) {
            setDraftInstance(scheduleOverride);
        }
        setViewMode('TIMELINE'); // Return to timeline after save
    };

    const handleAdoptSchedule = (templateId: string) => {
        if (!activeCrop) return;

        const template = getScheduleById(templateId);
        if (!template) return;

        const shouldAdopt = typeof window !== 'undefined'
            ? window.confirm(`Adopt this schedule for ${activeCrop.name}?`)
            : true;

        if (!shouldAdopt) return;

        const updatedCrops = crops.map(crop => {
            if (crop.id !== activeCrop.id) return crop;
            return {
                ...crop,
                activeScheduleId: templateId,
                plots: crop.plots.map(plot => {
                    const existing = plot.schedule || createInitialScheduleInstance(plot.id, crop.name, plot.startDate || getDateKey());
                    return {
                        ...plot,
                        schedule: {
                            ...existing,
                            templateId,
                            referenceType: template.referenceType,
                            stageOverrides: [],
                            expectationOverrides: []
                        }
                    };
                })
            };
        });

        onUpdateCrops(updatedCrops);
    };

    // --- SELECTION HANDLER ---
    const _handleCropSelectionChange = (cIds: string[], pMap: Record<string, string[]>) => {
        // Enforce Single Crop & Single Plot
        let targetCropId = selectedCropId;

        if (cIds.length === 0) {
            targetCropId = '';
        } else if (cIds.length === 1) {
            targetCropId = cIds[0];
        } else {
            // New crop selected?
            const newId = cIds.find(id => id !== selectedCropId);
            targetCropId = newId || cIds[cIds.length - 1];
        }

        setSelectedCropId(targetCropId);

        // Enforce Single Plot
        if (targetCropId) {
            const potentialPlots = pMap[targetCropId] || [];
            // Take the LAST selected plot (user intention is usually "switch to this")
            const singlePlot = potentialPlots.length > 0 ? [potentialPlots[potentialPlots.length - 1]] : [];
            setSelectedPlotIds(singlePlot);
        } else {
            setSelectedPlotIds([]);
        }
    };

    // --- EDIT HANDLERS (Same as before) ---
    const _handleStageBoundaryChange = (stageId: string, field: 'start' | 'end', val: number) => {
        if (!draftInstance) return;
        const overrides = [...draftInstance.stageOverrides];
        const existingIdx = overrides.findIndex(o => o.stageId === stageId);
        const newOverride: StageOverride = existingIdx >= 0 ? { ...overrides[existingIdx] } : { stageId };
        if (field === 'start') newOverride.customDayStart = val;
        if (field === 'end') newOverride.customDayEnd = val;
        if (existingIdx >= 0) overrides[existingIdx] = newOverride;
        else overrides.push(newOverride);
        setDraftInstance({ ...draftInstance, stageOverrides: overrides });
        setIsDirty(true);
    };

    const _updateExpectationOverride = (stageId: string, category: 'IRRIGATION' | 'FERTIGATION' | 'FOLIAR_SPRAY', field: 'mode' | 'value', value: any) => {
        if (!draftInstance || !activeTemplate) return;
        const targetExp = activeTemplate.periodicExpectations.find(pe => {
            if (pe.stageId !== stageId) return false;
            if (category === 'IRRIGATION' && pe.operationTypeId.includes('irrig')) return true;
            if (category === 'FERTIGATION' && pe.operationTypeId.includes('fert')) return true;
            if (category === 'FOLIAR_SPRAY' && pe.operationTypeId.includes('spray')) return true;
            return false;
        });
        if (!targetExp) return;
        const overrides = [...draftInstance.expectationOverrides];
        const existingIdx = overrides.findIndex(o => o.expectationId === targetExp.id);
        const newOverride: ExpectationOverride = existingIdx >= 0 ? { ...overrides[existingIdx] } : { expectationId: targetExp.id };
        if (field === 'mode') newOverride.customFrequencyMode = value;
        if (field === 'value') newOverride.customFrequencyValue = value;
        if (existingIdx >= 0) overrides[existingIdx] = newOverride;
        else overrides.push(newOverride);
        setDraftInstance({ ...draftInstance, expectationOverrides: overrides });
        setIsDirty(true);
    };

    const _getEffectiveStage = (tStage: StageTemplate) => {
        if (!draftInstance) return tStage;
        const ov = draftInstance.stageOverrides.find(o => o.stageId === tStage.id);
        return { ...tStage, dayStart: ov?.customDayStart ?? tStage.dayStart, dayEnd: ov?.customDayEnd ?? tStage.dayEnd };
    };

    const _getEffectiveExpectation = (stageId: string, categoryKeyword: string) => {
        if (!activeTemplate || !draftInstance) return null;
        const tExp = activeTemplate.periodicExpectations.find(pe => pe.stageId === stageId && pe.operationTypeId.includes(categoryKeyword));
        if (!tExp) return null;
        const ov = draftInstance.expectationOverrides.find(o => o.expectationId === tExp.id);
        return { mode: ov?.customFrequencyMode ?? tExp.frequencyMode, value: ov?.customFrequencyValue ?? tExp.frequencyValue, notes: tExp.notes };
    };

    if (crops.length === 0) return (
        <div className="max-w-4xl mx-auto px-4 py-6 pb-24">
            <OfflineEmptyState
                icon={<CalendarRange size={40} className="text-slate-300" />}
                title="No Schedules Yet"
                message="Add crops and plots in Profile to create farming schedules."
            />
        </div>
    );

    // Construct Preview Plot for Editing
    const previewEditingPlot = editingPlot && draftInstance ? { ...editingPlot, schedule: draftInstance } : editingPlot;

    return (
        <div className="pb-24 animate-in fade-in max-w-4xl mx-auto px-4 sm:px-6 py-6 font-sans">
            <div className="mb-5 flex items-start justify-between gap-3">
                <div className={`flex-1 rounded-2xl border px-4 py-3 ${schedulerDayState.riskStatus === 'risk_rising'
                    ? 'border-amber-300 bg-amber-50 text-amber-800'
                    : 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    }`}>
                    <p className="text-[10px] uppercase tracking-wide font-black">
                        {schedulerDayState.riskStatus === 'risk_rising' ? 'Risk rising' : 'Stable'}
                    </p>
                    <p className="text-sm font-semibold mt-1">
                        {schedulerDayState.riskSignals[0] || 'Execution is aligned with today plan.'}
                    </p>
                    <div className="mt-2">
                        <MoneyChip
                            amount={todaySpend}
                            onClick={() => {
                                setMoneyLensFilters({
                                    fromDate: todayDateKey,
                                    toDate: todayDateKey,
                                    cropId: selectedCropId || undefined,
                                    plotId: selectedPlotIds[0]
                                });
                                setMoneyLensOpen(true);
                            }}
                        />
                    </div>
                </div>
                <button
                    onClick={() => onCloseDay?.()}
                    className="px-4 py-2.5 rounded-xl bg-stone-900 text-white text-xs font-black uppercase tracking-wide shadow-sm"
                >
                    Close Day
                </button>
            </div>

            {/* HEADER TOGGLE: VIEW v MODIFY */}
            <div className="mb-6">
                <div className="bg-stone-100 p-1 rounded-xl flex relative shadow-inner max-w-2xl mx-auto">
                    <button
                        onClick={() => setViewMode('TIMELINE')}
                        className={`
                            flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg transition-all duration-300
                            ${viewMode === 'TIMELINE'
                                ? 'bg-white shadow-md text-stone-800'
                                : 'text-stone-400 hover:text-stone-600 hover:bg-stone-50'
                            }
                        `}
                    >
                        <Calendar size={20} className={viewMode === 'TIMELINE' ? 'text-blue-500 fill-blue-50' : 'opacity-50'} />
                        <div className="text-left leading-tight">
                            <span className="block text-sm font-black tracking-tight">VIEW</span>
                            <span className="text-[9px] font-bold uppercase tracking-widest opacity-60">Schedule</span>
                        </div>
                    </button>

                    <button
                        onClick={() => setViewMode('LIBRARY')}
                        className={`
                            flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg transition-all duration-300
                            ${viewMode === 'LIBRARY'
                                ? 'bg-white shadow-md text-stone-800'
                                : 'text-stone-400 hover:text-stone-600 hover:bg-stone-50'
                            }
                        `}
                    >
                        <Layers size={20} className={viewMode === 'LIBRARY' ? 'text-emerald-500 fill-emerald-50' : 'opacity-50'} />
                        <div className="text-left leading-tight">
                            <span className="block text-sm font-black tracking-tight">LIBRARY</span>
                            <span className="text-[9px] font-bold uppercase tracking-widest opacity-60">
                                {`${libraryTemplateCount} Options`}
                            </span>
                        </div>
                    </button>

                    <button
                        onClick={() => setViewMode('EDITOR')}
                        className={`
                            flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg transition-all duration-300
                            ${viewMode === 'EDITOR'
                                ? 'bg-white shadow-md text-stone-800'
                                : 'text-stone-400 hover:text-stone-600 hover:bg-stone-50'
                            }
                        `}
                    >
                        <Settings size={20} className={viewMode === 'EDITOR' ? 'text-amber-500 fill-amber-50' : 'opacity-50'} />
                        <div className="text-left leading-tight">
                            <span className="block text-sm font-black tracking-tight">MODIFY</span>
                            <span className="text-[9px] font-bold uppercase tracking-widest opacity-60">Master Schedule</span>
                        </div>
                    </button>
                </div>


            </div>

            {/* SELECTION UI - Replicates ManualEntry Look */}

            {/* SELECTOR: Sliding Carousel */}
            <div className={`mb-2 ${viewMode === 'EDITOR' ? 'hidden' : ''}`}>
                <SlidingCropSelector
                    crops={crops}
                    selectedCropId={selectedCropId}
                    onSelect={(id) => {
                        setSelectedCropId(id);
                        // Auto-select first plot effectively
                        const crop = crops.find(c => c.id === id);
                        if (crop && crop.plots.length > 0) {
                            setSelectedPlotIds([crop.plots[0].id]);
                        } else {
                            setSelectedPlotIds([]);
                        }
                    }}
                />
            </div>

            {/* PLOTS LIST (If crop selected) */}
            {activeCrop && activeCrop.plots.length > 0 && viewMode === 'TIMELINE' && (
                <div className="mb-8 px-4">
                    <div className="flex flex-wrap justify-center gap-3">
                        {activeCrop.plots.map((plot) => {
                            const isSelected = selectedPlotIds.includes(plot.id);
                            return (
                                <button
                                    key={plot.id}
                                    onClick={() => setSelectedPlotIds([plot.id])} // Strict single select
                                    className={`
                                        flex items-center gap-2 px-4 py-2 rounded-full font-bold text-sm transition-all
                                        ${isSelected
                                            ? 'bg-stone-800 text-white shadow-lg shadow-stone-800/20 scale-105'
                                            : 'bg-white border border-stone-200 text-stone-500 hover:bg-stone-50'
                                        }
                                    `}
                                >
                                    <MapPin size={14} className={isSelected ? 'text-emerald-400' : 'text-stone-300'} />
                                    {plot.name}
                                    {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {viewMode === 'TIMELINE' && (
                <div className="mb-6 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                    <p className="text-[10px] uppercase tracking-wider font-black text-stone-400 mb-2">Last Action Memory</p>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                            <p className="text-xs font-bold text-stone-500">Last spray</p>
                            <p className="text-sm font-black text-stone-800 mt-1">{lastSprayLabel}</p>
                        </div>
                        <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                            <p className="text-xs font-bold text-stone-500">Last irrigation</p>
                            <p className="text-sm font-black text-stone-800 mt-1">{lastIrrigationLabel}</p>
                        </div>
                    </div>
                </div>
            )}

            {!activeCrop && (
                <div className="text-center py-12 px-6 border-2 border-dashed border-stone-200 rounded-3xl bg-stone-50/50 mx-4">
                    <Calendar className="mx-auto text-stone-300 mb-4" size={48} />
                    <p className="text-stone-400 font-bold mb-1">No Crop Selected</p>
                    <p className="text-stone-400 text-sm">Select a crop above to view schedule.</p>
                </div>
            )}

            {viewMode === 'LIBRARY' && (
                <div className="max-w-3xl mx-auto">
                    <ScheduleLibraryView
                        crop={activeCrop}
                        allCrops={crops}
                        adoptedScheduleId={activeCrop?.activeScheduleId || null}
                        onAdopt={handleAdoptSchedule}
                    />
                </div>
            )}

            {/* SINGLE VIEW ONLY */}
            {viewMode === 'TIMELINE' && activePlots.length > 0 && (
                <div className="max-w-2xl mx-auto">
                    {activePlots.slice(0, 1).map((plot) => {
                        const displayPlot = (previewEditingPlot && plot.id === previewEditingPlot.id) ? previewEditingPlot : plot;

                        // Ensure schedule exists for display
                        if (!displayPlot.schedule) {
                            const refDate = displayPlot.startDate || getDateKey();
                            displayPlot.schedule = createInitialScheduleInstance(displayPlot.id, activeCrop?.name || 'Unknown', refDate);
                        }

                        // Derive current state
                        const scheduleTemplate = getScheduleById(activeCrop?.activeScheduleId || '')
                            || getScheduleById(displayPlot.schedule.templateId)
                            || (activeCrop ? getTemplateForCrop(activeCrop.name) : null);
                        const dayNumber = displayPlot.schedule ? calculateDayNumber(displayPlot.schedule.referenceDate, new Date()) : 0;
                        const currentStage = scheduleTemplate && displayPlot.schedule ? getCurrentStage(scheduleTemplate, displayPlot.schedule, dayNumber) : null;
                        const todayPlan = scheduleTemplate && displayPlot.schedule ? derivePlannedItemsForDay(scheduleTemplate, displayPlot.schedule, dayNumber) : null;
                        const totalDays = scheduleTemplate?.totalDurationDays || (scheduleTemplate?.stages?.[scheduleTemplate.stages.length - 1]?.dayEnd || 120);
                        const progressPercent = Math.min(100, Math.max(0, (dayNumber / totalDays) * 100));

                        // Owner badge config
                        const ownerBadge = scheduleTemplate?.ownerType === 'EXPERT'
                            ? { icon: <Sparkles size={12} strokeWidth={3} />, color: 'text-amber-700', bg: 'bg-amber-50 border border-amber-200' }
                            : scheduleTemplate?.ownerType === 'INSTITUTION'
                                ? { icon: <Building2 size={12} strokeWidth={3} />, color: 'text-blue-700', bg: 'bg-blue-50 border border-blue-200' }
                                : scheduleTemplate?.ownerType === 'USER'
                                    ? { icon: <User size={12} strokeWidth={3} />, color: 'text-emerald-700', bg: 'bg-emerald-50 border border-emerald-200' }
                                    : { icon: <Shield size={12} strokeWidth={3} />, color: 'text-stone-600', bg: 'bg-stone-100' };

                        return (
                            <div key={plot.id} className="animate-in fade-in slide-in-from-bottom-4 space-y-5">

                                {/* ═══════════════════════════════════════ */}
                                {/* SECTION 1: ACTIVE SCHEDULE HEADER     */}
                                {/* ═══════════════════════════════════════ */}
                                <div className="bg-gradient-to-br from-stone-900 via-stone-800 to-stone-900 rounded-3xl p-6 text-white shadow-xl shadow-stone-900/30">
                                    {/* Schedule Name & Owner */}
                                    <div className="mb-4">
                                        <h3 className="text-xl font-black tracking-tight leading-tight">
                                            {scheduleTemplate?.name || 'Active Schedule'}
                                        </h3>
                                        <LineageRibbon
                                            derivedFromTemplateId={(scheduleTemplate as Record<string, unknown> | null)?.['derivedFromTemplateId'] as string | null | undefined}
                                            derivedFromName={(scheduleTemplate as Record<string, unknown> | null)?.['derivedFromName'] as string | null | undefined}
                                            version={(scheduleTemplate as Record<string, unknown> | null)?.['version'] as number | undefined}
                                            author={scheduleTemplate?.createdBy}
                                            publishedAtUtc={(scheduleTemplate as Record<string, unknown> | null)?.['publishedAtUtc'] as string | null | undefined ?? scheduleTemplate?.publishedAt}
                                        />
                                        {scheduleTemplate && (
                                            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mt-2 ${ownerBadge.bg} ${ownerBadge.color}`}>
                                                {ownerBadge.icon}
                                                <span>{scheduleTemplate.createdBy}</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Stats Row */}
                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="bg-white/10 rounded-xl p-3 text-center backdrop-blur-sm">
                                            <div className="text-2xl font-black">{dayNumber}</div>
                                            <div className="text-[10px] font-bold uppercase tracking-wider text-white/60">Current Day</div>
                                        </div>
                                        <div className="bg-white/10 rounded-xl p-3 text-center backdrop-blur-sm">
                                            <div className="text-2xl font-black">{totalDays}</div>
                                            <div className="text-[10px] font-bold uppercase tracking-wider text-white/60">Total Days</div>
                                        </div>
                                        <div className="bg-white/10 rounded-xl p-3 text-center backdrop-blur-sm">
                                            <div className="text-2xl font-black">{scheduleTemplate?.stages?.length || 0}</div>
                                            <div className="text-[10px] font-bold uppercase tracking-wider text-white/60">Stages</div>
                                        </div>
                                    </div>

                                    {/* Current Stage Badge */}
                                    {currentStage && (
                                        <div className="mt-4 bg-emerald-500/20 border border-emerald-400/30 rounded-xl px-4 py-2.5 flex items-center gap-2">
                                            <Sprout size={16} className="text-emerald-400" />
                                            <span className="text-sm font-black text-emerald-300">{currentStage.name}</span>
                                        </div>
                                    )}

                                    <button
                                        onClick={() => setViewMode('LIBRARY')}
                                        className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-white/20 bg-white/10 text-xs font-black uppercase tracking-wider hover:bg-white/20 transition-colors"
                                    >
                                        <Layers size={14} />
                                        Library ({libraryTemplateCount} schedules available)
                                    </button>
                                </div>



                                {/* ═══════════════════════════════════════ */}
                                {/* SECTION 2: Today's Scheduled Tasks                */}
                                {/* ═══════════════════════════════════════ */}
                                {todayPlan && todayPlan.plannedItems.length > 0 && (
                                    <div className="bg-white rounded-3xl border border-stone-100 shadow-lg shadow-stone-100/50 p-5">
                                        <div className="flex items-center gap-2 mb-4">
                                            <Clock size={18} className="text-blue-500" />
                                            <h4 className="font-black text-stone-800">Today's Scheduled Tasks</h4>
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 ml-auto">Day {dayNumber}</span>
                                        </div>
                                        <div className="space-y-2">
                                            {todayPlan.plannedItems.map(item => (
                                                <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl bg-stone-50 border border-stone-100 hover:bg-stone-100/50 transition-colors">
                                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${item.category === 'IRRIGATION' ? 'bg-blue-100 text-blue-600' :
                                                        item.category === 'FERTIGATION' ? 'bg-amber-100 text-amber-600' :
                                                            item.category === 'FOLIAR_SPRAY' ? 'bg-purple-100 text-purple-600' :
                                                                item.category === 'WEED_CONTROL' ? 'bg-green-100 text-green-600' :
                                                                    'bg-stone-100 text-stone-600'
                                                        }`}>
                                                        {item.category === 'IRRIGATION' ? <Droplets size={16} /> :
                                                            item.category === 'FOLIAR_SPRAY' ? <SprayCan size={16} /> :
                                                                <Sprout size={16} />}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <span className="text-sm font-bold text-stone-700 block truncate">{item.name}</span>
                                                        {item.notes && (
                                                            <span className="text-xs text-stone-400 block truncate">{item.notes}</span>
                                                        )}
                                                    </div>
                                                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${item.type === 'ONE_TIME'
                                                        ? 'bg-rose-50 text-rose-600 border border-rose-100'
                                                        : 'bg-stone-100 text-stone-500'
                                                        }`}>
                                                        {item.type === 'ONE_TIME' ? 'Milestone' : 'Routine'}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {todayPlan && todayPlan.plannedItems.length === 0 && (
                                    <div className="bg-white rounded-3xl border border-stone-100 p-5 text-center">
                                        <CheckCircle2 size={28} className="text-emerald-400 mx-auto mb-2" />
                                        <p className="text-stone-500 font-bold text-sm">No specific tasks planned for today.</p>
                                        <p className="text-stone-400 text-xs mt-1">Day {dayNumber} • Routine operations may still apply.</p>
                                    </div>
                                )}

                                {/* ═══════════════════════════════════════ */}
                                {/* SECTION 3: TIMELINE PROGRESS           */}
                                {/* ═══════════════════════════════════════ */}
                                {scheduleTemplate && scheduleTemplate.stages.length > 0 && (
                                    <div className="bg-white rounded-3xl border border-stone-100 shadow-sm p-5">
                                        <div className="flex items-center gap-2 mb-4">
                                            <Layers size={18} className="text-indigo-500" />
                                            <h4 className="font-black text-stone-800">Timeline Progress</h4>
                                            <span className="text-[10px] font-bold text-stone-400 ml-auto">{Math.round(progressPercent)}%</span>
                                        </div>

                                        {/* Progress Bar */}
                                        <div className="relative h-3 bg-stone-100 rounded-full overflow-hidden mb-4">
                                            <div
                                                className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full transition-all duration-700"
                                                style={{ width: `${progressPercent}%` }}
                                            />
                                            {/* Current position indicator */}
                                            <div
                                                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white border-3 border-emerald-500 rounded-full shadow-md transition-all duration-700"
                                                style={{ left: `calc(${progressPercent}% - 8px)` }}
                                            />
                                        </div>

                                        {/* Stage Markers */}
                                        <div className="space-y-2">
                                            {scheduleTemplate.stages.map((stage, idx) => {
                                                const isCurrent = currentStage?.id === stage.id;
                                                const isPast = dayNumber > stage.dayEnd;
                                                const _isFuture = dayNumber < stage.dayStart;

                                                return (
                                                    <div key={stage.id} className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-all ${isCurrent ? 'bg-emerald-50 border border-emerald-200' :
                                                        isPast ? 'opacity-50' : ''
                                                        }`}>
                                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 ${isCurrent ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/30' :
                                                            isPast ? 'bg-stone-300 text-white' :
                                                                'bg-stone-100 text-stone-400'
                                                            }`}>
                                                            {isPast ? '✓' : idx + 1}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <span className={`text-xs font-bold block truncate ${isCurrent ? 'text-emerald-800' : 'text-stone-600'
                                                                }`}>{stage.name}</span>
                                                        </div>
                                                        <span className="text-[10px] font-bold text-stone-400 flex-shrink-0">
                                                            Day {stage.dayStart}–{stage.dayEnd}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* Existing Detailed Timeline */}
                                {/* Adaptive Header */}
                                {(() => {
                                    const phaseInfo = getEffectivePhaseAndDay(displayPlot, getDateKey());
                                    if (phaseInfo.lossDays && phaseInfo.lossDays > 0) {
                                        return (
                                            <div className="mb-4 mx-2 p-3 bg-orange-50 border border-orange-100 rounded-lg flex items-center gap-3">
                                                <div className="bg-orange-100 p-2 rounded-full text-orange-600">
                                                    <Info size={18} />
                                                </div>
                                                <div>
                                                    <div className="text-orange-900 font-bold text-sm">
                                                        Schedule Adapted: Running {phaseInfo.lossDays} Days Behind
                                                    </div>
                                                    <div className="text-orange-700 text-xs">
                                                        Actual Day: {phaseInfo.day ? phaseInfo.day + phaseInfo.lossDays : '-'} • Effective Day for Plants: {phaseInfo.day}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    }
                                    return null;
                                })()}

                                <SchedulerTimeline
                                    plot={displayPlot}
                                    logs={logs || []}
                                    onEditLog={(date) => console.log('Edit log', date)}
                                    onEditSchedule={() => setViewMode('EDITOR')}
                                />
                            </div>
                        );
                    })}
                </div>
            )
            }

            {/* MODE: EDITOR (Schedule Maker Wizard) */}
            {
                viewMode === 'EDITOR' && (
                    <div className="animate-in fade-in slide-in-from-bottom-8 mt-4">
                        <ScheduleMaker
                            crops={crops}
                            onSave={(data) => {
                                console.log('Wizard Save:', data);
                                handleSave(data);
                            }}
                            onCancel={() => setViewMode('TIMELINE')}
                            userResources={userResources}
                            onAddResource={onAddResource}
                        />
                    </div>
                )
            }

            <MoneyLensDrawer
                isOpen={moneyLensOpen}
                onClose={() => setMoneyLensOpen(false)}
                filters={moneyLensFilters}
            />
        </div >
    );
};

export default SchedulerPage;

