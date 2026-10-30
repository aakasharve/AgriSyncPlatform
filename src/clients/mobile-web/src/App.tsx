import React, { useEffect, useState } from 'react';
import { installGlobalErrorHandlers } from './infrastructure/telemetry/ClientErrorReporter';
import { AdminOpsPreview } from './features/admin/ops/AdminOpsPreview';
import { LabourPreview } from './features/labour/LabourPreview';
import { BrowserRouter } from 'react-router-dom';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { NavigationBar } from '@capgo/capacitor-navigation-bar';
import { CropProfile } from './types';
import { LogProvider } from './app/context/LogContext';
import { AppErrorBoundary } from './app/components/common/AppErrorBoundary';
import AppContent from './AppContent';
import { LanguageProvider } from './i18n/LanguageContext';
import SplashScreen from './shared/components/ui/SplashScreen';
import { DataSourceProvider } from './app/providers/DataSourceProvider';
import { SelectionProvider } from './app/context/SelectionContext';
import { AuthProvider } from './app/providers/AuthProvider';
import { useAuth } from './app/providers/AuthProvider';
import { FarmContextProvider } from './core/session/FarmContext';
import { OfflineBanner } from './features/sync';
import { setAiTestModeEnabled, clearAiTestMode } from './infrastructure/storage/AiTestModeStore';
import AppShell from './app/components/AppShell';
import LoginPage from './pages/LoginPage';
import JoinFarmLandingPage from './pages/JoinFarmLandingPage';
import FirstRunWelcome from './features/onboarding/firstRun/FirstRunWelcome';
import { hasSeenFirstRunWelcome, markFirstRunWelcomeSeen } from './infrastructure/storage/FirstRunDeviceStore';
// spec: 2026-08-25-prod-cutover-waves (B1) — the pre-login acceptance gets its owner.
import { useConsentGateLinkReconciliation } from './features/consent/gate/useConsentGateLink';
// spec: plr-d10 I25 (founder D-13, D-36) — a signed-in farmer is asked ONCE when the notice changes.
import NoticeChangeSheet from './features/consent/reask/NoticeChangeSheet';
import { IS_OVERSIGHT_PREVIEW_ENABLED } from './app/featureFlags';

const hasJoinDeepLink = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
        const params = new URLSearchParams(window.location.search);
        return Boolean((params.get('join') && params.get('farm')) || params.get('q'));
    } catch {
        return false;
    }
};

const AppFrame: React.FC<{
    crops: CropProfile[];
    setCrops: React.Dispatch<React.SetStateAction<CropProfile[]>>;
}> = ({ crops, setCrops }) => {
    // spec: secure-remembered-device-sessions-2026-06-24
    // Use authStatus (not isAuthenticated) so we can show a neutral loading
    // shell during 'checking' and never flash LoginPage before boot validation.
    const { isAuthenticated, authStatus, session } = useAuth();
    const [joinActive, setJoinActive] = useState<boolean>(hasJoinDeepLink);
    // spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — FR-1, FR-8) — स्वागत is the FIRST
    // screen, before login, once per phone. The login screen's "← मागे" brings it back (that is
    // also where the language is chosen before signing in).
    const [showWelcome, setShowWelcome] = useState<boolean>(() => !hasSeenFirstRunWelcome());
    const startFromWelcome = () => {
        markFirstRunWelcomeSeen();
        setShowWelcome(false);
    };

    // spec: plr-d10-x1-consent-tick-on-phone-screen-2026-10-25 — there is no full-screen
    // consent gate any more. Consent is one tick on every screen that takes a phone number
    // (LoginPage, both modes, and JoinFarmLandingPage), recorded before the number leaves
    // the device. That also closes X1: a QR deep link used to reach the join page — and
    // send the number — without passing any consent at all.

    // spec: 2026-08-25-prod-cutover-waves (B1) — the gate runs pre-login, so its two legal
    // records land with no user attached and are readable by nobody. This attaches them to
    // the account the farmer just made (or signed back into) by writing a linking row.
    //
    // It is a SILENT BACKGROUND RECONCILIATION and must stay one: nothing is awaited here,
    // nothing renders, nothing is shown to the farmer on success or on failure, and it can
    // neither block nor delay registration, login or logging work (doctrine P9 / P4). It
    // fires on every authenticated app start, so a farmer who was offline when he
    // registered is linked the next time he opens the app with signal.
    useConsentGateLinkReconciliation(authStatus === 'authenticated' ? session?.userId : null);

    // The QR deep-link wins over login. Semi-literate workers must never
    // see a generic password screen when they scan a farm QR.
    if (joinActive) {
        return (
            <AppShell>
                <JoinFarmLandingPage onComplete={() => setJoinActive(false)} />
            </AppShell>
        );
    }

    // spec: secure-remembered-device-sessions-2026-06-24
    // While the boot-validation refresh is in flight, render SplashScreen so
    // LoginPage never flashes for users with a valid remembered session.
    if (authStatus === 'checking') {
        return (
            <AppShell>
                <SplashScreen onComplete={() => { /* boot splash; auth check resolves independently */ }} />
            </AppShell>
        );
    }

    // Not re-asked of an authenticated session: a farmer who is already signed in accepted
    // at some point, and re-gating a live account on a Dexie miss would lock him out of his
    // own farm over a cleared cache. Re-consent on a NEW notice version is a server-side
    // decision, not a client cache one.
    //
    // A QR deep link (above) still goes straight to its own page: a worker who scanned the
    // owner's QR is not sent round स्वागत first. DECISION FOR THE FOUNDER (round-1 review F7): this
    // departs from PLR-D9 T8's order (स्वागत first for everyone). On that page the language can still
    // be changed — the consent tick's notice has the मराठी / English switch (ConsentNoticeSheet), and the
    // whole page follows it: every word there is `joinLandingCopy` in ONE language (round-2 LANG-2-QR).
    if (!isAuthenticated && showWelcome) {
        return (
            <AppShell>
                <FirstRunWelcome onStart={startFromWelcome} />
            </AppShell>
        );
    }
    return (
        <AppShell>
            {isAuthenticated
                ? (
                    <>
                        <AppContent crops={crops} setCrops={setCrops} />
                        {session?.userId && <NoticeChangeSheet userId={session.userId} />}
                    </>
                )
                : <LoginPage onBack={() => setShowWelcome(true)} />}
        </AppShell>
    );
};

