import React, { useEffect, useState } from 'react';
import { installGlobalErrorHandlers } from './infrastructure/telemetry/ClientErrorReporter';
import { AdminOpsPreview } from './features/admin/ops/AdminOpsPreview';
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
import AppShell from './app/components/AppShell';
import LoginPage from './pages/LoginPage';
import JoinFarmLandingPage from './features/onboarding/JoinFarmLandingPage';

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
    const { isAuthenticated } = useAuth();
    const [joinActive, setJoinActive] = useState<boolean>(hasJoinDeepLink);

    // The QR deep-link wins over login. Semi-literate workers must never
    // see a generic password screen when they scan a farm QR.
    if (joinActive) {
        return (
            <AppShell>
                <JoinFarmLandingPage onComplete={() => setJoinActive(false)} />
            </AppShell>
        );
    }

    return (
        <AppShell>
            {isAuthenticated ? <AppContent crops={crops} setCrops={setCrops} /> : <LoginPage />}
        </AppShell>
    );
};

// DEV-ONLY: ?preview=ops-admin bypasses auth entirely — mock data only
const DEV_PREVIEW = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('preview') === 'ops-admin';

const App: React.FC = () => {
    const [crops, setCrops] = useState<CropProfile[]>([]);
    const [showSplash, setShowSplash] = useState(true);

    // Ops Phase 3 — catch unhandled JS rejections and report to telemetry
    useEffect(() => { installGlobalErrorHandlers(); }, []);

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
