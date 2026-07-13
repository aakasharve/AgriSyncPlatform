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
    /**
     * Daily Clarity Loop v1 — the morning TRIGGER. Surfaces the single calm
     * "आज {N} कामं बाकी" hero at the top of the home idle view and folds the
     * carried-work ("काल राहिलं") signal in beside it, replacing the buried
     * English task line + the separate "Yesterday not fully closed" banner.
     * Reuses todayDayState.pendingCount — computes nothing new. Default OFF
     * (env VITE_DAILY_LOOP absent → false); when OFF the home view is a
     * byte-equivalent no-op.
     */
    dailyLoop: isEnabled('VITE_DAILY_LOOP'),

    /**
     * Task 1B (spec: dfes-companion-2026-07-11) — ONE Task 1A intelligence
     * fact rendered below the clarity line on the Saved-to-Ledger success
     * card. SEPARATE from `dailyLoop` on purpose (Decision 3B deferred the
     * fact/insight fallback): the founder can turn the daily-loop reward on
     * WITHOUT the facts. Default OFF (env VITE_INTELLIGENCE_INSIGHTS
     * absent -> false); when OFF this is a byte-equivalent no-op.
     */
    intelligenceInsights: isEnabled('VITE_INTELLIGENCE_INSIGHTS'),

    /**
     * Task 5 (spec: dfes-companion-2026-07-11) — "राहिलं → झालं" suggest-and-
     * confirm task close. Gates BOTH the `findConfirmableTaskCloses` matcher
     * call AND the `TaskCloseConfirm` card on the Saved-to-Ledger success
     * card. OFF is a genuine no-op: the matcher is never invoked (not just
     * hidden), so there is zero extra computation. Only the farmer's own
     * होय tap ever closes a task — this flag never enables a silent close.
     * Default OFF (env VITE_TASK_CLOSE_CONFIRM absent -> false).
     */
    taskCloseConfirm: isEnabled('VITE_TASK_CLOSE_CONFIRM'),

    /**
     * Task 7 (spec: dfes-companion-2026-07-11) — daily 7am "आजची कामे पाहा"
     * native local notification (Capacitor `@capacitor/local-notifications`)
     * that opens the app to today's tasks (`/?nudge=open-today`). Gates BOTH
     * the permission request AND the schedule call — OFF means no permission
     * prompt and no scheduled notification is ever created. Default OFF (env
     * VITE_MORNING_NOTIFICATION absent -> false); when OFF this is a
     * byte-equivalent no-op (native rebuild + real-device verification is a
     * separate founder gate before this can be flipped on).
     */
    morningNotification: isEnabled('VITE_MORNING_NOTIFICATION'),
} as const;
