/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Plus, ListPlus, ChevronRight, Check, CheckSquare, StickyNote, Droplets, Users, ArrowUp, Edit3, Bell, Trash2 } from 'lucide-react';
import Button from '../../../shared/components/ui/Button';
import ActivityCard from './ActivityCard';
import { CropSymbol } from '../../context/components/CropSelector';
import SlidingCropSelector from '../../context/components/SlidingCropSelector';
import { getActiveHarvestSession, startHarvestSession } from '../../../services/harvestService';
import HarvestConfigSheet from './harvest/HarvestConfigSheet';
import { HarvestConfig } from '../../../types';
import ActivityExpenseCard from './ActivityExpenseCard';
import ContextBanner from '../../context/components/ContextBanner';
import ObservationHubSheet from './ObservationHubSheet';
import TranscriptTimeline from './TranscriptTimeline';
import {
    FarmContext, CropActivityEvent, IrrigationEvent, LabourEvent,
    MachineryEvent, LedgerDefaults, FarmerProfile, CropProfile,
    WorkflowStep, InputEvent, Plot, AgriLogResponse, TodayCounts, ActivityExpenseEvent, ObservationNote,
    LogTimelineEntry, PlannedTask, DailyLog, UnclearReason
} from '../../../types';
import { BucketIssue } from '../../../domain/types/log.types';
import UnclearSegmentCard from '../../../shared/components/ui/UnclearSegmentCard';
import { UnclearSegment } from '../../logs/logs.types';
import { loadVocabDB, addApprovedMapping } from '../../voice/vocab/vocabStore';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { getCropTheme } from '../../../shared/utils/colorTheme';




const SAFE_DEFAULTS: LedgerDefaults = {
    irrigation: {
        method: 'drip',
        source: 'Well',
        defaultDuration: 2
    },
    labour: {
        defaultWage: 300,
        defaultHours: 8,
        shifts: []
    },
    machinery: {
        defaultRentalCost: 1000,
        defaultFuelCost: 200
    }
};

interface TargetSelectionGroup {
    cropId: string;
    cropName: string;
    iconName?: string;
    color: string;
    plotNames: string[];
}

