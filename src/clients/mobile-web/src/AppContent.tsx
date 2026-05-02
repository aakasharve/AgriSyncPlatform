/**
 * AppContent — Main app shell. Sub-plan 04 Task 8 slim:
 *  - farm-context state (hooks/useFarmContextState)
 *  - capacitor keyboard listener (hooks/useCapacitorKeyboard)
 *  - daily-counts derivations (helpers/appContentDailyCounts)
 *  - context-display JSX helpers (helpers/appContentContextDisplay)
 */

import React, { useEffect, useState } from 'react';

import BottomNavigation from './features/context/components/BottomNavigation';
import AppHeader from './features/context/components/AppHeader';
import MeAlertRail from './features/context/components/MeAlertRail';
import AppRouter from './core/navigation/AppRouter';
import ActionToast from './shared/components/ui/ActionToast';
import WeatherReactionPrompt from './features/weather/components/WeatherReactionPrompt';
import VoiceListeningOverlay from './features/voice/components/VoiceListeningOverlay';
import FirstFarmWizard from './features/onboarding/components/FirstFarmWizard';

import { CropProfile } from './types';
import { useAgriLogApp } from './app/compositionRoot';
import { AppFeatureProviders } from './app/context/AppFeatureContexts';
import { useTemplateCatalogSync } from './app/hooks/useTemplateCatalogSync';
import { useFarmContextState } from './app/hooks/useFarmContextState';
import { useCapacitorKeyboard } from './app/hooks/useCapacitorKeyboard';
import {
    getTodayCounts as deriveTodayCounts,
    getTodayPlotData as deriveTodayPlotData,
} from './app/helpers/appContentDailyCounts';
import {
    buildContextColorIndicator,
    buildContextDisplay,
} from './app/helpers/appContentContextDisplay';

interface AppContentProps {
    crops: CropProfile[];
    setCrops: React.Dispatch<React.SetStateAction<CropProfile[]>>;
}

const AppContent: React.FC<AppContentProps> = ({ crops: initialCrops, setCrops }) => {
    const [isGlobalListening, setIsGlobalListening] = useState(false);
    const isKeyboardOpen = useCapacitorKeyboard();

    const {
        myFarms,
        currentFarmId,
        showFirstFarmWizard,
        setShowFirstFarmWizard,
        handleSwitchFarm,
        handleWizardComplete,
        handleJoinViaQr,
    } = useFarmContextState();

    const app = useAgriLogApp({ initialCrops, currentFarmId });
    useTemplateCatalogSync();

    const {
        navigation, context, data, voice, weather, commands: _commands, trust: _trust,
        toast, setToast, handleReset: _handleReset, lastSavedLogSummary: _lastSavedLogSummary, lastSavedLogIds: _lastSavedLogIds,
    } = app;

    useEffect(() => {
        setCrops(data.crops);
    }, [data.crops, setCrops]);

    const featureHelpers = {
        getTodayCounts: (plotId: string, dateStr: string) =>
            deriveTodayCounts(data.history, plotId, dateStr),
        getTodayPlotData: () => deriveTodayPlotData(data.history, data.crops),
        getContextColorIndicator: () => buildContextColorIndicator(context, data.crops),
        getContextDisplay: () => buildContextDisplay(context, data.crops),
    };

    return (
        <div className="relative flex h-full flex-col bg-transparent text-stone-800 font-sans selection:bg-emerald-200">
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

            <MeAlertRail />

            <main
                className="page-content relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-none"
                style={{
                    paddingBottom: isKeyboardOpen
                        ? '1.5rem'
                        : 'calc(6rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))',
                }}
            >
                <AppFeatureProviders app={app} helpers={featureHelpers}>
                    <AppRouter />
                </AppFeatureProviders>
            </main>

            <FirstFarmWizard
                isOpen={showFirstFarmWizard}
                onComplete={handleWizardComplete}
                onDismiss={myFarms && myFarms.length > 0 ? () => setShowFirstFarmWizard(false) : undefined}
                suggestedOwnerName={data.farmerProfile?.name?.split(' ')[0]}
            />

            {weather.pendingWeatherEvent && (
                <WeatherReactionPrompt
                    event={weather.pendingWeatherEvent}
                    onReact={(reaction) => weather.handleWeatherReaction(reaction)}
                    onDismiss={() => weather.setPendingWeatherEvent(null)}
                />
            )}

            <VoiceListeningOverlay
                isOpen={isGlobalListening}
                onClose={() => setIsGlobalListening(false)}
                onAudioCaptured={(audioData) => { voice.handleAudioReady(audioData); }}
                isProcessing={voice.status === 'processing'}
                transcript={voice.errorTranscript || ''}
                clarificationNeeded={voice.clarificationNeeded}
                onAnswerClarification={(text) => voice.handleTextReady(text)}
            />

            <BottomNavigation
                currentRoute={navigation.currentRoute}
                currentView={navigation.mainView}
                onNavigate={(route) => navigation.setCurrentRoute(route)}
                onViewChange={(view) => navigation.setMainView(view)}
                hidden={isKeyboardOpen}
            />

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
