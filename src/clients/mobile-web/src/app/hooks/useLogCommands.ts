import { useCallback, useMemo } from 'react';
import {
    AgriLogResponse, LogScope, CropProfile, FarmerProfile, DailyLog,
    InputMode, PageView, AppStatus, PlannedTask
} from '../../types';
import { LogProvenance } from '../../domain/ai/LogProvenance';
import { logger } from '../../infrastructure/observability/Logger';
import { CorrelationId } from '../../infrastructure/observability/CorrelationContext';
import { WeatherPort } from '../../application/ports/WeatherPort';
import { computeDayState } from '../../shared/utils/dayState';
import type { LastSavedLogSummaryItem } from '../uiRuntimeTypes';

// ARCHITECTURE FIX: Import Service Class and Hook
import { LogCommandServiceImpl } from '../../application/services/LogCommandService';
import { useDataSource } from '../providers/DataSourceProvider';
import { enqueueLogsForSync } from '../../features/logs/services/logSyncMutationService';

export interface UseLogCommandsResult {
    handleAutoSave: (logData: AgriLogResponse, provenance?: LogProvenance) => Promise<void>;
    handleFinalConfirm: (editedData: AgriLogResponse | null, draftLog: AgriLogResponse | null) => Promise<void>;
    handleManualSubmit: (data: any) => Promise<void>;
    handleWizardSubmit: (logs: DailyLog[]) => Promise<void>;
    handleUpdateNote: (logId: string, noteId: string, updates: any) => void;
    // Exposed for testing/advanced usage
    service: LogCommandServiceImpl;
}

interface UseLogCommandsProps {
    hasActiveLogContext: boolean;
    logScope: LogScope;
    setLogScope: (scope: LogScope) => void;
    crops: CropProfile[];
    farmerProfile: FarmerProfile;
    history: DailyLog[];
    plannedTasks: PlannedTask[];
    isDemoMode: boolean; // Kept for logic checks if needed, but persistence is agnostic
    // Unified History Setter
    setHistory: React.Dispatch<React.SetStateAction<DailyLog[]>>;

    // Deprecated setters (ignored in new logic but kept for prop compatibility if not updated in parent)
    setMockHistory?: any;
    setRealHistory?: any;

    setPlannedTasks: React.Dispatch<React.SetStateAction<PlannedTask[]>>;
    setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
    setError: (msg: string | null) => void;
    setDraftLog: (log: AgriLogResponse | null) => void;
    setRecordingSegment: (seg: any) => void;
    setMode: (mode: InputMode) => void;
    setMainView: (view: PageView) => void;
    setStatus: (status: AppStatus) => void;
    setLastSavedLogSummary: React.Dispatch<React.SetStateAction<LastSavedLogSummaryItem[]>>;
    setLastSavedLogIds: React.Dispatch<React.SetStateAction<string[]>>;
    weatherProvider?: WeatherPort;
}

const countSuccessfulIrrigationEvents = (events: Array<{ durationHours?: number; waterVolumeLitres?: number; method?: string; source?: string }>): number => {
    return events.filter(event => {
        if ((event.durationHours || 0) > 0) return true;
        if ((event.waterVolumeLitres || 0) > 0) return true;
        return Boolean(event.method || event.source);
    }).length;
};

