/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import {
    CropActivityEvent, IrrigationEvent, LabourEvent,
    MachineryEvent, LedgerDefaults, FarmerProfile,
    InputEvent, AgriLogResponse, ActivityExpenseEvent, ObservationNote,
    PlannedTask, DailyLog, DisturbanceEvent, Plot
} from '../../../../../types';
import { isCompletedIrrigationEvent } from '../../../services/irrigationCompletion';
import { getDateKey } from '../../../../../core/domain/services/DateKeyService';

interface HydrationParams {
    initialData?: AgriLogResponse | null;
    activePlot: Plot | undefined;
    defaults?: LedgerDefaults;
    profile: FarmerProfile;
    todayLogs: DailyLog[];
    onDataConsumed?: () => void;
    hasVoiceDataBeenApplied: React.MutableRefObject<boolean>;
    initialAiDataRef: React.MutableRefObject<AgriLogResponse | null>;
    setCropActivities: React.Dispatch<React.SetStateAction<CropActivityEvent[]>>;
    setIrrigationMap: React.Dispatch<React.SetStateAction<Record<string, IrrigationEvent>>>;
    setLabourMap: React.Dispatch<React.SetStateAction<Record<string, LabourEvent>>>;
    setMachineryMap: React.Dispatch<React.SetStateAction<Record<string, MachineryEvent>>>;
    setInputMap: React.Dispatch<React.SetStateAction<Record<string, InputEvent[]>>>;
    setExpenses: React.Dispatch<React.SetStateAction<ActivityExpenseEvent[]>>;
    setObservations: React.Dispatch<React.SetStateAction<ObservationNote[]>>;
    setPlannedTasks: React.Dispatch<React.SetStateAction<PlannedTask[]>>;
    setDisturbance: React.Dispatch<React.SetStateAction<DisturbanceEvent | undefined>>;
    setTranscript: React.Dispatch<React.SetStateAction<string>>;
}

/**
 * Hydrates ManualEntry form state from existing logs for the active plot AND
 * overlays AI/voice data (initialData) when present. Behavior is byte-for-byte
 * identical to the inline useEffect originally in ManualEntry.tsx.
 */
