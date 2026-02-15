import React, { useEffect, useMemo, useState } from 'react';
import { CropProfile, InputMode } from '../types';

// Feature Controllers
import { useAppNavigation } from './hooks/useAppNavigation';
import { useAppData } from './hooks/useAppData';
import { useTrustLayer } from './hooks/useTrustLayer';
import { useLogCommands } from './hooks/useLogCommands';

// Existing Hooks (Preserved)
import { useVoiceRecorder } from '../features/voice/useVoiceRecorder';
import { useWeatherMonitor } from '../features/weather/useWeatherMonitor';
import { useLogContext } from './context/LogContext';
import { GeminiClient } from '../infrastructure/ai/GeminiClient';
import { weatherService } from '../infrastructure/weather/TomorrowIoWeatherService';
import { VoiceDraftDispatcher } from '../application/services/VoiceDraftDispatcher';

export interface AgriLogAppConfig {
    initialCrops: CropProfile[];
}

export const useAgriLogApp = ({ initialCrops }: AgriLogAppConfig) => {
    // --- 0. UI GLOBAL STATE (Hoisted) ---
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [lastSavedLogSummary, setLastSavedLogSummary] = useState<Array<{ cropName: string, count: number }>>([]);
    const [lastSavedLogIds, setLastSavedLogIds] = useState<string[]>([]);
    const [mode, setMode] = useState<InputMode>('voice');

    // --- 1. CORE NAVIGATION ---
    const navigation = useAppNavigation();

    // --- 2. GLOBAL LOG CONTEXT (Scope) ---
    const context = useLogContext();
    const {
        logScope, setLogScope, currentLogContext, hasActiveLogContext,
        activeCropId, activePlotId
    } = context;

    // --- 3. APP DATA ---
    const appData = useAppData({
        initialCrops,
        onNewPlotDetected: (newPlotId, parentCropId) => {
            console.log(`🌱 Auto-selecting new plot: ${newPlotId}`);
            setLogScope({
                selectedCropIds: [parentCropId],
                selectedPlotIds: [newPlotId],
                mode: 'single',
                applyPolicy: 'broadcast'
            });
            navigation.setMainView('log');
        }
    });

    // --- INFRASTRUCTURE ---
    const parser = useMemo(() => new GeminiClient(), []);
    const voiceDraftDispatcher = useMemo(() => new VoiceDraftDispatcher(), []);

    // --- 4. VOICE RECORDER (Producer) ---
    const voice = useVoiceRecorder({
        currentLogContext,
        hasActiveLogContext,
        crops: appData.crops,
        farmerProfile: appData.farmerProfile,
        setMode: (newMode: InputMode) => {
            setMode(newMode);
            if (newMode === 'voice') navigation.setMainView('log');
        },
        onAutoSave: (log, prov) => voiceDraftDispatcher.emit(log, prov),
        parser,
        logScope
    });

    // --- 5. COMMANDS (Consumer) ---
    const commands = useLogCommands({
        hasActiveLogContext,
        logScope,
        setLogScope, // Added for Context Switching
        crops: appData.crops,
        farmerProfile: appData.farmerProfile,
        history: appData.history,
        plannedTasks: appData.plannedTasks,
        isDemoMode: appData.isDemoMode,
        setHistory: appData.setHistory, // Unified History Setter
        setMockHistory: appData.setMockHistory,
        setRealHistory: appData.setRealHistory,
        setPlannedTasks: appData.setPlannedTasks,
        setToast,
        setLastSavedLogSummary,
        setLastSavedLogIds,
        setError: voice.setError,
        setDraftLog: voice.setDraftLog,
        setRecordingSegment: voice.setRecordingSegment,
        setMode,
        setMainView: navigation.setMainView,
        setStatus: voice.setStatus,
        weatherProvider: weatherService
    });

    // Bridge event stream: voice -> dispatcher -> commands
    useEffect(() => {
        const unsubscribe = voiceDraftDispatcher.subscribe((event) => {
            void commands.handleAutoSave(event.draft, event.provenance);
        });

        return unsubscribe;
    }, [voiceDraftDispatcher, commands.handleAutoSave]);

    // --- 6. WEATHER ---
    const weather = useWeatherMonitor({
        farmerProfile: appData.farmerProfile,
        crops: appData.crops,
        setCrops: appData.setCrops,
        logScope,
        hasActiveLogContext,
        activeCropId,
        activePlotId,
        setError: voice.setError,
        provider: weatherService // Inject infrastructure
    });

    // --- 7. TRUST LAYER ---
    const trust = useTrustLayer({
        farmerProfile: appData.farmerProfile,
        setFarmerProfile: appData.setFarmerProfile,
        setHistory: appData.setHistory, // Unified History Setter
        setMockHistory: appData.setMockHistory,
        setRealHistory: appData.setRealHistory,
        isDemoMode: appData.isDemoMode
    });

    // --- 8. GLUE & SIDE EFFECTS ---
    useEffect(() => {
        if (!hasActiveLogContext) {
            voice.handleResetVoice();
            setMode('voice');
        }
    }, [hasActiveLogContext]);

    return {
        // Feature States
        navigation,
        context,
        data: appData,
        voice: { ...voice, mode, setMode },
        weather,
        commands,
        trust,

        // UI Globals
        toast,
        setToast,
        lastSavedLogSummary,
        lastSavedLogIds,

        // Handlers that cross domains
        handleReset: voice.handleResetVoice,
    };
};
