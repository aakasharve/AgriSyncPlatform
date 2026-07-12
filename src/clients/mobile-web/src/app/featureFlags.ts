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

    /**
     * DFES D8 question engine (Phase 5). Gates the combined daily-question card in
     * the Shram Sathi meter. Default OFF — enable via VITE_STAGE_QUESTIONS=1 in a
     * preview build. The question card lives INSIDE the meter's arrived surface, so
     * it only shows when understandingMeter is ON too.
     */
    stageQuestions: isEnabled('VITE_STAGE_QUESTIONS'),

    // DFES companion (spec: dfes-companion-2026-07-11). All default OFF;
    // enabled only via VITE_* env in a preview build. Phase 3 does NOT flip
    // understandingMeter on by default.
    /** Phase 3 DisciplineStrip. */
    disciplineSystem: isEnabled('VITE_DISCIPLINE_SYSTEM'),
    /** Phase 4 voice-first continuity. */
    voiceContinuity: isEnabled('VITE_VOICE_CONTINUITY'),
} as const;
