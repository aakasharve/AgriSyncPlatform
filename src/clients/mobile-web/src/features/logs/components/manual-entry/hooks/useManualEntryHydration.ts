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
import type { ManualEntryFormOrigin } from '../types';

interface HydrationParams {
    initialData?: AgriLogResponse | null;
    activePlot: Plot | undefined;
    defaults?: LedgerDefaults;
    profile: FarmerProfile;
    todayLogs: DailyLog[];
    onDataConsumed?: () => void;
    hasVoiceDataBeenApplied: React.MutableRefObject<boolean>;
    initialAiDataRef: React.MutableRefObject<AgriLogResponse | null>;
    /**
     * spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-0b) — written by this
     * hook, read by the save button. This effect is the only code that knows whether
     * the form the farmer is looking at was filled by him or filled for him.
     */
    formOriginRef: React.MutableRefObject<ManualEntryFormOrigin>;
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
        hasVoiceDataBeenApplied, initialAiDataRef, formOriginRef,
        setCropActivities, setIrrigationMap, setLabourMap, setMachineryMap, setInputMap,
        setExpenses, setObservations, setPlannedTasks, setDisturbance, setTranscript,
    } = params;

    useEffect(() => {
        // Bail only when there is genuinely nothing to hydrate. We still want to
        // run for a fresh parse (initialData present) even when no single plot is
        // resolved — e.g. "Entire Farm" / multi-plot / overview selection, where
        // activePlot is undefined. Without this, the parsed flat buckets
        // (irrigation/labour/inputs/machinery) never load and the review screen
        // renders empty ("log accepted but no buckets render").
        if (!initialData && !activePlot) return;

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

        // Phase 14: HYDRATION - Load existing logs for this plot today to ensure "One Plot, One Card".
        // When no single plot is resolved (Entire Farm / multi-plot / overview), there is no
        // specific plot to merge existing-today logs against — skip this merge but still
        // synthesize the global card and overlay any initialData below.
        const logsForCurrentPlot = activePlot
            ? todayLogs.filter(l =>
                l.context.selection[0].selectedPlotIds.includes(activePlot.id)
            )
            : [];

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

        // task-0b (spec: dfes-farmer-facing-deploy-readiness-2026-08-14) — did the merge
        // above actually put anything in the form? Measured HERE, before the initialData
        // overlay writes into the same maps, so it reports only what came out of
        // already-saved logs. Presence of a log is not enough: a log that contributed
        // nothing leaves the form genuinely blank, and needlessly withholding a typed
        // day would revert the very fix task-0b landed.
        const filledFromExistingLogs =
            Object.keys(newLabourMap).length > 0
            || Object.keys(newIrrigationMap).length > 0
            || Object.keys(newMachineryMap).length > 0
            || Object.keys(newInputMap).length > 0
            || currentExpenses.length > 0
            || currentObservations.length > 0
            || currentTasks.length > 0
            || (globalActivity.workTypes?.length ?? 0) > 0
            || currentDisturbance !== undefined;

        // 2. SMART DATA OVERLAY (InitialData from Voice)
        if (initialData) {
            initialAiDataRef.current = initialData;
            // Handle Irrigation
            if (initialData.irrigation && initialData.irrigation.length > 0) {
                const aiIrrigation = initialData.irrigation.find(isCompletedIrrigationEvent);
                const infra = activePlot?.infrastructure;
                const motorId = infra?.linkedMotorId || '';
                // WAVE 2.1 (spec: dfes-companion-2026-07-11) — the plot's recorded
                // irrigation hardware is a fact the FARMER entered about this plot, so it
                // may stand in when the parse named no method. Nothing else may. The old
                // tail — `defaults?.irrigation.method || 'drip'`, a `'Well'` source and a
                // `defaults?.irrigation.defaultDuration ?? 2` duration — was app-authored
                // throughout: `ledgerDefaults` is seeded in useAppData (60 hours) and
                // never persisted, so a farmer never supplied any of it. Doctrine P4: no
                // default fills a bucket the farmer did not fill.
                const method = infra?.irrigationMethod || '';

                if (aiIrrigation) {
                    newIrrigationMap[globalActivity.id] = {
                        id: `irr_${Date.now()}`,
                        method: aiIrrigation.method !== 'unknown' && aiIrrigation.method ? aiIrrigation.method : method,
                        source: aiIrrigation.source !== 'unknown' && aiIrrigation.source ? aiIrrigation.source : '',
                        durationHours: aiIrrigation.durationHours,
                        waterVolumeLitres: aiIrrigation.waterVolumeLitres,
                        motorId: motorId,
                        linkedActivityId: globalActivity.id,
                        notes: aiIrrigation.notes,
                        issue: aiIrrigation.issue,
                        sourceText: aiIrrigation.sourceText,
                        systemInterpretation: aiIrrigation.systemInterpretation,
                        // ANTI-FABRICATION GUARDRAIL (spec: dfes-companion-2026-07-11)
                        provenanceVerified: aiIrrigation.provenanceVerified
                    };
                }
            }

            // Handle Labour
            if (initialData.labour && initialData.labour.length > 0) {
                initialData.labour.forEach((aiLabour, index) => {
                    const labourEntryId = index === 0 ? globalActivity.id : (aiLabour.id || `ai_labour_${index}`);
                    newLabourMap[labourEntryId] = {
                        id: aiLabour.id || `lab_${Date.now()}_${index}`,
                        // WAVE 2.1 — an unnamed engagement is not 'HIRED' and unnamed work
                        // is not "Field Work 1". Both are left blank for the farmer to fill.
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI payload type is open string; narrowed downstream
                        type: (aiLabour.type as any),
                        // Task 27 (spec: 2026-08-28-labour-v2-release-1) — the `|| 0` here
                        // violated the doctrine stated one line above it: an unstated
                        // headcount was being coerced into a fabricated "0 मजूर" on the
                        // pre-save panel (LabourReview.tsx). `count` is optional on both
                        // `LabourEvent` and the AI response Zod schema — pass it through
                        // unchanged so a genuinely stated 0 still reads as 0, and an
                        // unstated count stays undefined (rendered as the em-dash).
                        count: aiLabour.count,
                        maleCount: aiLabour.maleCount,
                        femaleCount: aiLabour.femaleCount,
                        activity: aiLabour.activity,
                        linkedActivityId: labourEntryId,
                        // Labour V1 Task 7.5 — this literal rebuilds the labour event
                        // field by field rather than spreading it, so anything not
                        // named here is dropped on the VOICE path only (it would still
                        // work in manual testing and fail in production). Both of these
                        // must survive: the stated hours, and the stable engagement id
                        // if one was already minted upstream.
                        durationHours: aiLabour.durationHours,
                        labourAssignmentId: aiLabour.labourAssignmentId,
                        sourceText: aiLabour.sourceText,
                        systemInterpretation: aiLabour.systemInterpretation,
                        // ANTI-FABRICATION GUARDRAIL (spec: dfes-companion-2026-07-11)
                        provenanceVerified: aiLabour.provenanceVerified
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
                    // ANTI-FABRICATION GUARDRAIL (spec: dfes-companion-2026-07-11) —
                    // every parsed cropActivity is merged into one globalActivity
                    // card (there is no per-item display here), so if ANY
                    // contributing activity failed sourceText verification, the
                    // merged card is flagged unverified. Never cleared back to
                    // true once set by a later activity in the same parse.
                    if (act.provenanceVerified === false) globalActivity.provenanceVerified = false;
                });
            }

            // Handle Inputs
            if (initialData.inputs && initialData.inputs.length > 0) {
                newInputMap[globalActivity.id] = initialData.inputs.map((inp, idx) => ({
                    id: `inp_${Date.now()}_${idx}`,
                    // WAVE 2.1 — THE LOAD-BEARING PAIR. `|| 'pesticide'` plus the
                    // `'Soil' : 'Spray'` tail together rewrote an untyped NPK fertiliser
                    // into a sprayed pesticide, and the invented 'Spray' was in turn what
                    // satisfied `hasSpray` and conjured a tractor below. Wave 3.4
                    // classifies the day's work from exactly these two fields.
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI payload type is open string; narrowed downstream
                    type: (inp.type as any),
                    quantity: inp.quantity || 0,
                    unit: inp.unit || 'unit',
                    linkedActivityId: globalActivity.id,
                    method: inp.method,
                    mix: (inp.mix && inp.mix.length > 0)
                        ? inp.mix.map((item, mixIdx) => ({
                            ...item,
                            id: item.id || `mix_${Date.now()}_${idx}_${mixIdx}`,
                            productName: item.productName || inp.productName || '',
                            dose: item.dose ?? inp.quantity,
                            unit: item.unit || inp.unit || 'unit',
                        }))
                        : [{
                            id: `mix_${Date.now()}_${idx}`,
                            // WAVE 2.1 — a product the parse could not name stays unnamed.
                            // 'Unknown' reads on screen as a real product the farmer used.
                            productName: inp.productName || '',
                            dose: inp.quantity,
                            unit: inp.unit || 'unit',
                        }],
                    sourceText: inp.sourceText,
                    systemInterpretation: inp.systemInterpretation,
                    // ANTI-FABRICATION GUARDRAIL (spec: dfes-companion-2026-07-11)
                    provenanceVerified: inp.provenanceVerified
                }));
            }

            // Handle Machinery
            //
            // WAVE 2.1 (spec: dfes-companion-2026-07-11) — THE WHOLE MACHINE IS GONE.
            // The deleted `else if (hasSpray)` branch fired when the parse returned NO
            // machinery at all, and invented an owned tractor running two hours off
            // nothing but an input row with no delivery method. It did not stay on the
            // screen either: ManualEntry POSTs the hydrated draft to
            // `/shramsafal/corrections` as CorrectedParse — the farmer's own correction
            // of the AI, asserting a tractor he never mentioned. There is no machinery
            // row unless the parse heard one, and its fields stay blank unless it named
            // them.
            if (initialData.machinery && initialData.machinery.length > 0) {
                const aiMach = initialData.machinery[0];
                newMachineryMap[globalActivity.id] = {
                    id: `mach_${Date.now()}`,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI payload types are open strings; narrowed downstream
                    type: (aiMach.type as any),
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AI payload types are open strings; narrowed downstream
                    ownership: (aiMach.ownership as any),
                    hoursUsed: aiMach.hoursUsed,
                    linkedActivityId: globalActivity.id,
                    sourceText: aiMach.sourceText,
                    systemInterpretation: aiMach.systemInterpretation,
                    // ANTI-FABRICATION GUARDRAIL (spec: dfes-companion-2026-07-11)
                    provenanceVerified: aiMach.provenanceVerified
                };
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
                        // WAVE 2.1 — an unscored observation stays unscored. 90 sits above
                        // the `< 60` threshold ObservationEventCard uses to render its
                        // low-confidence caveat, so the invented figure suppressed the one
                        // signal telling the farmer the machine was unsure.
                        aiConfidence: o.aiConfidence,
                        tags: o.tags || []
                    });
                });
            }
            if (initialData.plannedTasks) {
                initialData.plannedTasks.forEach(pt => {
                    currentTasks.push({
                        id: `task_${crypto.randomUUID()}`,
                        title: pt.title, status: 'suggested' as PlannedTask['status'], priority: 'normal' as PlannedTask['priority'], plotId: activePlot?.id || '', createdAt: new Date().toISOString(), sourceType: 'ai_extracted' as PlannedTask['sourceType'], description: pt.dueHint || undefined,
                        sourceText: pt.sourceText, systemInterpretation: pt.systemInterpretation,
                        // ANTI-FABRICATION GUARDRAIL (spec: dfes-companion-2026-07-11)
                        provenanceVerified: pt.provenanceVerified
                    });
                });
            }
            if (initialData.fullTranscript) setTranscript(initialData.fullTranscript);
        }

        // task-0b — DECLARE THE ORIGIN. This runs on every pass that actually fills the
        // form, so the marker always describes the state being committed just below.
        // The two early returns above are deliberately NOT covered: neither touches the
        // form, so the marker from the run that DID fill it stays correct (in
        // particular the `hasVoiceDataBeenApplied` return, which fires right after a
        // draft was applied and must not downgrade it to 'blank').
        formOriginRef.current = initialData
            ? 'prefilled-draft'
            : (filledFromExistingLogs ? 'existing-log' : 'blank');

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

        // Setters and refs are stable and intentionally omitted; re-running on
        // their identity would wipe the pre-filled form.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialData, activePlot, defaults, profile, todayLogs]);
}