const MultiTargetDestinationCard: React.FC<{ groups: TargetSelectionGroup[] }> = ({ groups }) => {
    return (
        <div className="mx-4 mb-4 rounded-[2rem] border border-emerald-100 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">Review Save Target</p>
                    <p className="mt-1 text-sm font-semibold text-stone-700">
                        This log will be stored in each crop below with its selected plots.
                    </p>
                </div>
                <div className="rounded-2xl bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">
                    {groups.reduce((sum, group) => sum + group.plotNames.length, 0)} plots
                </div>
            </div>

            <div className="mt-4 space-y-3">
                {groups.map((group) => {
                    const theme = getCropTheme(group.color);

                    return (
                        <div
                            key={`${group.cropId}-${group.plotNames.join('|')}`}
                            className={`rounded-[1.6rem] border p-1 shadow-lg ${theme.border} ${theme.shadow}`}
                        >
                            <div className={`rounded-[1.4rem] p-4 ${theme.slideBgSelected}`}>
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-white/70">
                                            {group.iconName ? <CropSymbol name={group.iconName} size="md" /> : <div className={`h-3 w-3 rounded-full ${group.color}`} />}
                                        </div>
                                        <div>
                                            <p className={`text-base font-black ${theme.text}`}>{group.cropName}</p>
                                            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-stone-500">
                                                {group.plotNames.length === 1 ? '1 plot selected' : `${group.plotNames.length} plots selected`}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-3 flex flex-wrap gap-2">
                                    {group.plotNames.map((plotName) => (
                                        <span
                                            key={`${group.cropId}-${plotName}`}
                                            className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-bold text-stone-800 shadow-sm"
                                        >
                                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] text-white">
                                                <Check size={12} strokeWidth={3} />
                                            </span>
                                            {plotName}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

interface ManualEntryProps {
    context: FarmContext | null;
    crops: CropProfile[]; // Added dynamic crops
    defaults?: LedgerDefaults;
    profile: FarmerProfile;
    onSubmit: (data: {
        cropActivities: CropActivityEvent[];
        irrigation: IrrigationEvent[];
        labour: LabourEvent[];
        inputs: InputEvent[];
        machinery: MachineryEvent[];
        activityExpenses: ActivityExpenseEvent[];
        observations: ObservationNote[];
        plannedTasks: PlannedTask[]; // NEW
        date: string;
        manualTotalCost?: number;
        fullTranscript?: string;
        originalLogId?: string; // NEW: ID of the log being edited
    }) => void;
    disabled?: boolean;
    initialData?: AgriLogResponse | null;
    onDataConsumed?: () => void;
    todayCountsMap?: Record<string, TodayCounts>;
    transcriptEntries?: LogTimelineEntry[];  // Today's past logs for timeline display
    todayLogs?: DailyLog[];                  // Full log objects for loading into editor
    onLogSelect?: (logId: string) => void;   // Callback when user selects a log to edit
}

const ManualEntry: React.FC<ManualEntryProps> = ({ context, crops, defaults, profile, onSubmit, disabled, initialData, onDataConsumed, todayCountsMap, transcriptEntries = [], todayLogs = [], onLogSelect }) => {

    // --- STATE ---
    const [cropActivities, setCropActivities] = useState<CropActivityEvent[]>([]);
    const [expenses, setExpenses] = useState<ActivityExpenseEvent[]>([]);
    const [observations, setObservations] = useState<ObservationNote[]>([]); // New Observations State
    const [plannedTasks, setPlannedTasks] = useState<PlannedTask[]>([]); // NEW: Reminders State
    const [showObservationHub, setShowObservationHub] = useState(false); // Hub Visibility
    const [transcript, setTranscript] = useState<string>(''); // NEW: Transcript State
    const [selectedLogId, setSelectedLogId] = useState<string | null>(null);  // Track which log is being edited

    // New Harvest State
    const [showHarvestConfig, setShowHarvestConfig] = useState(false);
    const [pendingHarvestActivity, setPendingHarvestActivity] = useState<CropActivityEvent | null>(null);

    // Phase 7: Unclear Segments
    const [unclearSegments, setUnclearSegments] = useState<UnclearSegment[]>([]);
    const [correctionId, setCorrectionId] = useState<string | null>(null);
    const [correctionText, setCorrectionText] = useState('');

    // Handler for loading a past log into the editor
    const handleLogSelect = (logId: string) => {
        const log = todayLogs.find(l => l.id === logId);
        if (!log) return;

        // Load all data from the selected log
        setSelectedLogId(logId);
        setCropActivities(log.cropActivities || []);
        setExpenses(log.activityExpenses || []);
        setObservations(log.observations || []);
        setPlannedTasks(log.plannedTasks || []); // Hydrate Reminders
        setTranscript(log.fullTranscript || '');

        // Load linked detail maps
        const newLabourMap: Record<string, LabourEvent> = {};
        const newIrrigationMap: Record<string, IrrigationEvent> = {};
        const newMachineryMap: Record<string, MachineryEvent> = {};
        const newInputMap: Record<string, InputEvent[]> = {};

        log.labour?.forEach(l => { if (l.linkedActivityId) newLabourMap[l.linkedActivityId] = l; });
        log.irrigation?.forEach(i => { if (i.linkedActivityId) newIrrigationMap[i.linkedActivityId] = i; });
        log.machinery?.forEach(m => { if (m.linkedActivityId) newMachineryMap[m.linkedActivityId] = m; });
        log.inputs?.forEach(inp => {
            if (inp.linkedActivityId) {
                if (!newInputMap[inp.linkedActivityId]) newInputMap[inp.linkedActivityId] = [];
                newInputMap[inp.linkedActivityId].push(inp);
            }
        });

        setLabourMap(newLabourMap);
        setIrrigationMap(newIrrigationMap);
        setMachineryMap(newMachineryMap);
        setInputMap(newInputMap);

        // Notify parent if callback provided
        onLogSelect?.(logId);

        // Scroll to top of form
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };


    // (Moved safety check to bottom to preserve Hook order)

    // Linked details stored by ActivityID
    const [labourMap, setLabourMap] = useState<Record<string, LabourEvent>>({});
    const [irrigationMap, setIrrigationMap] = useState<Record<string, IrrigationEvent>>({});
    const [machineryMap, setMachineryMap] = useState<Record<string, MachineryEvent>>({});
    const [inputMap, setInputMap] = useState<Record<string, InputEvent[]>>({});

    const [manualTotalCost, setManualTotalCost] = useState<number | undefined>(undefined);

    // Custom Activity Input
    const [customInput, setCustomInput] = useState('');

    // Common Activities
    const [commonActivities, setCommonActivities] = useState<WorkflowStep[]>([]);

    // Active Context for Defaults
    const [activeCrop, setActiveCrop] = useState<CropProfile | undefined>(undefined);
    const [activePlot, setActivePlot] = useState<Plot | undefined>(undefined);

    // --- DERIVE CONTEXT ---
    useEffect(() => {
        if (!context || context.selection.length === 0) {
            setCommonActivities([]);
            setActiveCrop(undefined);
            setActivePlot(undefined);
            return;
        }

        const primarySelection = context.selection[0];
        const primaryCrop = crops.find(c => c.id === primarySelection.cropId);
        const firstPlotId = context.selection.flatMap(selection => selection.selectedPlotIds)[0];
        const firstPlot = firstPlotId
            ? crops.flatMap(crop => crop.plots).find(plot => plot.id === firstPlotId)
            : undefined;

        if (context.selection.length === 1 && primaryCrop) {
            setCommonActivities(primaryCrop.workflow || []);
            setActiveCrop(primaryCrop);
        } else {
            setCommonActivities([]);
            setActiveCrop(undefined);
        }

        setActivePlot(firstPlot);
    }, [context, crops]);

    // Guard ref: once voice data has been applied, prevent the effect from
    // clearing the form when onDataConsumed() sets initialData → null and
    // re-triggers this same effect.
    const hasVoiceDataBeenApplied = React.useRef(false);

    // --- PRE-FILL & HYDRATION ---
    useEffect(() => {
        if (!activePlot) return;

        // If voice data was already applied (initialData just became null due to
        // onDataConsumed), do not re-run the hydration loop — that would wipe the
        // pre-filled form. The guard resets when this component unmounts (new voice
        // recording always causes a fresh ManualEntry mount).
        if (!initialData && hasVoiceDataBeenApplied.current) return;

        // 1. Core State Hydration (Existing Data Merging)
        // Ensure Global Activity Card Exists
        let globalActivity: CropActivityEvent = {
            id: 'act_global_daily',
            title: 'Crop Activity',
            status: 'completed',
            isCommonActivity: false,
            workTypes: []
        };

        const newIrrigationMap: Record<string, IrrigationEvent> = {};
        const newLabourMap: Record<string, LabourEvent> = {};
        const newMachineryMap: Record<string, MachineryEvent> = {};
        const newInputMap: Record<string, InputEvent[]> = {};

        // Phase 14: HYDRATION - Load existing logs for this plot today to ensure "One Plot, One Card"
        const logsForCurrentPlot = todayLogs.filter(l =>
            l.context.selection[0].selectedPlotIds.includes(activePlot.id)
        );

        const currentExpenses: ActivityExpenseEvent[] = [];
        const currentObservations: ObservationNote[] = [];
        const currentTasks: PlannedTask[] = [];

        if (logsForCurrentPlot.length > 0) {
            logsForCurrentPlot.forEach(log => {
                // Merge Work Types
                log.cropActivities?.forEach(act => {
                    act.workTypes?.forEach(wt => {
                        if (!globalActivity.workTypes?.includes(wt)) {
                            globalActivity.workTypes = [...(globalActivity.workTypes || []), wt];
                        }
                    });
                    if (act.sourceText) {
                        const newText = act.sourceText;
                        if (!globalActivity.sourceText?.includes(newText)) {
                            globalActivity.sourceText = globalActivity.sourceText ? `${globalActivity.sourceText} | ${newText}` : newText;
                        }
                    }
                    if (act.systemInterpretation) {
                        const newInt = act.systemInterpretation;
                        if (!globalActivity.systemInterpretation?.includes(newInt)) {
                            globalActivity.systemInterpretation = globalActivity.systemInterpretation ? `${globalActivity.systemInterpretation} | ${newInt}` : newInt;
                        }
                    }
                });

                // Merge Labour
                log.labour?.forEach((lab, index) => {
                    const labourEntryId = index === 0 ? globalActivity.id : (lab.id || `existing_labour_${log.id}_${index}`);
                    newLabourMap[labourEntryId] = { ...lab, linkedActivityId: labourEntryId };
                });

                // Merge Irrigation
                log.irrigation?.forEach(irr => {
                    newIrrigationMap[globalActivity.id] = { ...irr, linkedActivityId: globalActivity.id };
                });

                // Merge Machinery
                log.machinery?.forEach(mach => {
                    newMachineryMap[globalActivity.id] = { ...mach, linkedActivityId: globalActivity.id };
                });

                // Merge Inputs
                log.inputs?.forEach(inp => {
                    if (!newInputMap[globalActivity.id]) newInputMap[globalActivity.id] = [];
                    newInputMap[globalActivity.id].push({ ...inp, linkedActivityId: globalActivity.id });
                });

                // Merge Expenses
                if (log.activityExpenses) {
                    log.activityExpenses.forEach(e => {
                        if (!currentExpenses.some(ex => ex.id === e.id)) {
                            currentExpenses.push({ ...e, linkedActivityId: globalActivity.id });
                        }
                    });
                }

                // Merge Observations
                if (log.observations) {
                    log.observations.forEach(o => {
                        if (!currentObservations.some(obs => obs.id === o.id)) {
                            currentObservations.push(o);
                        }
                    });
                }

                // Merge Planned Tasks
                if (log.plannedTasks) {
                    log.plannedTasks.forEach(t => {
                        if (!currentTasks.some(tsk => tsk.id === t.id)) {
                            currentTasks.push(t);
                        }
                    });
                }
            });
        }

        // 2. SMART DATA OVERLAY (InitialData from Voice)
        if (initialData) {
            // Handle Irrigation
            if (initialData.irrigation && initialData.irrigation.length > 0) {
                const aiIrrigation = initialData.irrigation[0];
                const infra = activePlot.infrastructure;
                const motorId = infra?.linkedMotorId || '';
                const source = 'Well';
                const method = infra?.irrigationMethod || defaults?.irrigation.method || 'drip';

                newIrrigationMap[globalActivity.id] = {
                    id: `irr_${Date.now()}`,
                    method: aiIrrigation.method !== 'unknown' && aiIrrigation.method ? aiIrrigation.method : method,
                    source: aiIrrigation.source !== 'unknown' && aiIrrigation.source ? aiIrrigation.source : source,
                    durationHours: aiIrrigation.durationHours || 2,
                    motorId: motorId,
                    linkedActivityId: globalActivity.id,
                    sourceText: aiIrrigation.sourceText,
                    systemInterpretation: aiIrrigation.systemInterpretation
                };
            }

            // Handle Labour
            if (initialData.labour && initialData.labour.length > 0) {
                initialData.labour.forEach((aiLabour, index) => {
                    const labourEntryId = index === 0 ? globalActivity.id : (aiLabour.id || `ai_labour_${index}`);
                    newLabourMap[labourEntryId] = {
                        id: aiLabour.id || `lab_${Date.now()}_${index}`,
                        type: (aiLabour.type as any) || 'HIRED',
                        count: aiLabour.count || 0,
                        maleCount: aiLabour.maleCount,
                        femaleCount: aiLabour.femaleCount,
                        activity: aiLabour.activity || `Field Work ${index + 1}`,
                        linkedActivityId: labourEntryId,
                        sourceText: aiLabour.sourceText,
                        systemInterpretation: aiLabour.systemInterpretation
                    };
                });
            }

            // Handle Crop Activities
            const genericTitles = ['Farm Labour', 'Irrigation', 'Field Work', 'Crop Activity', 'Work Done'];
            if (initialData.cropActivities && initialData.cropActivities.length > 0) {
                initialData.cropActivities.forEach(act => {
                    // Add workTypes array first (most specific — e.g. "Tillage", "Pruning")
                    act.workTypes?.forEach(wt => {
                        if (!globalActivity.workTypes?.includes(wt)) {
                            globalActivity.workTypes = [...(globalActivity.workTypes || []), wt];
                        }
                    });
                    // Add title only if it's a specific name, not a generic placeholder
                    if (act.title && !genericTitles.includes(act.title)) {
                        if (!globalActivity.workTypes?.includes(act.title)) {
                            globalActivity.workTypes = [...(globalActivity.workTypes || []), act.title];
                        }
                    }
                    if (act.sourceText) globalActivity.sourceText = act.sourceText;
                    if (act.systemInterpretation) globalActivity.systemInterpretation = act.systemInterpretation;
                });
            }

            // Handle Inputs
            if (initialData.inputs && initialData.inputs.length > 0) {
                if (!globalActivity.workTypes?.includes('Manure & Fertilizers')) {
                    globalActivity.workTypes = [...(globalActivity.workTypes || []), 'Manure & Fertilizers'];
                }
                newInputMap[globalActivity.id] = initialData.inputs.map((inp, idx) => ({
                    id: `inp_${Date.now()}_${idx}`,
                    type: (inp.type as any) || 'pesticide',
                    quantity: inp.quantity || 0,
                    unit: inp.unit || 'L',
                    linkedActivityId: globalActivity.id,
                    method: inp.method || (inp.type === 'fertilizer' ? 'Soil' : 'Spray'),
                    mix: [{ id: `mix_${Date.now()}`, productName: inp.productName || 'Unknown', dose: 0, unit: 'ml/L' }],
                    sourceText: inp.sourceText,
                    systemInterpretation: inp.systemInterpretation
                }));
            }

            // Handle Machinery
            const hasSpray = initialData.inputs && initialData.inputs.some(i => i.method === 'Spray' || !i.method);
            if (initialData.machinery && initialData.machinery.length > 0) {
                const aiMach = initialData.machinery[0];
                newMachineryMap[globalActivity.id] = {
                    id: `mach_${Date.now()}`,
                    type: (aiMach.type as any) || 'tractor',
                    ownership: (aiMach.ownership as any) || 'owned',
                    hoursUsed: aiMach.hoursUsed || 2,
                    linkedActivityId: globalActivity.id,
                    sourceText: aiMach.sourceText,
                    systemInterpretation: aiMach.systemInterpretation
                };
            } else if (hasSpray) {
                newMachineryMap[globalActivity.id] = { id: `mach_${Date.now()}_auto`, type: 'tractor', ownership: 'owned', hoursUsed: 2, linkedActivityId: globalActivity.id };
            }

            // Handle Disturbance → create blocked bucket markers
            if (initialData.disturbance) {
                const dist = initialData.disturbance;
                // Map disturbance group to BucketIssue type
                const issueTypeMap: Record<string, 'MACHINERY' | 'ELECTRICITY' | 'WEATHER' | 'WATER_SOURCE' | 'OTHER'> = {
                    equipment: 'MACHINERY',
                    electricity: 'ELECTRICITY',
                    power: 'ELECTRICITY',
                    weather: 'WEATHER',
                    rain: 'WEATHER',
                    water: 'WATER_SOURCE',
                };
                const issueType = issueTypeMap[dist.group?.toLowerCase() || ''] || 'OTHER';
                const issueSeverity: 'LOW' | 'MEDIUM' | 'HIGH' = (dist.severity as 'LOW' | 'MEDIUM' | 'HIGH') || 'HIGH';

                // Irrigation blocked → create an irrigation event with issue (shows amber bucket)
                if (dist.blockedSegments?.includes('irrigation') && !newIrrigationMap[globalActivity.id]) {
                    newIrrigationMap[globalActivity.id] = {
                        id: `irr_blocked_${Date.now()}`,
                        method: 'Drip',
                        source: 'Bore',
                        durationHours: 0,
                        linkedActivityId: globalActivity.id,
                        issue: {
                            issueType,
                            reason: dist.reason || 'Equipment failure',
                            note: dist.note || '',
                            severity: issueSeverity,
                            sourceText: dist.note
                        },
                        sourceText: dist.note
                    };
                }
            }

            // Handle Expenses/Observations/Tasks/Transcript
            if (initialData.activityExpenses) {
                initialData.activityExpenses.forEach(e => currentExpenses.push({ ...e, linkedActivityId: globalActivity.id }));
            }
            if (initialData.observations) {
                initialData.observations.forEach(o => {
                    currentObservations.push({
                        ...o,
                        id: o.id || `obs_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        plotId: o.plotId || activePlot?.id || '',
                        dateKey: o.dateKey || getDateKey(),
                        timestamp: o.timestamp || new Date().toISOString(),
                        status: o.status || 'open',
                        source: o.source || 'voice',
                        textRaw: o.textRaw || o.textCleaned || 'No text',
                        textCleaned: o.textCleaned || o.textRaw,
                        noteType: o.noteType || 'observation',
                        severity: o.severity || 'normal',
                        aiConfidence: o.aiConfidence || 90,
                        tags: o.tags || []
                    });
                });
            }
            if (initialData.plannedTasks) {
                initialData.plannedTasks.forEach(pt => {
                    currentTasks.push({
                        id: `task_${crypto.randomUUID()}`,
                        title: pt.title, status: 'suggested' as PlannedTask['status'], priority: 'normal' as PlannedTask['priority'], plotId: activePlot.id, createdAt: new Date().toISOString(), sourceType: 'ai_extracted' as PlannedTask['sourceType'], description: pt.dueHint || undefined,
                        sourceText: pt.sourceText, systemInterpretation: pt.systemInterpretation
                    });
                });
            }
            if (initialData.fullTranscript) setTranscript(initialData.fullTranscript);
        }

        // Apply Final State
        setCropActivities([globalActivity]);
        setIrrigationMap(newIrrigationMap);
        setLabourMap(newLabourMap);
        setMachineryMap(newMachineryMap);
        setInputMap(newInputMap);
        setExpenses(currentExpenses);
        setObservations(currentObservations);
        setPlannedTasks(currentTasks);
        if (initialData) {
            // Mark guard so subsequent re-runs (after onDataConsumed nullifies
            // initialData) do not reset the form we just pre-filled.
            hasVoiceDataBeenApplied.current = true;
            if (onDataConsumed) onDataConsumed();
        }

    }, [initialData, activePlot, defaults, profile, todayLogs]);

    // Phase 7: Load Unclear Segments
    useEffect(() => {
        if (initialData?.unclearSegments) {
            setUnclearSegments(initialData.unclearSegments.map(s => ({
                ...s,
                id: s.id || `seg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                rawText: s.rawText || 'Unclear audio segment',
                confidence: s.confidence || 0.5,
                reason: ((s.reason && ['ambiguous_verb', 'unknown_vocabulary', 'incomplete_sentence', 'conflicting_markers', 'no_actionable_content', 'audio_quality', 'mixed_languages', 'unknown'].includes(s.reason)) ? s.reason : 'unknown') as UnclearReason,
                userMessage: s.userMessage || "I couldn't quite understand this part, please check."
            })));
        }
    }, [initialData]);

    const handleDismissUnclear = (id: string) => {
        setUnclearSegments(prev => prev.filter(s => s.id !== id));
    };

    const handleManualEditUnclear = (id: string) => {
        const seg = unclearSegments.find(s => s.id === id);
        if (seg) {
            setCorrectionId(id);
            setCorrectionText(seg.rawText); // Prefill with original
        }
    };

    const submitCorrection = () => {
        const segment = unclearSegments.find(s => s.id === correctionId);
        if (segment && correctionText) {
            // Learn from correction if it's a vocabulary issue
            if (segment.reason === 'unknown_vocabulary' || segment.reason === 'ambiguous_verb') {
                try {
                    const db = loadVocabDB();
                    addApprovedMapping(db, {
                        colloquial: segment.rawText,
                        standard: correctionText,
                        category: 'other', // Generic fallback
                        context: 'User manual correction',
                        confidence: 1.0,
                        usageCount: 1,
                        learnedDate: new Date().toISOString(),
                        lastUsed: new Date().toISOString(),
                        approvedByUser: true
                    });
                } catch (e) {
                    console.error("Failed to learn vocab", e);
                }
            }

            // Add text to transcript so it's not lost
            setTranscript(prev => (prev ? prev + '\n' : '') + `[Correction]: ${correctionText}`);

            // Remove from UI
            handleDismissUnclear(segment.id);
            setCorrectionId(null);
            setCorrectionText('');
        }
    };

    // Handle Config Save
    const handleHarvestConfigSaved = (config: HarvestConfig) => {
        if (!activePlot) return;

        // Auto-start a session since they are trying to log harvest
        const session = startHarvestSession(activePlot.id, activeCrop?.id || '', config);

        // Link pending activity
        if (pendingHarvestActivity) {
            setCropActivities(prev => prev.map(a =>
                a.id === pendingHarvestActivity.id
                    ? { ...a, linkedHarvestSessionId: session.id }
                    : a
            ));
            setPendingHarvestActivity(null);
        }

        setShowHarvestConfig(false);
    };

    const addActivity = (name: string, isCommon: boolean = false) => {
        // Instead of adding a NEW card, we add this 'name' as a workType to the global card

        let globalCard = cropActivities[0];

        // AUTO-CREATE if missing (fixes empty state bug)
        if (!globalCard) {
            globalCard = {
                id: 'act_global_daily',
                title: 'Crop Activity',
                status: 'completed',
                isCommonActivity: false,
                workTypes: []
            };
            // Note: We'll update state with this new card at the end or use a temporary var
        }

        if (name === 'Irrigation') {
            // ... Irrigation Logic (Update Map Only) ...
            if (activePlot) {
                const infra = activePlot.infrastructure;
                const method = infra?.irrigationMethod || activePlot.irrigationPlan?.method || 'Drip';
                const motorId = infra?.linkedMotorId || activePlot.irrigationPlan?.motorId;
                const motor = profile.motors.find(m => m.id === motorId);
                const source = profile.waterResources.find(w => w.id === motor?.linkedWaterSourceId);
                const duration = activePlot.irrigationPlan?.durationMinutes ? activePlot.irrigationPlan.durationMinutes / 60 : 2;

                const irrigationEvent: IrrigationEvent = {
                    id: `irr_${Date.now()}`,
                    linkedActivityId: globalCard.id,
                    method: method,
                    source: source?.name || 'Unknown',
                    durationHours: duration,
                    motorId: motorId,
                    notes: 'Logged via Quick Add'
                };
                setIrrigationMap(prev => ({ ...prev, [globalCard.id]: irrigationEvent }));

                // If we created a new card, ensure it's saved to state
                if (cropActivities.length === 0) {
                    setCropActivities([globalCard]);
                }
            }
        }
        else if (name === 'Labour' || name === 'Farm Labour') {
            // No-op
        }
        else {
            // It is a specific work type (Pruning, Weeding etc)
            const updatedCard = {
                ...globalCard,
                workTypes: [...(globalCard.workTypes || []), name]
            };
            // If it was empty, we are now setting it with the new workType
            if (cropActivities.length === 0) {
                setCropActivities([updatedCard]);
            } else {
                setCropActivities([updatedCard]);
            }
        }
    };

    const addExpense = () => {
        const newExpense: ActivityExpenseEvent = {
            id: `exp_${Date.now()}`,
            reason: '',
            items: [],
            totalAmount: 0
        };
        setExpenses([...expenses, newExpense]);
    };

    const updateExpense = (updated: ActivityExpenseEvent) => {
        setExpenses(expenses.map(e => e.id === updated.id ? updated : e));
    };

    const deleteExpense = (id: string) => {
        setExpenses(expenses.filter(e => e.id !== id));
    };

    const handleAddCustom = (e: React.FormEvent) => {
        e.preventDefault();
        if (customInput.trim()) {
            addActivity(customInput.trim(), false);
            setCustomInput('');
        }
    };

    const renameActivity = (id: string, newName: string) => {
        setCropActivities(cropActivities.map(t => t.id === id ? { ...t, title: newName } : t));
    };

    const updateDetails = (activityId: string, type: 'labour' | 'irrigation' | 'machinery' | 'input', data: any) => {
        if (type === 'labour') setLabourMap({ ...labourMap, [activityId]: { ...data, linkedActivityId: activityId } });
        if (type === 'irrigation') setIrrigationMap({ ...irrigationMap, [activityId]: { ...data, linkedActivityId: activityId } });
        if (type === 'machinery') setMachineryMap({ ...machineryMap, [activityId]: { ...data, linkedActivityId: activityId } });
        if (type === 'input') setInputMap({ ...inputMap, [activityId]: data }); // Data is InputEvent[]
    };

    const updateWorkTypes = (activityId: string, types: string[]) => {
        setCropActivities(cropActivities.map(a => a.id === activityId ? { ...a, workTypes: types } : a));
    };

    const updateIssue = (activityId: string, issue: BucketIssue | undefined) => {
        setCropActivities(cropActivities.map(a => a.id === activityId ? { ...a, issue: issue } : a));
    };

    const deleteActivity = (id: string) => {
        setCropActivities(cropActivities.filter(t => t.id !== id));
        const newL = { ...labourMap }; delete newL[id]; setLabourMap(newL);
        const newI = { ...irrigationMap }; delete newI[id]; setIrrigationMap(newI);
        const newM = { ...machineryMap }; delete newM[id]; setMachineryMap(newM);
        const newIn = { ...inputMap }; delete newIn[id]; setInputMap(newIn);
    };

    const handleSaveDay = () => {
        const finalLabour = Object.values(labourMap);
        const finalIrrigation = Object.values(irrigationMap);
        const finalMachinery = Object.values(machineryMap);
        const finalInputs = Object.values(inputMap).flat();

        // VALIDATION: Prevent negative costs (Cofounder Mode Guard)
        const allCosts = [
            ...finalLabour.map(l => l.totalCost || 0),
            ...finalMachinery.map(m => m.rentalCost || 0),
            ...finalInputs.map(i => (i as any).cost || 0),
            ...expenses.map(e => e.totalAmount || 0)
        ];

        if (allCosts.some(c => c < 0)) {
            alert("❌ Negative costs are not allowed. Please check your entries.");
            return;
        }

        // WARNING: Cost > 0 but no details (Heuristic Guard)
        const totalCalculated = allCosts.reduce((a, b) => a + b, 0);
        const hasWork = cropActivities.some(a => (a.workTypes || []).length > 0) || finalIrrigation.length > 0;
        if (totalCalculated > 0 && !hasWork && observations.length === 0) {
            const proceed = confirm("⚠️ Costs are recorded but no work activities or observations are listed. Save anyway?");
            if (!proceed) return;
        }

        onSubmit({
            cropActivities: cropActivities,
            irrigation: finalIrrigation,
            labour: finalLabour,
            machinery: finalMachinery,
            inputs: finalInputs,
            activityExpenses: expenses,
            observations,
            plannedTasks, // Include in submission
            date: getDateKey(),
            manualTotalCost,
            fullTranscript: transcript,
            originalLogId: selectedLogId || undefined // Pass the ID if we are editing
        });
    };

    const handleRefineWorkType = (oldType: string, newType: string, mode: 'manual' | 'voice') => {
        if (mode === 'manual') {
            setCropActivities(prev => prev.map(act => ({
                ...act,
                workTypes: act.workTypes?.map(w => w === oldType ? newType : w) || (act.title === oldType ? [newType] : [])
            })));
        } else {
            // mode === 'voice' - simplified for now, usually would trigger a global "Clarification" mic session
            // For now, we just log it or show a placeholder as we don't have a specific "Segment Mic" hook yet
            console.log(`🎙️ Voice refinement for: ${oldType}`);
        }
    };

    // --- RENDER HELPERS ---

    const renderPlotSelector = () => {
        if (!context) return null;

        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-6 animate-in fade-in space-y-8">
                <div>
                    <div className="inline-block bg-emerald-50 p-4 rounded-full mb-4">
                        <ListPlus size={32} className="text-emerald-600" />
                    </div>
                    <h3 className="text-xl font-bold text-slate-800 mb-2">Select Target Plot</h3>
                    <p className="text-slate-500 max-w-xs mx-auto">You have multiple plots active. Choose one to log activities for.</p>
                </div>

                <div className="w-full max-w-4xl mx-auto">
                    <SlidingCropSelector
                        crops={crops}
                        selectedCropId={activeCrop?.id || null}
                        onSelect={(id) => {
                            const crop = crops.find(c => c.id === id);
                            if (crop) {
                                setActiveCrop(crop);
                                setCommonActivities(crop.workflow || []);
                                // Auto-select first plot if none selected? 
                                // Or wait for user to select plot from list below?
                                // SlidingCropSelector implies selecting crop shows plots.
                                // We want to select a plot eventually.
                                // Let's auto-select the first plot to speed up interaction
                                if (crop.plots.length > 0) setActivePlot(crop.plots[0]);
                            }
                        }}
                        selectedPlotIds={activePlot ? [activePlot.id] : []}
                        onPlotSelect={(plotId) => {
                            // Find plot in active crop
                            const plot = activeCrop?.plots.find(p => p.id === plotId);
                            if (plot) setActivePlot(plot);
                        }}
                        onCropSelect={(id) => {
                            // Redundant but good for standardized prop usage
                            const crop = crops.find(c => c.id === id);
                            if (crop) {
                                setActiveCrop(crop);
                                setCommonActivities(crop.workflow || []);
                                if (crop.plots.length > 0) setActivePlot(crop.plots[0]);
                            }
                        }}
                    />
                </div>
            </div>
        );
    };

    // Default counts if map not provided or plot not found
    const selectedPlotIds = context?.selection.flatMap(selection => selection.selectedPlotIds) || [];
    const currentCounts = selectedPlotIds.length > 0 && todayCountsMap
        ? selectedPlotIds.reduce((acc, plotId) => {
            const next = todayCountsMap[plotId];
            if (!next) return acc;

            return {
                cropActivities: acc.cropActivities + (next.cropActivities || 0),
                irrigation: acc.irrigation + (next.irrigation || 0),
                labour: acc.labour + (next.labour || 0),
                inputs: acc.inputs + (next.inputs || 0),
                machinery: acc.machinery + (next.machinery || 0),
                disturbance: acc.disturbance + (next.disturbance || 0),
                observations: acc.observations + (next.observations || 0),
                activityExpenses: (acc as any).activityExpenses + ((next as any).activityExpenses || 0),
                reminders: (acc as any).reminders + ((next as any).reminders || 0),
                harvest: (acc as any).harvest + ((next as any).harvest || 0)
            } as any;
        }, {
            cropActivities: 0,
            irrigation: 0,
            labour: 0,
            inputs: 0,
            machinery: 0,
            disturbance: 0,
            observations: 0,
            activityExpenses: 0,
            reminders: 0,
            harvest: 0
        } as any)
        : {
            cropActivities: 0,
            irrigation: 0,
            labour: 0,
            inputs: 0,
            machinery: 0,
            disturbance: 0,
            observations: 0,
            activityExpenses: 0,
            reminders: 0,
            harvest: 0
        };

    const selectedPlotSummary = (() => {
        if (!context || context.selection.length === 0) return 'No selection';
        const selectedPairs = context.selection.flatMap(selection =>
            selection.selectedPlotNames.map(plotName => ({
                cropName: selection.cropName,
                plotName
            }))
        );

        if (selectedPairs.length === 1) {
            return `${selectedPairs[0].cropName} • ${selectedPairs[0].plotName}`;
        }

        return `${selectedPairs.length} plots across ${context.selection.length} crops`;
    })();

    const selectedTargetGroups: TargetSelectionGroup[] = (context?.selection || []).map((selection) => {
        const crop = crops.find(item => item.id === selection.cropId);
        return {
            cropId: selection.cropId,
            cropName: selection.cropName,
            iconName: crop?.iconName,
            color: crop?.color || 'bg-slate-500',
            plotNames: selection.selectedPlotNames,
        };
    }).filter(group => group.plotNames.length > 0);

    const labourEntries = Object.values(labourMap);
    const totalWorkerCount = labourEntries.reduce((sum, entry) => {
        if (typeof entry.count === 'number' && entry.count > 0) {
            return sum + entry.count;
        }

        return sum + (entry.maleCount || 0) + (entry.femaleCount || 0);
    }, 0);



    // SAFE GUARD: If no context, don't render (App handles overlay)
    // Placed here to ensure all Hooks run first
    if (!context || !context.selection.length) {
        return null;
    }

    return (
        <div className="w-full pb-24 relative">

            {/* CONTEXT BANNER */}
            {/* HEADER CONTEXT BANNER */}
            <ContextBanner
                date={new Date().toISOString()}
                context={context}
                activeCrop={activeCrop}
                activePlotName={selectedPlotSummary}
                todayCounts={currentCounts as any}
            />

            {selectedPlotIds.length > 1 && (
                <MultiTargetDestinationCard groups={selectedTargetGroups} />
            )}

            {/* OPERATOR ATTRIBUTION */}
            <div className="px-4 py-2 flex justify-between items-center text-xs text-slate-500 bg-slate-50/50 border-b border-slate-100 mb-4 mx-4 rounded-b-xl -mt-2 pt-4">
                <div className="flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-slate-400" />
                    <span>Logging as: <strong className="text-slate-700">{profile.operators.find(op => op.id === profile.activeOperatorId)?.name || 'Unknown'}</strong></span>
                </div>
                {selectedLogId && (
                    <div className="flex items-center gap-1.5 bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full border border-amber-100">
                        <Edit3 className="w-3 h-3" />
                        <span>Editing Log by: <strong>{profile.operators.find(op => op.id === todayLogs.find(l => l.id === selectedLogId)?.meta?.createdByOperatorId)?.name || 'Unknown'}</strong></span>
                    </div>
                )}
            </div>

            {/* Editing indicator removed in favor of integrated header */}

            {/* HEADER & TIMELINE SECTION */}
            <div className="space-y-4 mb-6">
                {/* TODAY'S PAST LOGS TIMELINE */}
                {transcriptEntries.length > 0 && (
                    <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm animate-in slide-in-from-top-2">
                        <TranscriptTimeline
                            entries={transcriptEntries}
                            maxDisplay={3}
                            onEntryClick={handleLogSelect}
                        />
                    </div>
                )}

                {/* UNCLEAR SEGMENTS CARD STACK */}
                {unclearSegments.length > 0 && (
                    <div className="mb-6 space-y-2 animate-in slide-in-from-top-4">
                        {unclearSegments.map(seg => (
                            <div key={seg.id}>
                                <UnclearSegmentCard
                                    segment={seg}
                                    onRelog={(id) => {
                                        // Simple reset for now, essentially dismiss + user can speak again globally
                                        handleDismissUnclear(id);
                                    }}
                                    onManualEdit={handleManualEditUnclear}
                                    onDismiss={handleDismissUnclear}
                                />
                                {/* Correction Input Overlay */}
                                {correctionId === seg.id && (
                                    <div className="ml-4 mr-4 -mt-2 mb-4 bg-white p-3 rounded-b-xl border-x border-b border-red-100 shadow-sm animate-in fade-in">
                                        <label className="text-xs font-bold text-slate-500 mb-1 block">Correct Meaning:</label>
                                        <div className="flex gap-2">
                                            <input
                                                autoFocus
                                                type="text"
                                                value={correctionText}
                                                onChange={e => setCorrectionText(e.target.value)}
                                                className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
                                                placeholder="What did you mean?"
                                            />
                                            <button
                                                onClick={submitCorrection}
                                                className="bg-emerald-600 text-white px-3 py-2 rounded-lg text-xs font-bold"
                                            >
                                                Save
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* MODE HEADER */}
                {/* MODE HEADER - Only show when editing */}
                {selectedLogId && (
                    <div className="flex items-center justify-between px-1 mb-2">
                        <div className="flex items-center gap-2">
                            <div className="p-2 rounded-xl bg-amber-100 text-amber-700">
                                <Edit3 size={18} />
                            </div>
                            <div>
                                <h3 className="font-bold text-sm uppercase tracking-wider text-amber-700">
                                    Fixing Past Record
                                </h3>
                                <p className="text-[10px] text-stone-400 font-medium">
                                    Changes will update this log
                                </p>
                            </div>
                        </div>

                        <button
                            onClick={() => {
                                setSelectedLogId(null);
                                setCropActivities([]);
                                setExpenses([]);
                                setObservations([]);
                                setTranscript('');
                                setLabourMap({});
                                setIrrigationMap({});
                                setMachineryMap({});
                                setInputMap({});
                                setManualTotalCost(undefined);
                            }}
                            className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-lg font-bold transition-colors"
                        >
                            Cancel Edit
                        </button>
                    </div>
                )}

                {/* TRANSCRIPT EDITOR (If present) */}
                {transcript && (
                    <div className={`bg-white border rounded-2xl p-4 shadow-sm relative group transition-colors ${selectedLogId ? 'border-amber-200 bg-amber-50/10' : 'border-emerald-100'}`}>
                        <div className={`flex items-center gap-2 mb-2 ${selectedLogId ? 'text-amber-700' : 'text-emerald-700'}`}>
                            <StickyNote size={14} />
                            <span className="text-xs font-bold uppercase tracking-wider">Voice Transcript</span>
                        </div>
                        <textarea
                            value={transcript}
                            onChange={(e) => setTranscript(e.target.value)}
                            className="w-full text-lg font-medium text-stone-700 bg-transparent border-none outline-none resize-none p-0 leading-relaxed placeholder:text-stone-300 focus:ring-0"
                            rows={Math.max(2, Math.ceil(transcript.length / 40))}
                        />
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="text-[10px] bg-stone-100 text-stone-500 px-2 py-1 rounded-full font-bold">Editable</span>
                        </div>
                    </div>
                )}
            </div>

            {labourEntries.length > 0 && (
                <div className="mb-6 rounded-2xl border border-orange-200 bg-orange-50/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-700">Labour Review</p>
                            <p className="mt-1 text-sm font-semibold text-stone-700">
                                Total workers: {totalWorkerCount} ({labourEntries.map(entry => entry.count || ((entry.maleCount || 0) + (entry.femaleCount || 0))).join(' + ')})
                            </p>
                        </div>
                    </div>

                    <div className="mt-3 space-y-2">
                        {labourEntries.map((entry, index) => (
                            <div key={`${entry.id}-${index}`} className="rounded-xl border border-orange-100 bg-white/90 px-3 py-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full bg-orange-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-orange-700">
                                        {entry.activity || 'Labour'}
                                    </span>
                                    <span className="text-sm font-bold text-stone-800">
                                        {entry.count || ((entry.maleCount || 0) + (entry.femaleCount || 0))} workers
                                    </span>
                                </div>
                                {entry.sourceText && (
                                    <p className="mt-2 text-xs italic text-stone-500">"{entry.sourceText}"</p>
                                )}
                                {entry.systemInterpretation && (
                                    <p className="mt-1 text-[11px] font-medium text-stone-600">{entry.systemInterpretation}</p>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ACTIVITY LEDGER FORM */}
            <div className={`space-y-4 min-h-[200px] border-l-2 pl-4 transition-colors ${selectedLogId ? 'border-amber-200' : 'border-emerald-100/50'}`}>


                {cropActivities.length === 0 ? (
                    <div className="border-2 border-dashed border-stone-200 rounded-2xl p-8 text-center bg-stone-50/50">
                        <p className="text-stone-400 font-bold">No activities logged today</p>
                        <p className="text-xs text-stone-300 mt-1">Select above or type to add</p>
                    </div>
                ) : (
                    cropActivities.map(act => (
                        <ActivityCard
                            key={act.id}
                            activity={act}
                            linkedData={{
                                labour: labourMap[act.id],
                                irrigation: irrigationMap[act.id],
                                machinery: machineryMap[act.id],
                            }}
                            inputs={inputMap[act.id] || []}
                            onUpdateDetails={(type, data) => updateDetails(act.id, type, data)}
                            onDeleteActivity={() => deleteActivity(act.id)}
                            onUpdateWorkTypes={(types) => updateWorkTypes(act.id, types)}
                            defaults={defaults || SAFE_DEFAULTS}
                            profile={profile}
                            currentPlot={activePlot}
                            cropContractUnit={activeCrop?.contractUnitDefault}
                            expenses={expenses.filter(e => e.linkedActivityId === act.id)} // Pass linked expenses
                            onAddExpense={(data) => {
                                const newExp = { ...data, linkedActivityId: act.id };
                                setExpenses([...expenses, newExp]);
                            }}
                            onUpdateExpenses={(updatedExp) => {
                                setExpenses(expenses.map(e => e.id === updatedExp.id ? updatedExp : e));
                            }}
                            onDeleteExpense={(expId) => {
                                setExpenses(expenses.filter(e => e.id !== expId));
                            }}
                            plannedTasks={plannedTasks} // Sync global tasks to card buckets
                            observations={observations} // Pass all observations
                            crops={crops} // Pass crops for HubSheet context
                            onAddObservation={(note) => setObservations([...observations, note])}
                            todayLogs={todayLogs} // Pass full log objects for aggregation
                            onRefineWorkType={handleRefineWorkType}
                            onUpdateIssue={(issue) => updateIssue(act.id, issue)}
                        />
                    ))
                )}
            </div>


            {/* COST STRIP (Static Footer) */}
            <div className="mt-8 mb-4 max-w-xl mx-auto animate-in slide-in-from-bottom-2 fade-in duration-500">
                <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-2 pl-5 flex items-center justify-between gap-4">

                    {/* Input Section */}
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="bg-emerald-100 p-2 rounded-full text-emerald-700 shrink-0">
                            <img src="/assets/rupee_gold.png" alt="Cost" className="w-5 h-5" />
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[10px] font-bold text-stone-400 uppercase leading-none mb-0.5">Total Paid</span>
                            <div className="flex items-center">
                                <span className="text-stone-400 font-bold mr-1">₹</span>
                                <input
                                    type="number"
                                    placeholder="0"
                                    className="font-bold text-lg text-stone-800 outline-none bg-transparent w-full placeholder:text-stone-300"
                                    value={manualTotalCost || ''}
                                    onChange={e => setManualTotalCost(parseFloat(e.target.value))}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Action Button */}
                    <Button
                        onClick={handleSaveDay}
                        className={`rounded-xl px-8 py-4 text-white shadow-lg shrink-0 whitespace-nowrap text-lg font-bold transition-colors ${selectedLogId
                            ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-200'
                            : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200'
                            }`}
                    >
                        {selectedLogId ? 'Update Log' : 'Save Entry'}
                    </Button>
                </div>
            </div>

            {/* OBSERVATION HUB SHEET */}
            <ObservationHubSheet
                isOpen={showObservationHub}
                onClose={() => setShowObservationHub(false)}
                onSave={(note) => {
                    setObservations(prev => [...prev, note]);
                }}
                existingNotes={observations}
                crops={crops}
                selectedCropId={activeCrop?.id}
                selectedPlotId={activePlot?.id}
                selectedDate={new Date().toLocaleDateString('en-CA')} // YYYY-MM-DD
            />
        </div>
    );
};

export default ManualEntry;
