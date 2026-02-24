import React, { useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { CropProfile } from './types';
import { LogProvider } from './app/context/LogContext';
import { AppErrorBoundary } from './app/components/common/AppErrorBoundary';
import AppContent from './AppContent';
import { LanguageProvider } from './i18n/LanguageContext';
import SplashScreen from './shared/components/ui/SplashScreen';
import { DataSourceProvider } from './app/providers/DataSourceProvider';
import { SelectionProvider } from './app/context/SelectionContext';
import { AuthProvider } from './app/providers/AuthProvider';
import { OfflineBanner } from './features/sync';

// Top-Level State: Crops (Required for LogProvider derivation)
// Note: Crops will eventually move to DataSource, but for now App maintains initial state
// or we fetch from DataSource inside. 
// Ideally LogProvider needs crops. 
// Let's wrap everything in DataSourceProvider.
const App: React.FC = () => {
    // Top-Level State: Crops (Required for LogProvider derivation)
    const [crops, setCrops] = useState<CropProfile[]>([]);
    const [showSplash, setShowSplash] = useState(true);

    return (
        <BrowserRouter>
            <AppErrorBoundary>
                <AuthProvider>
                    <DataSourceProvider>
                        <LanguageProvider>
                            <SelectionProvider crops={crops}>
                                <LogProvider crops={crops}>
                                    <OfflineBanner />
                                    {showSplash && <SplashScreen onComplete={() => setShowSplash(false)} />}
                                    <AppContent crops={crops} setCrops={setCrops} />
                                </LogProvider>
                            </SelectionProvider>
                        </LanguageProvider>
                    </DataSourceProvider>
                </AuthProvider>
            </AppErrorBoundary>
        </BrowserRouter>
    );
};

export default App;