// DEV-ONLY: ?preview=ops-admin bypasses auth entirely — mock data only.
//
// `import.meta.env.DEV` is load-bearing, not belt-and-braces. Both of these
// were a URLSearchParams check ALONE, which is a runtime test — it ships in
// the production bundle and stays reachable. `app.shramsafal.in?preview=labour`
// rendered a full screen of invented workers (रोकडे / रमेश / सुनीता), invented
// ₹ balances and invented plot percentages, to anyone, with no login. That is
// exactly what `P4` forbids, aimed at the public internet.
//
// The correct pattern is documented twelve lines below and was already in this
// release for the oversight preview: gate on DEV so Vite folds the branch to
// dead code. Vite statically replaces `import.meta.env.DEV` with `false` in a
// production build, so these constants become unconditionally false and the
// previews cannot render.
//
// NOT done here, deliberately: `React.lazy` would also drop the modules and
// their mock fixtures from the bundle entirely. That is the larger change the
// oversight preview made, and this cutover is fenced against drift — the
// screens are unreachable now, which is the farmer-facing defect. Carried to
// Wave 2 as the completing fix.
const DEV_PREVIEW = import.meta.env.DEV
    && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('preview') === 'ops-admin';

// DEV-ONLY: ?preview=labour — Labour Management UI (mock data, no auth/backend)
const LABOUR_PREVIEW = import.meta.env.DEV
    && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('preview') === 'labour';

// DEV-ONLY: ?preview=oversight — Owner Oversight Loop, full-app preview
// (spec: owner-oversight-loop). Unlike the two bypasses above, this one is
// ALSO gated on `IS_OVERSIGHT_PREVIEW_ENABLED` (`app/featureFlags.ts`, wraps
// `import.meta.env.DEV`) and loaded via `React.lazy`, so Vite/Rollup folds
// the whole branch to dead code and drops `OversightAppPreview` (and its
// seed fixtures) from a production bundle entirely — a query-param check
// alone would still ship the module. `OversightPreviewLazy` is `null`
// whenever the flag is off, which in a production build is unconditionally.
const OversightPreviewLazy = IS_OVERSIGHT_PREVIEW_ENABLED
    ? React.lazy(() => import('./features/oversight/OversightAppPreview'))
    : null;
const OVERSIGHT_PREVIEW = IS_OVERSIGHT_PREVIEW_ENABLED
    && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('preview') === 'oversight';

const App: React.FC = () => {
    const [crops, setCrops] = useState<CropProfile[]>([]);
    const [showSplash, setShowSplash] = useState(true);

    // Ops Phase 3 — catch unhandled JS rejections and report to telemetry
    useEffect(() => { installGlobalErrorHandlers(); }, []);

    // agrisync-prompt-ops Phase 4 — `?aiTest=1` toggles the AI test-mode flag
    // (banner appears via AiTestModeBanner). `?aiTest=0` clears all 3 keys.
    // Routed through infrastructure/storage/AiTestModeStore per the
    // localStorage-discipline gate (Sub-plan 04 Task 3).
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        if (params.get('aiTest') === '1') {
            setAiTestModeEnabled(true);
        } else if (params.get('aiTest') === '0') {
            clearAiTestMode();
        }
    }, []);

    // Native shell bars are configured after hooks are declared so preview mode
    // does not change hook ordering.
    useEffect(() => {
        if (!Capacitor.isNativePlatform()) {
            return;
        }

        const configureNativeBars = async () => {
            await StatusBar.setStyle({ style: Style.Light }).catch(() => undefined);
            await StatusBar.setBackgroundColor({ color: '#FAFAF9' }).catch(() => undefined);
            await StatusBar.setOverlaysWebView({ overlay: true }).catch(() => undefined);
            await SystemBars.setStyle({ style: SystemBarsStyle.Light }).catch(() => undefined);
            if (Capacitor.getPlatform() === 'android') {
                await NavigationBar.setNavigationBarColor({ color: '#FFFFFF', darkButtons: true }).catch(() => undefined);
            }
        };

        void configureNativeBars();
    }, []);

    // Dev preview bypass: rendered before any auth providers mount.
    if (DEV_PREVIEW) return <AdminOpsPreview />;
    if (LABOUR_PREVIEW) return <LabourPreview />;
    if (OVERSIGHT_PREVIEW && OversightPreviewLazy) {
        return (
            <React.Suspense fallback={null}>
                <OversightPreviewLazy />
            </React.Suspense>
        );
    }

    return (
        <BrowserRouter>
            <AppErrorBoundary>
                <AuthProvider>
                    <FarmContextProvider>
                    <DataSourceProvider>
                        <LanguageProvider>
                            <SelectionProvider crops={crops}>
                                <LogProvider crops={crops}>
                                    <OfflineBanner />
                                    {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}
                                    <AppFrame crops={crops} setCrops={setCrops} />
                                </LogProvider>
                            </SelectionProvider>
                        </LanguageProvider>
                    </DataSourceProvider>
                    </FarmContextProvider>
                </AuthProvider>
            </AppErrorBoundary>
        </BrowserRouter>
    );
};

export default App;
