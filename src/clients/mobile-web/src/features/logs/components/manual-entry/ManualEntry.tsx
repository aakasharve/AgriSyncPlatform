/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
    CropActivityEvent, IrrigationEvent, LabourEvent,
    MachineryEvent, CropProfile, Plot,
    InputEvent, AgriLogResponse, TodayCounts, ActivityExpenseEvent, ObservationNote,
    PlannedTask, UnclearReason, DisturbanceEvent
} from '../../../../types';
import { BucketIssue } from '../../../../domain/types/log.types';
import { UnclearSegment } from '../../../logs/logs.types';
import { loadVocabDB, addApprovedMapping } from '../../../voice/vocab/vocabStore';
import { getDateKey } from '../../../../core/domain/services/DateKeyService';
import { buildWorkDoneProjection } from '../../services/workDoneProjection';
import { buildAiCorrectionEvents, persistAiCorrectionEvents, postAiCorrectionBlob } from '../../../../infrastructure/ai/CorrectionEventStore';

import { ManualEntryProps, TargetSelectionGroup } from './types';
import { useManualEntryHydration } from './hooks/useManualEntryHydration';
import { buildLinkedDetailMaps } from './services/loadLogIntoEditor';
import ManualEntryHeader from './components/ManualEntryHeader';
import UnclearSegmentsList from './components/UnclearSegmentsList';
import LabourReview from './components/LabourReview';
import ActivityLedger from './components/ActivityLedger';
import CostStrip from './components/CostStrip';
import ObservationHubSheet from '../ObservationHubSheet';
import { emitClosureSubmitted } from '../../../../core/telemetry/eventEmitters';
import { useFarmContext } from '../../../../core/session/FarmContext';

