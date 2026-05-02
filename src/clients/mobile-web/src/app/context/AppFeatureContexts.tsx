import React, { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { useAgriLogApp } from '../compositionRoot';
import type { TodayCounts } from '../../types';

type AgriLogRuntime = ReturnType<typeof useAgriLogApp>;

interface ViewHelpers {
    getTodayCounts: (plotId: string, dateStr: string) => TodayCounts;
    getTodayPlotData: () => unknown[];
    getContextColorIndicator: () => ReactNode;
    getContextDisplay: () => ReactNode;
}

interface UiRuntime {
    handleReset: () => void;
    lastSavedLogSummary: AgriLogRuntime['lastSavedLogSummary'];
    lastSavedLogIds: string[];
}

const AppNavigationContext = createContext<AgriLogRuntime['navigation'] | undefined>(undefined);
const AppLogContext = createContext<AgriLogRuntime['context'] | undefined>(undefined);
const AppDataContext = createContext<AgriLogRuntime['data'] | undefined>(undefined);
const AppVoiceContext = createContext<AgriLogRuntime['voice'] | undefined>(undefined);
const AppCommandsContext = createContext<AgriLogRuntime['commands'] | undefined>(undefined);
const AppWeatherContext = createContext<AgriLogRuntime['weather'] | undefined>(undefined);
const AppTrustContext = createContext<AgriLogRuntime['trust'] | undefined>(undefined);
const AppViewHelpersContext = createContext<ViewHelpers | undefined>(undefined);
const AppUiRuntimeContext = createContext<UiRuntime | undefined>(undefined);

export const AppFeatureProviders: React.FC<{
    app: AgriLogRuntime;
    helpers: ViewHelpers;
    children: ReactNode;
}> = ({ app, helpers, children }) => (
    <AppNavigationContext.Provider value={app.navigation}>
        <AppLogContext.Provider value={app.context}>
            <AppDataContext.Provider value={app.data}>
                <AppVoiceContext.Provider value={app.voice}>
                    <AppCommandsContext.Provider value={app.commands}>
                        <AppWeatherContext.Provider value={app.weather}>
                            <AppTrustContext.Provider value={app.trust}>
                                <AppUiRuntimeContext.Provider
                                    value={{
                                        handleReset: app.handleReset,
                                        lastSavedLogSummary: app.lastSavedLogSummary,
                                        lastSavedLogIds: app.lastSavedLogIds
                                    }}
                                >
                                    <AppViewHelpersContext.Provider value={helpers}>
                                        {children}
                                    </AppViewHelpersContext.Provider>
                                </AppUiRuntimeContext.Provider>
                            </AppTrustContext.Provider>
                        </AppWeatherContext.Provider>
                    </AppCommandsContext.Provider>
                </AppVoiceContext.Provider>
            </AppDataContext.Provider>
        </AppLogContext.Provider>
    </AppNavigationContext.Provider>
);

const assertContext = <T,>(value: T | undefined, hookName: string): T => {
    if (!value) {
        throw new Error(`${hookName} must be used within AppFeatureProviders`);
    }
    return value;
};

export const useAppNavigationState = () => assertContext(useContext(AppNavigationContext), 'useAppNavigationState');
export const useAppLogState = () => assertContext(useContext(AppLogContext), 'useAppLogState');
export const useAppDataState = () => assertContext(useContext(AppDataContext), 'useAppDataState');
export const useAppVoiceState = () => assertContext(useContext(AppVoiceContext), 'useAppVoiceState');
export const useAppCommandsState = () => assertContext(useContext(AppCommandsContext), 'useAppCommandsState');
export const useAppWeatherState = () => assertContext(useContext(AppWeatherContext), 'useAppWeatherState');
export const useAppTrustState = () => assertContext(useContext(AppTrustContext), 'useAppTrustState');
export const useAppViewHelpers = () => assertContext(useContext(AppViewHelpersContext), 'useAppViewHelpers');
export const useAppUiRuntime = () => assertContext(useContext(AppUiRuntimeContext), 'useAppUiRuntime');
