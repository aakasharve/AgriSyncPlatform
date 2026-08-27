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
import { LanguageProvider, useLanguage } from './i18n/LanguageContext';
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
import { useMorningNotificationWiring } from './app/hooks/useMorningNotificationWiring';
import ConsentGateScreen from './features/consent/gate/ConsentGateScreen';
import { useConsentGate } from './features/consent/gate/useConsentGate';
import { recordConsentGateAcceptance } from './features/consent/gate/consentGateApi';
// spec: 2026-08-25-prod-cutover-waves (B1) — the pre-login acceptance gets its owner.
import { rememberConsentGateAcceptanceForLinking } from './features/consent/gate/consentGateLinkReconciler';
import { useConsentGateLinkReconciliation } from './features/consent/gate/useConsentGateLink';
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
    const { t } = useLanguage();

    // spec: dfes-companion-2026-07-11 (wave-4.1) — first-open Terms + DPDP consent gate.
    // Read here, at the top of AppFrame, because the gate is PRE-LOGIN: it stands in
    // front of LoginPage, not behind it.
    const consentGate = useConsentGate();

    // Task 7 (spec: dfes-companion-2026-07-11) — daily 7am "आजची कामे पाहा"
    // native local notification. Flag-off / non-native no-op is guaranteed
    // inside the hook — see useMorningNotificationWiring.ts.
    useMorningNotificationWiring(isAuthenticated, t('dfes.morningNotificationTitle'));

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

    // spec: dfes-companion-2026-07-11 (wave-4.1) — the gate stands in front of LoginPage.
    //
    // Only when the answer is KNOWN. `undecided` means the Dexie read has not settled, and
    // "not loaded" is indistinguishable from "never accepted" — acting on it would flash a
    // full-screen legal notice at every cold start of a farmer who accepted weeks ago.
    // SplashScreen already owns that window (App renders it until `showSplash` clears).
    //
    // Not shown to an authenticated session: a farmer who is already signed in accepted at
    // some point, and re-gating a live account on a Dexie miss would lock him out of his
    // own farm over a cleared cache. Re-consent on a NEW notice version is a server-side
    // decision, not a client cache one.
    if (!isAuthenticated && consentGate.status === 'required') {
        return (
            <AppShell>
                <ConsentGateScreen
                    onAccept={async (acceptance) => {
                        // wave-4.2 — the two legal records are written FIRST. markPassed
                        // runs only after both ids come back; a throw leaves the gate up
                        // and shows the failure. Letting him through on a failed write
                        // would mean the app holds data with no record of the basis for
                        // holding it, which is the one outcome consent exists to prevent.
                        await recordConsentGateAcceptance(
                            acceptance, consentGate.preRegistrationSessionId);

                        // B1 — keep what was DISPLAYED so it can be restated once an
                        // account exists. After the accepting write, never before: a
                        // payload stored for an acceptance that never landed would later
                        // produce a linking row asserting a consent that does not exist.
                        //
                        // Deliberately NOT awaited. Doctrine P9 — a wedged IndexedDB must
                        // not be able to hold a farmer on the consent screen. Losing the
                        // race between this write and the app being killed costs one
                        // unlinked acceptance, which is the state we are already in.
                        void rememberConsentGateAcceptanceForLinking(
                            acceptance, consentGate.preRegistrationSessionId);

                        consentGate.markPassed();
                    }}
                />
            </AppShell>
        );
    }

    return (
        <AppShell>
            {isAuthenticated ? <AppContent crops={crops} setCrops={setCrops} /> : <LoginPage />}
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
