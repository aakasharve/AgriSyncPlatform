/**
 * AppContent — Main app shell
 * Clean Android-style layout: header, content, bottom panel
 */

import React, { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { Mic } from 'lucide-react';

import AudioRecorder from './features/voice/components/AudioRecorder'; // Keep for type check/ref if needed
import CropSelector from './features/context/components/CropSelector';
import InputMethodToggle from './shared/components/ui/InputMethodToggle';
import BottomNavigation from './features/context/components/BottomNavigation';
import AppHeader from './features/context/components/AppHeader';
import MeAlertRail from './features/context/components/MeAlertRail';
import AppRouter from './core/navigation/AppRouter';
import ActionToast from './shared/components/ui/ActionToast';
import WeatherReactionPrompt from './features/weather/components/WeatherReactionPrompt';
import VoiceListeningOverlay from './features/voice/components/VoiceListeningOverlay';

import { getPhaseAndDay } from './shared/utils/timelineUtils';
import { getPrimarySelection } from './application/selectors/ContextSelectors';
import { getDateKey } from './core/domain/services/DateKeyService';

import { CropProfile } from './types';
import { useAgriLogApp } from './app/compositionRoot';
import { AppFeatureProviders } from './app/context/AppFeatureContexts';
import { useTemplateCatalogSync } from './app/hooks/useTemplateCatalogSync';
import FirstFarmWizard from './features/onboarding/components/FirstFarmWizard';
import { getMyFarms, type MyFarmDto, type BootstrapFirstFarmResponse } from './features/onboarding/qr/inviteApi';
import { SessionStore } from './infrastructure/storage/SessionStore';

// Demo Mode pill removed



interface AppContentProps {
    crops: CropProfile[];
    setCrops: React.Dispatch<React.SetStateAction<CropProfile[]>>;
}

const AppContent: React.FC<AppContentProps> = ({ crops: initialCrops, setCrops }) => {
    // Phase 4: Global Voice State (UI concern, so kept here or could be moved to hook)
    const [isGlobalListening, setIsGlobalListening] = useState(false);
    const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

    // Phase 6: Farm context — list + current selection, first-farm wizard.
    const [myFarms, setMyFarms] = useState<MyFarmDto[] | null>(null);
    const [currentFarmId, setCurrentFarmId] = useState<string | null>(() => {
        return SessionStore.getCurrentFarmId() || null;
    });
    const [showFirstFarmWizard, setShowFirstFarmWizard] = useState(false);
    const [farmContextRefreshCounter, setFarmContextRefreshCounter] = useState(0);

    const app = useAgriLogApp({ initialCrops, currentFarmId });
    useTemplateCatalogSync();

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const farms = await getMyFarms();
                if (cancelled) return;
                setMyFarms(farms);

                // If the user has zero farms, auto-open the wizard.
                if (farms.length === 0) {
                    setShowFirstFarmWizard(true);
                    return;
                }

                // Ensure currentFarmId points to something real.
                if (!currentFarmId || !farms.some(f => f.farmId === currentFarmId)) {
                    const next = farms[0].farmId;
                    setCurrentFarmId(next);
                    SessionStore.setCurrentFarmId(next);
                }
            } catch {
                // Not authenticated / server unreachable — keep null; UI handles.
                if (!cancelled) setMyFarms([]);
            }
        })();
        return () => { cancelled = true; };
    }, [farmContextRefreshCounter]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSwitchFarm = (farmId: string) => {
        setCurrentFarmId(farmId);
        SessionStore.setCurrentFarmId(farmId);
    };

    const handleWizardComplete = (result: BootstrapFirstFarmResponse) => {
        setShowFirstFarmWizard(false);
        setCurrentFarmId(result.farmId);
        SessionStore.setCurrentFarmId(result.farmId);
        setFarmContextRefreshCounter(x => x + 1);
    };

    const handleJoinViaQr = () => {
        // Deep-link: JoinFarmLandingPage expects `?join=<token>&farm=<code>`.
        // We don't have a token handy here — route the user to a "paste link"
        // prompt. Future: a real scanner. For now, redirect to LoginPage's
        // "Join via farm QR" flow (which prompts for a pasted link).
        const link = window.prompt('तुमच्या मालकाने शेअर केलेली QR लिंक पेस्ट करा\nPaste the QR link shared by the farmer:');
        if (!link) return;
        try {
            const url = new URL(link.trim());
            const token = url.searchParams.get('t') ?? url.searchParams.get('join');
            const farm = url.searchParams.get('f') ?? url.searchParams.get('farm');
            if (token && farm) {
                window.location.assign(`/?join=${encodeURIComponent(token)}&farm=${encodeURIComponent(farm)}`);
                return;
            }
        } catch { /* fall through */ }
        window.alert('Link not recognised. Ask the farmer to share it again.');
    };

    const {
        navigation, context, data, voice, weather, commands, trust,
        toast, setToast, handleReset, lastSavedLogSummary, lastSavedLogIds
    } = app;

    useEffect(() => {
        setCrops(data.crops);
    }, [data.crops, setCrops]);

    useEffect(() => {
        if (!Capacitor.isNativePlatform()) {
            return;
        }

        let showListener: { remove: () => Promise<void> } | undefined;
        let hideListener: { remove: () => Promise<void> } | undefined;

        const registerKeyboardListeners = async () => {
            showListener = await Keyboard.addListener('keyboardDidShow', () => setIsKeyboardOpen(true));
            hideListener = await Keyboard.addListener('keyboardDidHide', () => setIsKeyboardOpen(false));
        };

        void registerKeyboardListeners();

        return () => {
            setIsKeyboardOpen(false);
            void showListener?.remove();
            void hideListener?.remove();
        };
    }, []);

    // --- VIEW HELPERS ---
    const getContextColorIndicator = () => {
        if (!context.hasActiveLogContext) return null;
        const primary = getPrimarySelection(context.currentLogContext);
        if (primary?.cropId === 'FARM_GLOBAL') {
            return <div className="absolute top-0 left-0 w-full h-1 z-10 bg-stone-400 shadow-sm"></div>;
        }
        if (context.currentLogContext!.selection.length === 1) {
            const crop = data.crops.find(c => c.id === primary?.cropId);
            return <div className={`absolute top-0 left-0 w-full h-1 z-10 ${crop?.color || 'bg-stone-300'} shadow-sm`}></div>;
        }
        return (
            <div className="absolute top-0 left-0 w-full h-1 z-10 flex shadow-sm">
                {context.currentLogContext!.selection.map((s, idx) => {
                    const crop = data.crops.find(c => c.id === s.cropId);
                    return <div key={idx} className={`flex-1 h-full ${crop?.color || 'bg-stone-300'}`}></div>;
                })}
            </div>
        );
    };

    const getContextDisplay = () => {
        if (!context.hasActiveLogContext) return "Select a crop to begin...";
        const primary = getPrimarySelection(context.currentLogContext);
        if (primary?.cropId === 'FARM_GLOBAL') return "Logging for Entire Farm";

        const count = context.logScope.selectedPlotIds.length;
        if (count === 1) {
            const sel = primary;
            if (!sel) return "Select a crop to begin...";

            const crop = data.crops.find(c => c.id === sel.cropId);
            const plotId = sel.selectedPlotIds[0];
            const plot = crop?.plots.find(p => p.id === plotId);
            const { label } = getPhaseAndDay(plot);

            return (
                <div className="flex flex-col items-center">
                    <span>{sel.cropName} • {plot?.name}</span>
                    <span className="text-xs font-bold bg-emerald-500/10 text-emerald-800 px-2 py-0.5 rounded-md mt-0.5 border border-emerald-500/20">
                        {label}
                    </span>
                </div>
            );
        }

        return (
            <div className="flex flex-col items-center">
                <span>Broadcasting to {count} Plots</span>
                <span className="text-xs text-stone-400 font-medium mt-0.5">
                    (Tap to see details)
                </span>
            </div>
        );
    };

    // --- HELPER: DAILY COUNTS ---
    const getTodayCounts = (plotId: string, dateStr: string) => {
        const relevantHistory = data.history;
        const dayLogs = relevantHistory.filter(l => {
            const isDate = l.date === dateStr;
            const contextSel = l.context.selection[0];
            const hasPlot = contextSel.selectedPlotIds.includes(plotId);
            return isDate && hasPlot;
        });

        const counts = {
            cropActivities: 0, irrigation: 0, labour: 0, inputs: 0,
            machinery: 0, activityExpenses: 0, observations: 0,
            reminders: 0, disturbance: 0, harvest: 0
        };

        dayLogs.forEach(log => {
            counts.cropActivities += (log.cropActivities?.length || 0);
            counts.irrigation += (log.irrigation?.length || 0);
            counts.labour += (log.labour?.length || 0);
            counts.inputs += (log.inputs?.length || 0);
            counts.machinery += (log.machinery?.length || 0);
            counts.activityExpenses += (log.activityExpenses?.length || 0);
            counts.observations += (log.observations?.filter(o => o.noteType !== 'reminder').length || 0);
            counts.reminders += (log.observations?.filter(o => o.noteType === 'reminder').length || 0);
            if (log.disturbance) counts.disturbance += 1;
        });

        return counts;
    };

    const getTodayPlotData = () => {
        const todayStr = getDateKey();
        const relevantHistory = data.history;
        const todayLogs = relevantHistory.filter(l => l.date === todayStr);

        const plotMap: Record<string, { plot: any, crop: any, counts: any }> = {};

        todayLogs.forEach(log => {
            const contextSel = log.context.selection[0];
            const crop = data.crops.find(c => c.id === contextSel.cropId);
            if (!crop) return;

            contextSel.selectedPlotIds.forEach(pid => {
                if (!plotMap[pid]) {
                    const plot = crop.plots.find(p => p.id === pid);
                    if (plot) {
                        plotMap[pid] = {
                            plot, crop,
                            counts: { cropActivities: 0, irrigation: 0, labour: 0, inputs: 0, machinery: 0, activityExpenses: 0, observations: 0, reminders: 0, disturbance: 0, harvest: 0 }
                        };
                    }
                }

                if (plotMap[pid]) {
                    const c = plotMap[pid].counts;
                    c.cropActivities += (log.cropActivities?.length || 0);
                    c.irrigation += (log.irrigation?.length || 0);
                    c.labour += (log.labour?.length || 0);
                    c.inputs += (log.inputs?.length || 0);
                    c.machinery += (log.machinery?.length || 0);
                    c.activityExpenses += (log.activityExpenses?.length || 0);
                    c.observations += (log.observations?.filter(o => o.noteType !== 'reminder').length || 0);
                    c.reminders += (log.observations?.filter(o => o.noteType === 'reminder').length || 0);
                    if (log.disturbance) c.disturbance += 1;
                }
            });
        });

        return Object.values(plotMap).filter(item => {
            const c = item.counts;
            return (c.cropActivities + c.irrigation + c.labour + c.inputs + c.machinery + c.activityExpenses + c.observations + c.reminders + c.disturbance) > 0;
        });
    };

    const featureHelpers = {
        getTodayCounts,
        getTodayPlotData,
        getContextColorIndicator,
        getContextDisplay
    };

    return (
        <div className="relative flex h-full flex-col bg-transparent text-stone-800 font-sans selection:bg-emerald-200">
            {/* Top App Bar */}
            <AppHeader
                currentRoute={navigation.currentRoute}
                currentView={navigation.mainView}
                onNavigate={navigation.setCurrentRoute}
                onViewChange={navigation.setMainView}
                disabled={voice.status === 'processing' || voice.status === 'recording'}
                activeOperator={data.farmerProfile.operators.find(op => op.id === data.farmerProfile.activeOperatorId)}
                onVoiceTrigger={() => {
                    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(40);
                    setIsGlobalListening(true);
                }}
                farmContext={myFarms ? {
                    farms: myFarms,
                    currentFarmId,
                    onSwitchFarm: handleSwitchFarm,
                    onCreateFarm: () => setShowFirstFarmWizard(true),
                    onJoinViaQr: handleJoinViaQr,
                } : undefined}
            />

            {/* Server-decided banners (verify phone, plan expiring, etc.) */}
            <MeAlertRail />

            {/* Main Content */}
            <main
                className="page-content relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-none"
                style={{
                    paddingBottom: isKeyboardOpen
                        ? '1.5rem'
                        : 'calc(6rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))'
                }}
            >
                <AppFeatureProviders app={app} helpers={featureHelpers}>
                    <AppRouter />
                </AppFeatureProviders>
            </main>

            {/* --- GLOBAL OVERLAYS --- */}

            {/* Phase 6: First-farm wizard (auto-opens for brand-new users with 0 farms) */}
            <FirstFarmWizard
                isOpen={showFirstFarmWizard}
                onComplete={handleWizardComplete}
                onDismiss={myFarms && myFarms.length > 0 ? () => setShowFirstFarmWizard(false) : undefined}
                suggestedOwnerName={data.farmerProfile?.name?.split(' ')[0]}
            />

            {/* Weather Reaction Prompt Overlay */}
            {weather.pendingWeatherEvent && (
                <WeatherReactionPrompt
                    event={weather.pendingWeatherEvent}
                    onReact={(reaction) => weather.handleWeatherReaction(reaction)}
                    onDismiss={() => weather.setPendingWeatherEvent(null)}
                />
            )}



            {/* Phase 4: Voice Overlay */}
            <VoiceListeningOverlay
                isOpen={isGlobalListening}
                onClose={() => setIsGlobalListening(false)}
                onAudioCaptured={(data) => {
                    voice.handleAudioReady(data);
                }}
                isProcessing={voice.status === 'processing'}
                transcript={voice.errorTranscript || ""}
                clarificationNeeded={voice.clarificationNeeded}
                onAnswerClarification={(text) => voice.handleTextReady(text)}
            />

            {/* Global Bottom Navigation */}
            <BottomNavigation
                currentRoute={navigation.currentRoute}
                currentView={navigation.mainView}
                onNavigate={(route) => navigation.setCurrentRoute(route)}
                onViewChange={(view) => navigation.setMainView(view)}
                hidden={isKeyboardOpen}
            />

            {/* Toast */}
            {toast && (
                <ActionToast
                    message={toast.message}
                    type={toast.type}
                    onDismiss={() => setToast(null)}
                />
            )}
        </div>
    );
};

export default AppContent;