export function useManualEntryHydration(params: HydrationParams): void {
    const {
        initialData, activePlot, defaults, profile, todayLogs, onDataConsumed,
        hasVoiceDataBeenApplied, initialAiDataRef,
        setCropActivities, setIrrigationMap, setLabourMap, setMachineryMap, setInputMap,
        setExpenses, setObservations, setPlannedTasks, setDisturbance, setTranscript,
    } = params;

    useEffect(() => {
        if (!activePlot) return;

        // If voice data was already applied (initialData just became null due to
        // onDataConsumed), do not re-run the hydration loop — that would wipe the
        // pre-filled form. The guard resets when this component unmounts (new voice
        // recording always causes a fresh ManualEntry mount).
        if (!initialData && hasVoiceDataBeenApplied.current) return;

        // 1. Core State Hydration (Existing Data Merging)
        // Ensure Global Activity Card Exists
        const globalActivity: CropActivityEvent = {
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
        let currentDisturbance: DisturbanceEvent | undefined;

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
                log.irrigation?.filter(isCompletedIrrigationEvent).forEach(irr => {
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

                if (log.disturbance && !currentDisturbance) {
                    currentDisturbance = log.disturbance;
                }
            });
        }

        // 2. SMART DATA OVERLAY (InitialData from Voice)
        if (initialData) {
            initialAiDataRef.current = initialData;
            // Handle Irrigation
            if (initialData.irrigation && initialData.irrigation.length > 0) {
                const aiIrrigation = initialData.irrigation.find(isCompletedIrrigationEvent);
                const infra = activePlot.infrastructure;
                const motorId = infra?.linkedMotorId || '';
                const source = 'Well';
                const method = infra?.irrigationMethod || defaults?.irrigation.method || 'drip';

                if (aiIrrigation) {
                    newIrrigationMap[globalActivity.id] = {
                        id: `irr_${Date.now()}`,
                        method: aiIrrigation.method !== 'unknown' && aiIrrigation.method ? aiIrrigation.method : method,
                        source: aiIrrigation.source !== 'unknown' && aiIrrigation.source ? aiIrrigation.source : source,
                        durationHours: aiIrrigation.durationHours ?? defaults?.irrigation.defaultDuration ?? 2,
                        waterVolumeLitres: aiIrrigation.waterVolumeLitres,
                        motorId: motorId,
                        linkedActivityId: globalActivity.id,
                        notes: aiIrrigation.notes,
                        issue: aiIrrigation.issue,
                        sourceText: aiIrrigation.sourceText,
                        systemInterpretation: aiIrrigation.systemInterpretation
                    };
                }
            }

            // Handle Labour
            if (initialData.labour && initialData.labour.length > 0) {
                initialData.labour.forEach((aiLabour, index) => {
                    const labourEntryId = index === 0 ? globalActivity.id : (aiLabour.id || `ai_labour_${index}`);
                    newLabourMap[labourEntryId] = {
                        id: aiLabour.id || `lab_${Date.now()}_${index}`,
                        type: (aiLabour.type as LabourEvent['type']) || 'HIRED',
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
                newInputMap[globalActivity.id] = initialData.inputs.map((inp, idx) => ({
                    id: `inp_${Date.now()}_${idx}`,
                    type: (inp.type as InputEvent['type']) || 'pesticide',
                    quantity: inp.quantity || 0,
                    unit: inp.unit || 'unit',
                    linkedActivityId: globalActivity.id,
                    method: inp.method || (inp.type === 'fertilizer' ? 'Soil' : 'Spray'),
                    mix: (inp.mix && inp.mix.length > 0)
                        ? inp.mix.map((item, mixIdx) => ({
                            ...item,
                            id: item.id || `mix_${Date.now()}_${idx}_${mixIdx}`,
                            productName: item.productName || inp.productName || 'Unknown',
                            dose: item.dose ?? inp.quantity,
                            unit: item.unit || inp.unit || 'unit',
                        }))
                        : [{
                            id: `mix_${Date.now()}_${idx}`,
                            productName: inp.productName || 'Unknown',
                            dose: inp.quantity,
                            unit: inp.unit || 'unit',
                        }],
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
                    type: (aiMach.type as MachineryEvent['type']) || 'tractor',
                    ownership: (aiMach.ownership as MachineryEvent['ownership']) || 'owned',
                    hoursUsed: aiMach.hoursUsed || 2,
                    linkedActivityId: globalActivity.id,
                    sourceText: aiMach.sourceText,
                    systemInterpretation: aiMach.systemInterpretation
                };
            } else if (hasSpray) {
                newMachineryMap[globalActivity.id] = { id: `mach_${Date.now()}_auto`, type: 'tractor', ownership: 'owned', hoursUsed: 2, linkedActivityId: globalActivity.id };
            }

            if (initialData.disturbance) {
                currentDisturbance = initialData.disturbance;
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
        setDisturbance(currentDisturbance);
        if (initialData) {
            // Mark guard so subsequent re-runs (after onDataConsumed nullifies
            // initialData) do not reset the form we just pre-filled.
            hasVoiceDataBeenApplied.current = true;
            if (onDataConsumed) onDataConsumed();
        }

    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: hydration effect — fires only when source data (`initialData`, `activePlot`, `defaults`, `profile`, `todayLogs`) flips. The setters and the `hasVoiceDataBeenApplied` ref are stable React identities and the `onDataConsumed` parent callback is intentionally fire-and-forget; including any of them would re-hydrate (and clobber user edits) on every parent render.
    }, [initialData, activePlot, defaults, profile, todayLogs]);
}