export const useLogCommands = ({
    hasActiveLogContext,
    logScope,
    setLogScope,
    crops,
    farmerProfile,
    history,
    plannedTasks,
    isDemoMode,
    setHistory,
    setPlannedTasks,
    setToast,
    setError,
    setDraftLog,
    setRecordingSegment,
    setMode,
    setMainView,
    setStatus,
    setLastSavedLogSummary,
    setLastSavedLogIds,
    weatherProvider
}: UseLogCommandsProps): UseLogCommandsResult => {

    // --- DATA SOURCE & SERVICE ---
    const { dataSource } = useDataSource();

    const logCommandService = useMemo(() => {
        return new LogCommandServiceImpl(dataSource.logs, weatherProvider);
    }, [dataSource.logs, weatherProvider]);

    // --- HELPER: CALCULATE SUMMARY ---
    const calculateLogSummary = (logs: DailyLog[]) => {
        const summary: LastSavedLogSummaryItem[] = logs.map(log => {
            const selection = log.context.selection[0];
            const contextCropId = selection?.cropId;
            const cropName = contextCropId === 'FARM_GLOBAL'
                ? 'Farm'
                : crops.find(c => c.id === contextCropId)?.name || 'Unknown Crop';
            const plotId = selection?.selectedPlotIds?.[0];
            const plotName = selection?.selectedPlotNames?.[0]
                || crops
                    .find(crop => crop.id === contextCropId)
                    ?.plots.find(plot => plot.id === plotId)
                    ?.name
                || 'Farm';

            const count = (log.cropActivities?.length || 0) +
                (log.labour?.length || 0) +
                (log.inputs?.length || 0) +
                (log.machinery?.length || 0) +
                countSuccessfulIrrigationEvents(log.irrigation || []);

            return {
                logId: log.id,
                cropId: contextCropId,
                cropName,
                plotId,
                plotName,
                count,
            };
        });
        setLastSavedLogSummary(summary);
    };

    const computeClosureDelta = useCallback((beforeLogs: DailyLog[], afterLogs: DailyLog[]) => {
        const beforePercent = computeDayState({
            logs: beforeLogs,
            crops,
            tasks: plannedTasks
        }).closurePercent;
        const afterPercent = computeDayState({
            logs: afterLogs,
            crops,
            tasks: plannedTasks
        }).closurePercent;
        return { beforePercent, afterPercent };
    }, [crops, plannedTasks]);

    // --- AUTO SAVE ---
    const handleAutoSave = useCallback(async (logData: AgriLogResponse, provenance?: LogProvenance) => {

        // PHASE 25: Context Switching & Global Voice
        let effectiveScope = logScope;

        if (logData.suggestedContext) {
            const { cropId, plotId } = logData.suggestedContext;
            if (cropId && plotId) {
                // Construct new scope for the log
                effectiveScope = {
                    mode: 'single',
                    selectedCropIds: [cropId],
                    selectedPlotIds: [plotId],
                    applyPolicy: 'broadcast'
                };

                // Switch UI context seamlessly
                setLogScope(effectiveScope);
                logger.info('Context auto-switched via Voice', { cropId, plotId });
            }
        }

        // Safety check: Must have effective scope or active context
        if (!hasActiveLogContext && !logData.suggestedContext) {
            logger.warn("Auto-save blocked: No context");
            return;
        }

        const correlationId = CorrelationId.generate();
        logger.info('Auto-save started', { correlationId, summary: logData.summary });

        try {
            // SINGLE WRITE PATH: Delegate to Service
            const newLogs = await logCommandService.createFromVoice(
                logData,
                effectiveScope,
                crops,
                farmerProfile,
                provenance
            );

            // Persist (Service handles persistence via injected repo)
            await logCommandService.confirmAndSave(
                newLogs,
                setHistory // Update UI
            );
            if (!isDemoMode) {
                await enqueueLogsForSync(newLogs);
            }

            // Sync: Extract and add any planned tasks from the new logs to global state
            const newTasks = newLogs.flatMap(l => l.plannedTasks || []);
            if (newTasks.length > 0) {
                setPlannedTasks(prev => mergeUniqueTasks(prev, newTasks));
            }

            // Calculate Summary for Feedback
            calculateLogSummary(newLogs);
            setLastSavedLogIds(newLogs.map(l => l.id));

            const { beforePercent, afterPercent } = computeClosureDelta(
                history,
                [...newLogs, ...history]
            );

            // AUTO-SAVE SUCCESS: Show the success screen instead of just a toast
            setToast({
                message: `Logged. Day closure: ${beforePercent}% -> ${afterPercent}%`,
                type: 'success'
            });
            setStatus('success');
            setMode('manual'); // Ensure we are in a view that shows the success state overlay

            logger.info('Auto-save completed', { correlationId });
        } catch (e) {
            logger.error("Auto-save error", e, { correlationId });
            setToast({ message: "Failed to auto-save", type: 'error' });
            setError("Failed to auto-save. Please check your connection.");
        }
    }, [hasActiveLogContext, logScope, crops, farmerProfile, logCommandService, setHistory, setPlannedTasks, setToast, setStatus, setMode, setLastSavedLogSummary, setLastSavedLogIds, setError, computeClosureDelta, history, setLogScope]);

    // --- FINAL CONFIRM ---
    const handleFinalConfirm = useCallback(async (editedData: AgriLogResponse | null, draftLog: AgriLogResponse | null) => {
        const finalLog = editedData || draftLog;
        if (!finalLog || !hasActiveLogContext) return; // SAFE GUARD

        const correlationId = CorrelationId.generate();
        logger.info('Final confirm started', { correlationId });

        try {
            // SINGLE WRITE PATH: Delegate to Service
            const newLogs = await logCommandService.createFromVoice(
                finalLog,
                logScope,
                crops,
                farmerProfile,
                // Provenance might be lost here if we don't pass it from draft, 
                // but usually draft has it in meta. For now, undefined new provenance.
            );

            // Persist
            await logCommandService.confirmAndSave(
                newLogs,
                setHistory
            );
            if (!isDemoMode) {
                await enqueueLogsForSync(newLogs);
            }

            // Sync: Extract and add any planned tasks from the new logs to global state
            const newCreatedTasks = newLogs.flatMap(l => l.plannedTasks || []);
            if (newCreatedTasks.length > 0) {
                setPlannedTasks(prev => mergeUniqueTasks(prev, newCreatedTasks));
            }

            setDraftLog(null);
            setRecordingSegment(null);

            // Phase 14: Jump to Manual Ledger after confirmation
            // Calculate Summary for Feedback (re-calc for final state)
            calculateLogSummary(newLogs);
            setLastSavedLogIds(newLogs.map(l => l.id));

            const { beforePercent, afterPercent } = computeClosureDelta(
                history,
                [...newLogs, ...history]
            );
            setToast({
                message: `Logged. Day closure: ${beforePercent}% -> ${afterPercent}%`,
                type: 'success'
            });

            setMode('manual');
            setMainView('log');

            // Reset status to idle so UI doesn't stay on 'success' screen
            setStatus('idle');
            logger.info('Final confirm completed', { correlationId });
        } catch (e) {
            logger.error("Final confirm error", e, { correlationId });
            setError("Failed to save logs. Please try again.");
        }
    }, [hasActiveLogContext, logScope, crops, farmerProfile, logCommandService, setHistory, setPlannedTasks, setDraftLog, setRecordingSegment, setMode, setMainView, setStatus, setError, setLastSavedLogSummary, setLastSavedLogIds, computeClosureDelta, history, setToast]);

    // --- MANUAL SUBMIT ---
    const handleManualSubmit = useCallback(async (data: any) => {
        if (!hasActiveLogContext) return; // SAFE GUARD
        try {
            if (data.originalLogId) {
                // --- SECURE UPDATE ---
                // SINGLE WRITE PATH: Delegate to Service
                const result = await logCommandService.updateLog(
                    data.originalLogId,
                    { ...data, id: data.originalLogId },
                    farmerProfile,
                    'Manual Edit via UI'
                );

                if (!result.success) {
                    throw new Error(result.error || 'Update failed');
                }

                // Update local state reflectively
                setHistory(prev => {
                    const filtered = prev.filter(l => l.id !== data.originalLogId);
                    return [result.log as DailyLog, ...filtered];
                });

                const filteredHistory = history.filter(l => l.id !== data.originalLogId);
                const nextHistory = [result.log as DailyLog, ...filteredHistory];
                const { beforePercent, afterPercent } = computeClosureDelta(history, nextHistory);
                setToast({
                    message: `Logged. Day closure: ${beforePercent}% -> ${afterPercent}%`,
                    type: 'success'
                });

            } else {
                // --- CREATE NEW ---
                // SINGLE WRITE PATH: Delegate to Service
                const newLogs = await logCommandService.createFromManual(
                    data,
                    logScope,
                    crops,
                    farmerProfile
                );

                await logCommandService.confirmAndSave(
                    newLogs,
                    setHistory
                );
                if (!isDemoMode) {
                    await enqueueLogsForSync(newLogs);
                }

                // Sync
                const manualTasks = newLogs.flatMap(l => l.plannedTasks || []);
                if (manualTasks.length > 0) {
                    setPlannedTasks(prev => mergeUniqueTasks(prev, manualTasks));
                }

                calculateLogSummary(newLogs);
                setLastSavedLogIds(newLogs.map(l => l.id));

                const nextHistory = [...newLogs, ...history];
                const { beforePercent, afterPercent } = computeClosureDelta(history, nextHistory);
                setToast({
                    message: `Logged. Day closure: ${beforePercent}% -> ${afterPercent}%`,
                    type: 'success'
                });
            }

            setStatus('success');
        } catch (e) {
            console.error("Critical error in handleManualSubmit:", e);
            setError("Failed to save logs. Please try again.");
        }
    }, [hasActiveLogContext, logScope, crops, farmerProfile, logCommandService, setHistory, setPlannedTasks, setStatus, setError, setLastSavedLogSummary, setLastSavedLogIds, computeClosureDelta, history, setToast]);

    const handleWizardSubmit = useCallback(async (logs: DailyLog[]) => {
        if (logs.length === 0) {
            setError('No plots selected for this log.');
            return;
        }

        try {
            await logCommandService.confirmAndSave(logs, setHistory);
            if (!isDemoMode) {
                await enqueueLogsForSync(logs);
            }

            const wizardTasks = logs.flatMap(log => log.plannedTasks || []);
            if (wizardTasks.length > 0) {
                setPlannedTasks(prev => mergeUniqueTasks(prev, wizardTasks));
            }

            calculateLogSummary(logs);
            setLastSavedLogIds(logs.map(log => log.id));

            const nextHistory = [...logs, ...history];
            const { beforePercent, afterPercent } = computeClosureDelta(history, nextHistory);
            setToast({
                message: `Logged once. Saved to ${logs.length} plots. Day closure: ${beforePercent}% -> ${afterPercent}%`,
                type: 'success'
            });

            setStatus('success');
        } catch (error) {
            console.error('Critical error in handleWizardSubmit:', error);
            setError('Failed to save wizard logs. Please try again.');
        }
    }, [computeClosureDelta, history, logCommandService, setError, setHistory, setLastSavedLogIds, setLastSavedLogSummary, setPlannedTasks, setStatus, setToast]);

    // Note Updating - Simplified
    // This should also use Service if possible, but keeping lightweight update logic
    // Just ensure it updates the current 'history' state
    const handleUpdateNote = useCallback((logId: string, noteId: string, updates: any) => {
        const updater = (prevInfo: DailyLog[]) => prevInfo.map(log => {
            if (log.id !== logId) return log;
            return {
                ...log,
                observations: log.observations?.map(obs =>
                    obs.id === noteId ? { ...obs, ...updates } : obs
                )
            };
        });
        setHistory(updater);
    }, [setHistory]);


    return {
        handleAutoSave,
        handleFinalConfirm,
        handleManualSubmit,
        handleWizardSubmit,
        handleUpdateNote,
        service: logCommandService
    };
};

const mergeUniqueTasks = (existing: PlannedTask[], incoming: PlannedTask[]): PlannedTask[] => {
    if (incoming.length === 0) return existing;
    const merged = new Map<string, PlannedTask>();
    existing.forEach(task => merged.set(task.id, task));
    incoming.forEach(task => merged.set(task.id, task));
    return Array.from(merged.values());
};