const ManualEntry: React.FC<ManualEntryProps> = ({ context, crops, defaults, profile, onSubmit, initialData, provenance, onDataConsumed, todayCountsMap, transcriptEntries = [], todayLogs = [], onLogSelect }) => {

    // DWC v2 §2.8 — closure.submitted emit context. The downstream
    // logCommandService generates the persisted DailyLog.id, so for
    // new-log saves we synthesize a valid UUID here purely so the analytics
    // event passes its Zod schema. Edits use the existing selectedLogId.
    // mountedAtRef is the form-open timestamp used for durationMs.
    const { currentFarmId } = useFarmContext();
    const mountedAtRef = React.useRef(Date.now());
    // Voice-vs-manual is determined by provenance.source at submit time.
    const [cropActivities, setCropActivities] = useState<CropActivityEvent[]>([]);
    const [expenses, setExpenses] = useState<ActivityExpenseEvent[]>([]);
    const [observations, setObservations] = useState<ObservationNote[]>([]); // New Observations State
    const [plannedTasks, setPlannedTasks] = useState<PlannedTask[]>([]); // NEW: Reminders State
    const [disturbance, setDisturbance] = useState<DisturbanceEvent | undefined>(undefined);
    const [showObservationHub, setShowObservationHub] = useState(false); // Hub Visibility
    const [transcript, setTranscript] = useState<string>(''); // NEW: Transcript State
    const [selectedLogId, setSelectedLogId] = useState<string | null>(null);  // Track which log is being edited

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
        setDisturbance(log.disturbance);
        setTranscript(log.fullTranscript || '');

        // Load linked detail maps
        const { labourMap: newLabourMap, irrigationMap: newIrrigationMap, machineryMap: newMachineryMap, inputMap: newInputMap } = buildLinkedDetailMaps(log);

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

    // Active Context for Defaults
    const [activeCrop, setActiveCrop] = useState<CropProfile | undefined>(undefined);
    const [activePlot, setActivePlot] = useState<Plot | undefined>(undefined);

    // --- DERIVE CONTEXT ---
    useEffect(() => {
        if (!context || context.selection.length === 0) {
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
            setActiveCrop(primaryCrop);
        } else {
            setActiveCrop(undefined);
        }

        setActivePlot(firstPlot);
    }, [context, crops]);

    // Guard ref: once voice data has been applied, prevent the effect from
    // clearing the form when onDataConsumed() sets initialData → null and
    // re-triggers this same effect.
    const hasVoiceDataBeenApplied = React.useRef(false);
    const initialAiDataRef = React.useRef<AgriLogResponse | null>(null);

    // --- PRE-FILL & HYDRATION ---
    useManualEntryHydration({
        initialData,
        activePlot,
        defaults,
        profile,
        todayLogs,
        onDataConsumed,
        hasVoiceDataBeenApplied,
        initialAiDataRef,
        setCropActivities,
        setIrrigationMap,
        setLabourMap,
        setMachineryMap,
        setInputMap,
        setExpenses,
        setObservations,
        setPlannedTasks,
        setDisturbance,
        setTranscript,
    });

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

    const updateDetails = (activityId: string, type: 'labour' | 'irrigation' | 'machinery' | 'input', data: LabourEvent | IrrigationEvent | MachineryEvent | InputEvent[]) => {
        if (type === 'labour') setLabourMap({ ...labourMap, [activityId]: { ...(data as LabourEvent), linkedActivityId: activityId } });
        if (type === 'irrigation') setIrrigationMap({ ...irrigationMap, [activityId]: { ...(data as IrrigationEvent), linkedActivityId: activityId } });
        if (type === 'machinery') setMachineryMap({ ...machineryMap, [activityId]: { ...(data as MachineryEvent), linkedActivityId: activityId } });
        if (type === 'input') setInputMap({ ...inputMap, [activityId]: data as InputEvent[] }); // Data is InputEvent[]
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
            ...finalInputs.map(i => i.cost || 0),
            ...expenses.map(e => e.totalAmount || 0)
        ];

        if (allCosts.some(c => c < 0)) {
            alert("❌ Negative costs are not allowed. Please check your entries.");
            return;
        }

        // WARNING: Cost > 0 but no details (Heuristic Guard)
        const totalCalculated = allCosts.reduce((a, b) => a + b, 0);
        const hasWork = buildWorkDoneProjection({
            cropActivities,
            irrigation: finalIrrigation,
            labour: finalLabour,
            machinery: finalMachinery,
            inputs: finalInputs,
            activityExpenses: expenses,
        }).length > 0;
        if (totalCalculated > 0 && !hasWork && observations.length === 0) {
            const proceed = confirm("⚠️ Costs are recorded but no work activities or observations are listed. Save anyway?");
            if (!proceed) return;
        }

        const userDraft = {
            cropActivities: cropActivities,
            irrigation: finalIrrigation,
            labour: finalLabour,
            machinery: finalMachinery,
            inputs: finalInputs,
            activityExpenses: expenses,
            observations,
            plannedTasks, // Include in submission
            disturbance,
            date: getDateKey(),
            manualTotalCost,
            fullTranscript: transcript,
            originalLogId: selectedLogId || undefined // Pass the ID if we are editing
        };

        if (initialAiDataRef.current && provenance?.source === 'ai') {
            const correctionEvents = buildAiCorrectionEvents({
                aiDraft: initialAiDataRef.current,
                userDraft,
                provenance,
            });
            void persistAiCorrectionEvents(correctionEvents)
                .catch(error => console.warn('[AI correction metrics] Failed to persist correction events.', error));
            // C11 W1.P4.T1 — best-effort server POST of the coarse correction blob.
            postAiCorrectionBlob({ aiDraft: initialAiDataRef.current, userDraft, provenance });
        }

        // DWC v2 §2.8 — closure.submitted (manual or voice path).
        // method == 'voice' iff the form was hydrated from a voice draft
        // (provenance.source === 'ai'); otherwise treated as 'manual'.
        // fields_used = number of populated buckets at submit time.
        if (currentFarmId) {
            const method = provenance?.source === 'ai' ? 'voice' : 'manual';
            const logIdForEmit = selectedLogId
                || (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                    ? crypto.randomUUID()
                    : null);
            if (logIdForEmit) {
                const bucketsTouched =
                    (cropActivities.length > 0 ? 1 : 0)
                    + (finalIrrigation.length > 0 ? 1 : 0)
                    + (finalLabour.length > 0 ? 1 : 0)
                    + (finalInputs.length > 0 ? 1 : 0)
                    + (finalMachinery.length > 0 ? 1 : 0)
                    + (expenses.length > 0 ? 1 : 0)
                    + (observations.length > 0 ? 1 : 0)
                    + (plannedTasks.length > 0 ? 1 : 0);
                emitClosureSubmitted({
                    farmId: currentFarmId,
                    logId: logIdForEmit,
                    method,
                    durationMs: Math.max(0, Date.now() - mountedAtRef.current),
                    fields_used: bucketsTouched,
                });
            }
        }

        onSubmit(userDraft);
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

    // Default counts if map not provided or plot not found
    const selectedPlotIds = context?.selection.flatMap(selection => selection.selectedPlotIds) || [];
    const zeroTodayCounts: TodayCounts = {
        cropActivities: 0,
        irrigation: 0,
        labour: 0,
        inputs: 0,
        machinery: 0,
        disturbance: 0,
        observations: 0,
        activityExpenses: 0,
        reminders: 0,
        harvest: 0,
    };
    const currentCounts = selectedPlotIds.length > 0 && todayCountsMap
        ? selectedPlotIds.reduce<TodayCounts>((acc, plotId) => {
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
                activityExpenses: acc.activityExpenses + (next.activityExpenses || 0),
                reminders: acc.reminders + (next.reminders || 0),
                harvest: acc.harvest + (next.harvest || 0),
            };
        }, zeroTodayCounts)
        : zeroTodayCounts;

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

    const handleCancelEdit = () => {
        setSelectedLogId(null);
        setCropActivities([]);
        setExpenses([]);
        setObservations([]);
        setDisturbance(undefined);
        setTranscript('');
        setLabourMap({});
        setIrrigationMap({});
        setMachineryMap({});
        setInputMap({});
        setManualTotalCost(undefined);
    };



    // SAFE GUARD: If no context, don't render (App handles overlay)
    // Placed here to ensure all Hooks run first
    if (!context || !context.selection.length) {
        return null;
    }

    return (
        <div className="w-full pb-24 relative">

            <ManualEntryHeader
                context={context}
                activeCrop={activeCrop}
                selectedPlotSummary={selectedPlotSummary}
                currentCounts={currentCounts}
                selectedPlotIds={selectedPlotIds}
                selectedTargetGroups={selectedTargetGroups}
                profile={profile}
                selectedLogId={selectedLogId}
                todayLogs={todayLogs}
                transcriptEntries={transcriptEntries}
                onLogSelect={handleLogSelect}
                onCancelEdit={handleCancelEdit}
                transcript={transcript}
                setTranscript={setTranscript}
                unclearSegmentsSlot={
                    <UnclearSegmentsList
                        unclearSegments={unclearSegments}
                        correctionId={correctionId}
                        correctionText={correctionText}
                        setCorrectionText={setCorrectionText}
                        onDismiss={handleDismissUnclear}
                        onManualEdit={handleManualEditUnclear}
                        onSubmitCorrection={submitCorrection}
                    />
                }
            />

            <LabourReview
                labourEntries={labourEntries}
                totalWorkerCount={totalWorkerCount}
            />

            {/* ACTIVITY LEDGER FORM */}
            <ActivityLedger
                selectedLogId={selectedLogId}
                cropActivities={cropActivities}
                labourMap={labourMap}
                irrigationMap={irrigationMap}
                machineryMap={machineryMap}
                inputMap={inputMap}
                expenses={expenses}
                observations={observations}
                plannedTasks={plannedTasks}
                disturbance={disturbance}
                crops={crops}
                todayLogs={todayLogs}
                profile={profile}
                activePlot={activePlot}
                activeCrop={activeCrop}
                defaults={defaults}
                setExpenses={setExpenses}
                setObservations={setObservations}
                onUpdateDetails={updateDetails}
                onDeleteActivity={deleteActivity}
                onUpdateWorkTypes={updateWorkTypes}
                onRefineWorkType={handleRefineWorkType}
                onUpdateIssue={updateIssue}
            />


            {/* TODO CEI §4.4: Wire ExecutionStatusSelector here for each ActivityCard.
                Import ExecutionStatusSelector from '../components/ExecutionStatusSelector'
                and render below the activity list when cropActivities.length > 0.
                Pass value={act.executionStatus ?? 'Completed'} and
                onChange={(status, devCode, devNote) => updateExecutionStatus(act.id, status, devCode, devNote)}. */}

            {/* COST STRIP (Static Footer) */}
            <CostStrip
                selectedLogId={selectedLogId}
                manualTotalCost={manualTotalCost}
                setManualTotalCost={setManualTotalCost}
                onSaveDay={handleSaveDay}
            />

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
