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

// Direct literal access (`import.meta.env.VITE_E2E_HARNESS`) lets Vite
// constant-fold the value at build time, allowing the conditional
// `featureFlags.e2eHarness` lazy import in AppRouter to be tree-shaken.
export const featureFlags = {
    e2eHarness: import.meta.env.VITE_E2E_HARNESS === '1',
} as const;

export type FeatureFlags = typeof featureFlags;
