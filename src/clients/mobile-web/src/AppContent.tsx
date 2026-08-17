/**
 * AppContent — Main app shell. Sub-plan 04 Task 8 slim:
 *  - farm-context state (hooks/useFarmContextState)
 *  - capacitor keyboard listener (hooks/useCapacitorKeyboard)
 *  - daily-counts derivations (helpers/appContentDailyCounts)
 *  - context-display JSX helpers (helpers/appContentContextDisplay)
 */

import React, { useEffect, useMemo } from 'react';

import BottomNavigation from './features/context/components/BottomNavigation';
import AppHeader from './features/context/components/AppHeader';
import MeAlertRail from './features/context/components/MeAlertRail';
import AppRouter from './core/navigation/AppRouter';
import ActionToast from './shared/components/ui/ActionToast';
import WeatherReactionPrompt from './features/weather/components/WeatherReactionPrompt';
import FirstFarmWizard from './features/onboarding/components/FirstFarmWizard';
import MinimalOnboarding from './features/onboarding/components/MinimalOnboarding';
import { AiTestModeBanner } from './shared/components/AiTestModeBanner';

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
// spec: owner-oversight-loop (Ruling 12) — the narrow slice of
// AppFeatureProviders-scoped state AppHeader's oversight strip needs. See
// that file's header for what it does and does NOT solve (multi-farm data
// isolation is a pre-existing, separate gap, not introduced here).
import { buildOversightHeaderInputs } from './app/helpers/appContentOversightInputs';

interface AppContentProps {
    crops: CropProfile[];
    setCrops: React.Dispatch<React.SetStateAction<CropProfile[]>>;
}

const AppContent: React.FC<AppContentProps> = ({ crops: initialCrops, setCrops }) => {
    const isKeyboardOpen = useCapacitorKeyboard();

    const {
        myFarms,
        currentFarmId,
        showFirstFarmWizard,
        setShowFirstFarmWizard,
        showMinimalOnboarding,
        handleSwitchFarm,
        handleWizardComplete,
        handleJoinViaQr,
    } = useFarmContextState();

    const currentFarmName = myFarms?.find(f => f.farmId === currentFarmId)?.name;
    const app = useAgriLogApp({ initialCrops, currentFarmId, currentFarmName });
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

    // spec: owner-oversight-loop (Ruling 12) — narrow, purpose-built props
    // for AppHeader's oversight strip/drawer ONLY: not `data`, not `app`.
    // `data.history` itself still has to be a prop (the drawer's per-person
    // breakdown needs individual records, not a scalar), but nothing else
    // from `data` crosses this boundary.
    const oversightHeaderInputs = useMemo(
        () => buildOversightHeaderInputs(
            data.history,
            data.crops,
            data.farmerProfile.operators,
            data.plannedTasks,
        ),
        [data.history, data.crops, data.farmerProfile.operators, data.plannedTasks],
    );

    return (
        <div className="relative flex h-full flex-col bg-transparent text-stone-800 font-sans selection:bg-emerald-200">
            <AiTestModeBanner />
            <AppHeader
                currentRoute={navigation.currentRoute}
                currentView={navigation.mainView}
                onNavigate={navigation.setCurrentRoute}
                onViewChange={navigation.setMainView}
                disabled={voice.status === 'processing' || voice.status === 'recording'}
                activeOperator={data.farmerProfile.operators.find(op => op.id === data.farmerProfile.activeOperatorId)}
                farmContext={myFarms ? {
                    farms: myFarms,
                    currentFarmId,
                    onSwitchFarm: handleSwitchFarm,
                    onCreateFarm: () => setShowFirstFarmWizard(true),
                    onJoinViaQr: handleJoinViaQr,
                } : undefined}
                oversightData={{
                    logs: data.history,
                    operatorNameById: oversightHeaderInputs.operatorNameById,
                    plotCount: oversightHeaderInputs.plotCount,
                    unverifiedCount: oversightHeaderInputs.unverifiedCount,
                    yesterdayNotClosed: oversightHeaderInputs.yesterdayNotClosed,
                    // Genuinely unreachable honestly, not fabricated — see
                    // AppHeader.tsx's own doc comment on this field.
                    approvalHolderName: null,
                }}
                // spec: owner-oversight-loop (Task 11) — the weather chip
                // moved from mainView.tsx's home screen into AppHeader row
                // 1. `weather` is the SAME `useWeatherMonitor()` state
                // mainView.tsx used to read via `ctx.weatherData` etc.
                // (`core/navigation/routeContext.ts`), forwarded here
                // instead — no second fetch, no re-derivation.
                weather={{
                    data: weather.weatherData,
                    status: weather.weatherStatus,
                    boundaryUnset: weather.boundaryUnset,
                    onRetry: weather.refetchWeather,
                }}
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

            {/* Minimal 2-field onboarding shown to genuinely-new users (0 farms).
                Replaces the force-opened heavy wizard on the 0-farm path. */}
            <MinimalOnboarding
                isOpen={showMinimalOnboarding}
                onComplete={handleWizardComplete}
                onJoinViaQr={handleJoinViaQr}
            />

            {/* Heavy wizard — still available from AppHeader "create farm" CTA
                (setShowFirstFarmWizard) and is NOT force-opened on 0 farms any more. */}
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
