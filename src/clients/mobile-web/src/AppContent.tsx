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
import AccessStatusNotice from './features/context/components/AccessStatusNotice';
import HeldWorkNotice from './features/context/components/HeldWorkNotice';
import AppRouter from './core/navigation/AppRouter';
import ActionToast from './shared/components/ui/ActionToast';
import WeatherReactionPrompt from './features/weather/components/WeatherReactionPrompt';
import FirstFarmWizard from './features/onboarding/components/FirstFarmWizard';
import MinimalOnboarding from './features/onboarding/components/MinimalOnboarding';
import JoinByCodeScreen from './features/onboarding/components/JoinByCodeScreen';
import { AiTestModeBanner } from './shared/components/AiTestModeBanner';

import { CropProfile } from './types';
import { useAgriLogApp } from './app/compositionRoot';
import { AppFeatureProviders } from './app/context/AppFeatureContexts';
import { useTemplateCatalogSync } from './app/hooks/useTemplateCatalogSync';
import { useFarmContextState, OPEN_CREATE_FARM_WIZARD_EVENT } from './app/hooks/useFarmContextState';
import { useCapacitorKeyboard } from './app/hooks/useCapacitorKeyboard';
import { useAndroidBackButton } from './app/hooks/useAndroidBackButton';
import { useBackDismiss } from './core/navigation/useBackDismiss';
import { useSavedSurfaceScrollReset } from './app/hooks/useSavedSurfaceScrollReset';
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
import { getSessionUserId } from './infrastructure/storage/AuthTokenStore';
// spec: owner-oversight-loop (§P-I) — the ONE definition of "a view change
// right now would destroy work in progress". The tap path (below) and the
// swipe path (`core/navigation/MainViewTransition.tsx`, wired in
// `AppRouter.tsx`) both call it, so the two can never drift apart.
import { isRecordingPathBusy } from './shared/utils/recordingPathBusy';
import { useAuth } from './app/providers/AuthProvider';
// spec: plr-d10 (I14, CMP-3) — a worker gets no तुलना; the one rule, read here for the switcher.
import { useOptionalFarmContext } from './core/session/FarmContext';
import { hiddenMainViewsFor } from './core/navigation/hiddenViews';
import { useAttentionModel } from './features/attention/hooks/useAttentionModel';
import { attentionSummaryEn, attentionSummaryMr } from './features/attention/attentionItems';
import { useOptionalLanguage } from './i18n/LanguageContext';
import { useWorkTabViewChange } from './features/logs/components/entry/workHomeRequest';
import { BOTTOM_BAR_CLEARANCE } from './shared/utils/bottomBar';

interface AppContentProps {
    crops: CropProfile[];
    setCrops: React.Dispatch<React.SetStateAction<CropProfile[]>>;
}

