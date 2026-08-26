import { useCallback, useEffect, useMemo, useState } from 'react';
import { CropProfile, InputMode } from '../types';

// Feature Controllers
import { useAppNavigation } from './hooks/useAppNavigation';
import { useAppData } from './hooks/useAppData';
import { useTrustLayer } from './hooks/useTrustLayer';
import { useLogCommands } from './hooks/useLogCommands';

// Existing Hooks (Preserved)
import { useVoiceRecorder } from '../features/voice/useVoiceRecorder';
import { useWeatherMonitor } from '../features/weather/useWeatherMonitor';
import { useLocationCapture } from '../features/location/hooks/useLocationCapture';
import { useLogContext } from './context/LogContext';
import { BackendAiClient } from '../infrastructure/ai/BackendAiClient';
import { BackendFarmGeographyClient } from '../infrastructure/farmGeography';
import { FarmAnchoredWeatherService } from '../infrastructure/weather/FarmAnchoredWeatherService';
import { BackendWeatherClient } from '../infrastructure/weather/BackendWeatherClient';
import { VoicePreprocessor } from '../infrastructure/voice/VoicePreprocessor';
import type { LastSavedLogSummaryItem } from './uiRuntimeTypes';

export interface AgriLogAppConfig {
    initialCrops: CropProfile[];
    currentFarmId?: string | null;
    currentFarmName?: string | null;
}

const GLOBAL_TOAST_EVENT = 'agrisync:toast';
type GlobalToastDetail = { message: string; type: 'success' | 'error' };

export const useAgriLogApp = ({ initialCrops, currentFarmId, currentFarmName }: AgriLogAppConfig) => {
    // --- 0. UI GLOBAL STATE (Hoisted) ---
    // `'partial'` — see ActionToast. A partly-skipped save is neither a success
    // nor a failure, and rendering it as either teaches the farmer something
    // untrue about a record that is sitting safely on their phone.
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'partial' } | null>(null);
    const [lastSavedLogSummary, setLastSavedLogSummary] = useState<LastSavedLogSummaryItem[]>([]);
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
    const parser = useMemo(() => new BackendAiClient(), []);
    const voicePreprocessor = useMemo(() => new VoicePreprocessor(), []);
    const farmGeography = useMemo(() => new BackendFarmGeographyClient(), []);
    const weatherProvider = useMemo(
        () => {
            const getCurrentFarmId = () => currentFarmId ?? null;
            const backendClient = new BackendWeatherClient(getCurrentFarmId);
            return new FarmAnchoredWeatherService(backendClient, farmGeography, getCurrentFarmId);
        },
        [currentFarmId, farmGeography],
    );

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
        parser,
        logScope,
        voicePreprocessor,
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
        weatherProvider,
        // spec: 2026-07-13-labour-attendance-approval-design (Task 3.5)
        logIntent: navigation.logIntent,
        setCurrentRoute: navigation.setCurrentRoute,
        setLastLabourLogIds: navigation.setLastLabourLogIds
    });
    useEffect(() => {
        const handleGlobalToast = (event: Event) => {
            const detail = (event as CustomEvent<GlobalToastDetail>).detail;
            if (!detail || typeof detail.message !== 'string' || detail.message.trim().length === 0) {
                return;
            }

            if (detail.type !== 'success' && detail.type !== 'error') {
                return;
            }

            setToast({
                message: detail.message,
                type: detail.type,
            });
        };

        window.addEventListener(GLOBAL_TOAST_EVENT, handleGlobalToast as EventListener);
        return () => window.removeEventListener(GLOBAL_TOAST_EVENT, handleGlobalToast as EventListener);
    }, []);

    // --- 6. WEATHER ---
    // Consent-gated device GPS for weather when a farm has no drawn centre.
    // captureLocation() self-gates on the recorded gps_consent (returns null
    // unless granted), so device weather is DPDP-consent respecting.
    const { captureLocation } = useLocationCapture();
    const getDeviceLocation = useCallback(async (): Promise<{ lat: number; lon: number } | null> => {
        const loc = await captureLocation();
        return loc ? { lat: loc.latitude, lon: loc.longitude } : null;
    }, [captureLocation]);

    const weather = useWeatherMonitor({
        farmerProfile: appData.farmerProfile,
        crops: appData.crops,
        setCrops: appData.setCrops,
        hasActiveLogContext,
        activeCropId: activeCropId ?? null,
        activePlotId: activePlotId ?? null,
        activeFarmId: currentFarmId ?? null,
        setError: voice.setError,
        provider: weatherProvider,
        farmGeography,
        getDeviceLocation,
        farmName: currentFarmName ?? undefined,
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
            const resetModeHandle = window.setTimeout(() => setMode('voice'), 0);
            return () => window.clearTimeout(resetModeHandle);
        }
        return undefined;
        // Intentionally keyed on hasActiveLogContext only; `voice` is a fresh
        // object each render and would re-fire this reset every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
