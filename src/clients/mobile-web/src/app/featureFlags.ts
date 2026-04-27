interface ViteEnvShape {
    env?: Record<string, unknown>;
}

const readEnv = (key: string): string =>
    String(((import.meta as ViteEnvShape).env?.[key] ?? '')).trim().toLowerCase();

const isEnabled = (key: string): boolean => {
    const value = readEnv(key);
    return value === '1' || value === 'true' || value === 'yes' || value === 'on';
};

export const isFarmGeographyV2Enabled = (): boolean =>
    isEnabled('VITE_FARM_GEOGRAPHY_V2');

export const isWeatherBackendFetchEnabled = (): boolean =>
    isEnabled('VITE_WEATHER_BACKEND_FETCH');

export const isVoiceDoomLoopDetectorEnabled = (): boolean =>
    !['0', 'false', 'off', 'no'].includes(readEnv('VITE_VOICE_DOOM_LOOP_DETECTOR'));

// Direct literal-comparison form so Vite can constant-fold this at build
// time and tree-shake the gated `React.lazy(() => import('../pages/TestE2EPage'))`
// branch in AppRouter. The other flags above use the dynamic `isEnabled`
// helper because they are runtime gates; this one is a build-time gate.
// VITE_E2E_HARNESS=1 in CI's E2E job; absent in prod.
export const IS_E2E_HARNESS_ENABLED: boolean = import.meta.env.VITE_E2E_HARNESS === '1';

export const isE2EHarnessEnabled = (): boolean => IS_E2E_HARNESS_ENABLED;
