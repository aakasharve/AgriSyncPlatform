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

// spec: owner-oversight-loop
// DEV-ONLY preview route (`?preview=oversight`, `App.tsx`) must be
// IMPOSSIBLE to reach in a production build — not just query-param-gated,
// the way the earlier `?preview=ops-admin`/`?preview=labour` bypasses in
// `App.tsx` are (both predate this rule; out of this task's scope to
// change). `import.meta.env.DEV` is a Vite build-time constant — `true`
// under `vite dev`, statically folded to the literal `false` in a
// production `vite build` — so gating a `React.lazy(() => import(...))`
// branch on it, exactly like `IS_E2E_HARNESS_ENABLED` gates `TestE2EPage`
// above, lets Rollup eliminate that branch as dead code and drop the
// imported preview module (and its seed fixtures) from the production
// bundle entirely, not just hide it behind an unreachable `if`.
export const IS_OVERSIGHT_PREVIEW_ENABLED: boolean = import.meta.env.DEV;

// DWC v2 §2.9 — runtime feature flags object. Plan placed this at
// `shared/feature-flags/flags.ts`, but the existing repo convention is
// `app/featureFlags.ts`; a second location would split the source of
// truth. The DwcChip flag is ON in development and OFF in production
// builds so QA can iterate without exposing the chip to live users
// before the v2 ramp. Override via VITE_DWC_CHIP=1 if needed in a prod
// preview build (handled by the runtime env helpers above).
export const FEATURE_FLAGS = {
    DwcChip: import.meta.env.MODE === 'development' || isEnabled('VITE_DWC_CHIP'),
    /**
     * Understanding Meter (W1.P3.T1).
     * Gates the DISPLAY of the VlogScore meter in the UI.
     * The scoreVlog ENGINE is always callable; this flag only controls rendering.
     * Default: OFF — enable via VITE_UNDERSTANDING_METER=1 in a preview build.
     * Full ±8 calibration deferred (needs W1.P2 provenance + calibration fixtures).
     */
    understandingMeter: isEnabled('VITE_UNDERSTANDING_METER'),
} as const;