const AppContent: React.FC<AppContentProps> = ({ crops: initialCrops, setCrops }) => {
    const isKeyboardOpen = useCapacitorKeyboard();

    const {
        myFarms,
        pendingFarms,
        currentFarmId,
        showFirstFarmWizard,
        setShowFirstFarmWizard,
        showMinimalOnboarding,
        handleSwitchFarm,
        handleWizardComplete,
        handleJoinViaQr,
        showJoinByCode,
        closeJoinByCode,
        handleJoinComplete,
        handleWithdrawRequest,
    } = useFarmContextState();

    const currentFarmName = myFarms?.find(f => f.farmId === currentFarmId)?.name;
    // spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — FR-6/7) — the farm the person is now
    // IN (Active seats only), for the first run's last two steps; its role is the server's.
    const openFarm = myFarms?.find(f => f.farmId === currentFarmId) ?? myFarms?.[0] ?? null;
    const hasOpenFarm = openFarm !== null;
    const openFarmName = openFarm?.name ?? '';
    const openFarmRole = openFarm?.role ?? '';
    const firstRunFarm = useMemo(
        () => (hasOpenFarm ? { name: openFarmName, role: openFarmRole } : null),
        [hasOpenFarm, openFarmName, openFarmRole],
    );
    // FR-8: the 0-farm doors' "← मागे" goes back to the phone number — that is, signs out. The doors
    // ask "बाहेर पडायचं?" first (FirstFarmDoors); only "बाहेर पडा" there calls this.
    const { logout } = useAuth();
    // The person's role on the CURRENT farm (`/me/context`), so the switcher leaves out what they may not open.
    const hiddenViews = hiddenMainViewsFor(useOptionalFarmContext()?.currentFarm?.role);
    const app = useAgriLogApp({ initialCrops, currentFarmId, currentFarmName });
    useTemplateCatalogSync();

    const {
        navigation, context, data, voice, weather, commands: _commands, trust: _trust,
        toast, setToast, handleReset: _handleReset, lastSavedLogSummary: _lastSavedLogSummary, lastSavedLogIds: _lastSavedLogIds,
    } = app;

    // spec: plr-d10 (I22, founder D-1) — the bottom bar's लक्ष द्या count: the items its page lists for this farm
    // (one list for the page, this count and the आढावा strip — `attentionItems.ts`).
    const attentionModel = useAttentionModel(data.plannedTasks, data.crops);
    const attentionCount = attentionModel.total;
    // lane L4b (D-40 §2) — the strip's third signal: the same list, summarised in his language (the Marathi
    // summary is the आढावा strip's own; its English twin is PROPOSED).
    const appLanguage = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
    const attentionSignal = {
        total: attentionCount,
        summary: appLanguage === 'mr'
            ? attentionSummaryMr(attentionModel.counts)
            : attentionSummaryEn(attentionModel.counts),
    };

    // BUG-2 2026-08-14, cause 3 (founder: "there is no going back screen after
    // this screen"). `<main>` below is the app's ONE scroll container, so it —
    // not the route being swapped inside it — owns the scroll offset that
    // survived a save and dropped the farmer ~591px into the post-save card.
    // The ref lives here because the element does; the edge-detection and the
    // reduced-motion rule live in the hook.
    const pageScrollRef = React.useRef<HTMLElement>(null);
    useSavedSurfaceScrollReset(pageScrollRef, voice.status);

    // spec: plr-d10-redesign-real-integration-2026-10-25 (WP-6) — every screen opens at
    // its top. The ONE scroll container outlives the route swapped inside it, so the last
    // screen's offset used to carry over and a farmer landed halfway down a new page.
    // (I17, H20) A re-tap of the place he is in reopens its first screen WITHOUT a route
    // change (`placeResetKey` moves), so that first screen opens at its top as well.
    React.useLayoutEffect(() => {
        pageScrollRef.current?.scrollTo?.({ top: 0 });
    }, [navigation.currentRoute, navigation.mainView, navigation.placeResetKey]);

    // spec: 2026-08-25-prod-cutover-waves — Android hardware Back (native only).
    // Overlays close first, then the app's own route history, and only at Home
    // does it exit (or background the app while a capture is in flight).
    useAndroidBackButton({
        goBack: navigation.goBack,
        isBusy: () => isRecordingPathBusy(voice.status),
    });
    // The create-farm wizard is only dismissible when a farm already exists
    // (see its onDismiss below); a first-farm wizard stays a hard gate.
    useBackDismiss(showFirstFarmWizard && !!myFarms && myFarms.length > 0, () => setShowFirstFarmWizard(false));
    useBackDismiss(!!weather.pendingWeatherEvent, () => weather.setPendingWeatherEvent(null));

    useEffect(() => {
        setCrops(data.crops);
    }, [data.crops, setCrops]);

    // spec: owner-oversight-loop (Task 12) — the "तुमच्या शेती · Your farms"
    // row in `SetupHubMenu.tsx` (deep inside `AppRouter`, no prop path to
    // this component's local `setShowFirstFarmWizard`) opens the SAME
    // `FirstFarmWizard` instance below via this event, rather than a second
    // mount. `AppContent` renders once for the app's whole lifetime, so a
    // listener attached here reliably outlives any later navigation into
    // Profile. See `useFarmContextState.ts`'s own comment on
    // `requestCreateFarmWizard` for why this is a `window` event and not a
    // threaded prop.
    useEffect(() => {
        const openWizard = () => setShowFirstFarmWizard(true);
        window.addEventListener(OPEN_CREATE_FARM_WIZARD_EVENT, openWizard);
        return () => window.removeEventListener(OPEN_CREATE_FARM_WIZARD_EVENT, openWizard);
    }, [setShowFirstFarmWizard]);

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
    // PLR-D10 I13 — who "you" are on this phone (the result screen's same pair), so his OWN voice
    // auto-saves are not counted as waiting on him.
    const activeOperatorId = data.farmerProfile.activeOperatorId;
    const sessionUserId = getSessionUserId();
    const oversightHeaderInputs = useMemo(
        () => buildOversightHeaderInputs(
            data.history,
            data.crops,
            data.farmerProfile.operators,
            data.plannedTasks,
            new Set([activeOperatorId, sessionUserId].filter((id): id is string => !!id)),
        ),
        [data.history, data.crops, data.farmerProfile.operators, data.plannedTasks, activeOperatorId, sessionUserId],
    );

    // spec: plr-d10-redesign-real-integration-2026-10-25 (I12, H08) — the header's page switcher.
    const onWorkTabViewChange = useWorkTabViewChange(
        { mode: voice.mode, hasActiveLogContext: context.hasActiveLogContext, status: voice.status },
        { setMainView: navigation.setMainView, requestLogHome: navigation.requestLogHome, resetSaved: _handleReset, setMode: voice.setMode },
    );

    return (
        <div className="relative flex h-full flex-col bg-transparent text-stone-800 font-sans selection:bg-emerald-200">
            <AiTestModeBanner />
            <AppHeader
                currentRoute={navigation.currentRoute}
                currentView={navigation.mainView}
                // spec: plr-d10-redesign-real-integration-2026-10-25 (I17, PLR-D9 N3) — the header's
                // सेट-अप केंद्र is a PLACE: re-tapped from inside it, it returns to the hub's first
                // screen. Its other hops (the sync drawer's "not synced" page, आजची कामे) keep the
                // ordinary route history, so their मागे still returns where he was.
                onNavigate={(route) => (route === 'profile' || route === 'attention' ? navigation.openPlace(route) : navigation.setCurrentRoute(route))}
                // spec: plr-d10-redesign-real-integration-2026-10-25 (I12) — a tap on the आजची कामे card
                // (again, or from another tab) opens its work home fresh, also from the saved card.
                // Never over an unsaved review form or a parse in progress (`workTabTapAction`).
                onViewChange={onWorkTabViewChange}
                // spec: plr-d10-redesign-real-integration-2026-10-25 (WP-6, PLR-D9 N1) — the page
                // switcher only on the home tabs; a place (खरेदी, सेट-अप केंद्र…) has its own title
                // and मागे, and used to show आजची कामे lit while the farmer was on खरेदी.
                navCardsOnlyOnMain
                // spec: plr-d10 (I14, CMP-3) — founder 2026-10-25: a worker gets no तुलना card.
                hiddenViews={hiddenViews}
                disabled={isRecordingPathBusy(voice.status)}
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
                    yesterdayNotClosed: oversightHeaderInputs.yesterdayNotClosed,
                    // Genuinely unreachable honestly, not fabricated — see
                    // AppHeader.tsx's own doc comment on this field.
                    approvalHolderName: null,
                    attention: attentionSignal,
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
            {/* spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — a waiting request / a paused seat, said plainly. */}
            <AccessStatusNotice />
            {/* spec R-11 (c) — work held back by the farm's trial / plan, said plainly to owner and worker. */}
            <HeldWorkNotice farm={openFarm} />

            {/* lane FX-1 (founder rule FOOT-1) — the ONE scroll area ends with the bar's whole room (its row, the raised
                शेड्यूल button above it, a small gap and the phone's safe area), so every page's last line and any
                button at its end can be scrolled clear of the bar. It used to stop 8px short of the raised button. */}
            <main
                ref={pageScrollRef}
                className="page-content relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-none"
                style={{
                    paddingBottom: isKeyboardOpen ? '1.5rem' : BOTTOM_BAR_CLEARANCE,
                }}
            >
                <AppFeatureProviders app={app} helpers={featureHelpers}>
                    {/* While the join door is open its own answer is on screen ("तुम्ही आधीच या
                        शेतात आहात"…); the first-run steps wait until it is closed. */}
                    <AppRouter firstRunFarm={showJoinByCode ? null : firstRunFarm} farmsKnown={myFarms !== null} />
                </AppFeatureProviders>
            </main>

            {/* The 0-farm screen: two equal doors (my own farm → the 2-field form; I was invited →
                the join door below). Replaces the force-opened heavy wizard on the 0-farm path. */}
            <MinimalOnboarding
                isOpen={showMinimalOnboarding}
                onComplete={handleWizardComplete}
                onJoinViaQr={handleJoinViaQr}
                pendingSeats={pendingFarms}
                onWithdrawRequest={handleWithdrawRequest}
                onBack={() => { void logout(); }}
            />

            {/* Heavy wizard — still available from AppHeader "create farm" CTA
                (setShowFirstFarmWizard) and is NOT force-opened on 0 farms any more. */}
            <FirstFarmWizard
                isOpen={showFirstFarmWizard}
                onComplete={handleWizardComplete}
                onDismiss={myFarms && myFarms.length > 0 ? () => setShowFirstFarmWizard(false) : undefined}
                suggestedOwnerName={data.farmerProfile?.name?.split(' ')[0]}
            />

            {/* spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the ONE join door (typed farm
                code + the QR way). Every "join" control opens this single instance. */}
            <JoinByCodeScreen
                isOpen={showJoinByCode}
                onClose={closeJoinByCode}
                onJoined={handleJoinComplete}
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
                onNavigate={(route) => navigation.openPlace(route)}
                onViewChange={(view) => navigation.setMainView(view)}
                hidden={isKeyboardOpen}
                attentionCount={attentionCount}
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
