/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * DEV-ONLY full-app preview — Owner Oversight Loop, no backend / Postgres /
 * OTP login required. Extends the narrower strip-and-drawer preview
 * (`OversightPreview.tsx`, retired by this task) into the ENTIRE screen the
 * founder actually asked to click through: the real `AppHeader` (canonical
 * strip, farm switcher, waiting drawer), the real log/reflect/compare main
 * views (`core/navigation/mainView.tsx`'s `renderLogView` /
 * `renderReflectView` / `renderCompareView`, imported and called exactly as
 * `AppRouter.tsx` calls them — never forked, never copied), and the real
 * `BottomNavigation`.
 *
 * Access: http://localhost:3001/?preview=oversight
 * Reachability: gated by `IS_OVERSIGHT_PREVIEW_ENABLED` (`app/featureFlags.ts`,
 * wraps `import.meta.env.DEV`) + `React.lazy` in `App.tsx` — proven absent
 * from a real production `vite build` output (task-9 report, re-verified
 * for this extension).
 *
 * WHY NOT `AppContent.tsx` / `AppRouter.tsx` VERBATIM (read before editing)
 * ---------------------------------------------------------------------------
 * `AppContent.tsx` composes `useAgriLogApp()` (real Dexie + backend calls)
 * inside `AppFeatureProviders`, and `AppRouter.tsx` gates its very first
 * render on `useUiPref` (Dexie-backed "welcome seen?" / "permissions
 * granted?" flags) before it ever reaches Log/Reflect/Compare. Neither
 * component is on this task's do-not-modify list, but forking either to rip
 * those two things out would BE forking them — the instruction this task
 * must not do. Instead:
 *   - `PreviewShell` below owns SEEDED `crops` / `farmerProfile` / `history`
 *     / `plannedTasks` / `ledgerDefaults` as local React state (never Dexie,
 *     never a backend call), then renders the REAL `LogProvider` around a
 *     child that calls `useLogContext()` for real plot-selection behaviour.
 *   - `usePreviewRouterCtx` (`preview/usePreviewRouterCtx.ts`) assembles the
 *     exact `AppRouterContext` shape `AppRouter.tsx` builds, so
 *     `renderLogView` / `renderReflectView` / `renderCompareView` — REAL,
 *     unmodified, imported straight from `mainView.tsx` — render for real,
 *     without ever routing through `AppRouter.tsx`'s Dexie-backed onboarding
 *     gate. Nothing here reimplements what those render functions do; this
 *     file only supplies their `ctx` argument.
 *
 * PROVIDER TREE — real, not forked, each one already degrades honestly with
 * no backend (verified by reading each source, then confirmed live in a
 * browser — see task-9 report's continuation for what was actually
 * observed):
 *   `AuthProvider` -> boot refresh fails fast (no backend) -> anonymous.
 *   `FarmContextProvider` -> only fetches `if (isAuthenticated)` -> never
 *     fetches -> `meContext: null`. (`AppHeader`'s own farm strip does NOT
 *     read this — see `farmContext` prop below, seeded directly.)
 *   `LanguageProvider` -> its `LanguageSyncFromServer` child needs
 *     `meContext`, which is null -> no-ops, falls back to the Dexie-cached
 *     `agrilog_language` uiPref (read-only).
 * `AppHeader` needs this exact chain (`useLanguage()` -> `LanguageProvider`
 * -> `LanguageSyncFromServer` -> `useFarmContext()` -> `FarmContextProvider`
 * -> `useAuth()` -> `AuthProvider`) or it throws; omitting any link would
 * crash the one component this whole preview exists to show.
 *
 * WHAT IS SEEDED vs REAL — see `preview/previewAppFixtures.ts` and
 * `preview/usePreviewRouterCtx.ts` for the full breakdown. In one line: crop/
 * plot/operator/log data and the farm-switcher's farm list are seeded;
 * every component rendering them, and the oversight/derivation logic
 * running over them, is real and unmodified.
 */
import React, { Suspense, useMemo, useState } from 'react';

import { AuthProvider } from '../../app/providers/AuthProvider';
import { FarmContextProvider } from '../../core/session/FarmContext';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { LogProvider } from '../../app/context/LogContext';
import AppShell from '../../app/components/AppShell';
import { AppErrorBoundary } from '../../app/components/common/AppErrorBoundary';
import ActionToast from '../../shared/components/ui/ActionToast';
import AppHeader from '../context/components/AppHeader';
import BottomNavigation from '../context/components/BottomNavigation';
import { renderCompareView, renderLogView, renderReflectView } from '../../core/navigation/mainView';
import { RouteLoader } from '../../core/navigation/lazyComponents';
import { buildOversightHeaderInputs } from '../../app/helpers/appContentOversightInputs';
import type { CropProfile, DailyLog, FarmerProfile, LedgerDefaults, PlannedTask } from '../../types';

import {
    PREVIEW_CROPS,
    PREVIEW_FARMER_PROFILE,
    PREVIEW_FARMS,
    PREVIEW_LEDGER_DEFAULTS,
    PREVIEW_PLANNED_TASKS,
    buildPreviewLogs,
} from './preview/previewAppFixtures';
import { usePreviewRouterCtx } from './preview/usePreviewRouterCtx';

const ENGLISH_FONT = { fontFamily: "'DM Sans', sans-serif" } as const;

const PreviewBanner: React.FC = () => (
    <div
        data-testid="oversight-preview-banner"
        className="shrink-0 border-b border-amber-300 bg-amber-100 px-3 py-2 text-center text-[11px] font-bold text-amber-800"
        style={ENGLISH_FONT}
    >
        PREVIEW — seeded data, not a real farm
    </div>
);

/**
 * The founder's ask covers Log / Reflect / Compare (spec §ask 2/4). Every
 * OTHER route is real navigation state (tapping the header's profile avatar
 * or settings gear genuinely calls `setCurrentRoute`) but nothing renders
 * for it here — an honest, visible gap rather than a fabricated page.
 */
const UnhandledRouteNotice: React.FC<{ route: string; onBack: () => void }> = ({ route, onBack }) => (
    <div className="flex flex-col items-center gap-3 p-10 text-center">
        <p className="text-sm font-semibold text-stone-500" style={ENGLISH_FONT}>
            The &ldquo;{route}&rdquo; screen isn&apos;t wired into this preview — only Log, Reflect and Compare
            are (see task report).
        </p>
        <button
            type="button"
            onClick={onBack}
            className="rounded-full bg-stone-800 px-4 py-2 text-sm font-bold text-white"
            style={ENGLISH_FONT}
        >
            Back to Log
        </button>
    </div>
);

interface PreviewMainProps {
    crops: CropProfile[];
    setCrops: (crops: CropProfile[]) => void;
    farmerProfile: FarmerProfile;
    setFarmerProfile: React.Dispatch<React.SetStateAction<FarmerProfile>>;
    history: DailyLog[];
    plannedTasks: PlannedTask[];
    setPlannedTasks: React.Dispatch<React.SetStateAction<PlannedTask[]>>;
    ledgerDefaults: LedgerDefaults;
    setLedgerDefaults: (v: LedgerDefaults) => void;
}

/**
 * Rendered INSIDE `<LogProvider>` (see `PreviewShell` below) so
 * `usePreviewRouterCtx`'s `useLogContext()` call resolves to the real
 * provider — real plot-selection behaviour, not a re-implementation.
 */
const PreviewMain: React.FC<PreviewMainProps> = (props) => {
    const { crops, farmerProfile, history, plannedTasks } = props;
    const { ctx, notice, dismissNotice } = usePreviewRouterCtx(props);

    // spec: owner-oversight-loop (Ruling 12) — the SAME narrow reducer
    // `AppContent.tsx` uses to feed AppHeader's oversight strip/drawer, run
    // over the seeded data instead of `AppFeatureProviders`-scoped state.
    const oversightHeaderInputs = useMemo(
        () => buildOversightHeaderInputs(history, crops, farmerProfile.operators, plannedTasks),
        [history, crops, farmerProfile.operators, plannedTasks],
    );

    const activeOperator = farmerProfile.operators.find(op => op.id === farmerProfile.activeOperatorId);

    return (
        <div className="relative flex h-full flex-col bg-transparent text-stone-800">
            <PreviewBanner />

            <AppHeader
                currentRoute={ctx.currentRoute}
                currentView={ctx.mainView}
                onNavigate={ctx.setCurrentRoute}
                onViewChange={ctx.setMainView}
                disabled={false}
                activeOperator={activeOperator}
                farmContext={{
                    farms: PREVIEW_FARMS,
                    currentFarmId: PREVIEW_FARMS[0].farmId,
                    onSwitchFarm: () => { /* one seeded farm — nothing to switch to */ },
                    onCreateFarm: () => { /* out of scope for this preview */ },
                    onJoinViaQr: () => { /* out of scope for this preview */ },
                }}
                oversightData={{
                    logs: history,
                    operatorNameById: oversightHeaderInputs.operatorNameById,
                    plotCount: oversightHeaderInputs.plotCount,
                    unverifiedCount: oversightHeaderInputs.unverifiedCount,
                    yesterdayNotClosed: oversightHeaderInputs.yesterdayNotClosed,
                    // Same honest `null` AppContent.tsx passes — naming a
                    // delegate needs a server-governed permission grant this
                    // preview (and the shipped app) cannot honestly assert.
                    approvalHolderName: null,
                }}
                // spec: owner-oversight-loop (Task 11) — same seeded honest
                // "no-location" weather stub `usePreviewRouterCtx` already
                // builds for `renderLogView`'s old spot; forwarded here now
                // that the chip lives in AppHeader row 1 instead.
                weather={{
                    data: ctx.weatherData,
                    status: ctx.weatherStatus,
                    boundaryUnset: ctx.boundaryUnset,
                    onRetry: ctx.refetchWeather,
                }}
            />

            <main
                className="page-content relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-none"
                style={{ paddingBottom: 'calc(6rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))' }}
            >
                {ctx.currentRoute !== 'main' ? (
                    <UnhandledRouteNotice route={ctx.currentRoute} onBack={() => ctx.setCurrentRoute('main')} />
                ) : (
                    <Suspense fallback={<RouteLoader />}>
                        <div className="relative w-full">
                            {renderReflectView(ctx)}
                            {renderCompareView(ctx)}
                            {renderLogView(ctx)}
                        </div>
                    </Suspense>
                )}
            </main>

            <BottomNavigation
                currentRoute={ctx.currentRoute}
                currentView={ctx.mainView}
                onNavigate={ctx.setCurrentRoute}
                onViewChange={ctx.setMainView}
            />

            {notice && (
                <ActionToast message={notice} type="partial" onDismiss={dismissNotice} />
            )}
        </div>
    );
};

/**
 * Owns every piece of seeded state that must exist ABOVE `<LogProvider>`
 * (its `crops` prop) or that several consumers below need to share.
 * Voice/weather/commands/trust stub state lives one level down, inside
 * `usePreviewRouterCtx` — it never needs to be shared with `LogProvider`.
 */
const PreviewShell: React.FC = () => {
    const [crops, setCropsState] = useState<CropProfile[]>(PREVIEW_CROPS);
    const [farmerProfile, setFarmerProfile] = useState<FarmerProfile>(PREVIEW_FARMER_PROFILE);
    // Built once, on mount, relative to the REAL calendar day this preview
    // happens to be opened on — never a fixed narrative date (see
    // `buildPreviewLogs`'s own header comment).
    const [history] = useState<DailyLog[]>(() => buildPreviewLogs());
    const [plannedTasks, setPlannedTasks] = useState<PlannedTask[]>(PREVIEW_PLANNED_TASKS);
    const [ledgerDefaults, setLedgerDefaultsState] = useState<LedgerDefaults>(PREVIEW_LEDGER_DEFAULTS);

    return (
        <LogProvider crops={crops}>
            <PreviewMain
                crops={crops}
                setCrops={setCropsState}
                farmerProfile={farmerProfile}
                setFarmerProfile={setFarmerProfile}
                history={history}
                plannedTasks={plannedTasks}
                setPlannedTasks={setPlannedTasks}
                ledgerDefaults={ledgerDefaults}
                setLedgerDefaults={setLedgerDefaultsState}
            />
        </LogProvider>
    );
};

const OversightAppPreview: React.FC = () => (
    <AppErrorBoundary>
        <AuthProvider>
            <FarmContextProvider>
                <LanguageProvider>
                    <AppShell>
                        <PreviewShell />
                    </AppShell>
                </LanguageProvider>
            </FarmContextProvider>
        </AuthProvider>
    </AppErrorBoundary>
);

export default OversightAppPreview;
