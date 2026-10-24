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
     * Task 8 (spec: dfes-companion-2026-07-11) — "Sathi talks back": ONE
     * short warm Marathi line, spoken once ever per farm, when the farmer
     * reaches the 25-rich-days unlock. Web `speechSynthesis` only, no
     * native dependency. Default OFF (env VITE_SPOKEN_UNLOCK_REWARD absent
     * -> false); when OFF the speak effect returns immediately (no speak,
     * no localStorage write) — byte-equivalent no-op. `mr-IN` voice
     * availability is device-dependent on cheap Android (the build
     * degrades to silence, never throws/blocks) — real-device verification
     * of an audible Marathi voice is a separate gate before flipping this on.
     */
    spokenUnlockReward: isEnabled('VITE_SPOKEN_UNLOCK_REWARD'),

    /**
     * Founder decision 2026-07-19 — PAUSE the rich-day unlock counter.
     *
     * The "x/25" progress line is the ONLY farmer-facing surface of the
     * 25-rich-day milestone, and that milestone exists solely to unlock the
     * spoken "Sathi talks back" reward, which is deferred to a later session.
     * Showing a counter that cannot move (a BasicWorkDay has advancesBar=false)
     * reads as "you made no progress" — the exact shame the dignity contract
     * forbids. Pausing HIDES the counter line only.
     *
     * The Understanding Bar itself is NOT gated by this: the day's score is
     * always shown when the server returns one. Unlock gates talk-back, never
     * the bar. Default OFF (env VITE_UNLOCK_COUNTER_PAUSED absent -> false),
     * so production behaviour is unchanged until the flag is set.
     */
    unlockCounterPaused: isEnabled('VITE_UNLOCK_COUNTER_PAUSED'),

    /**
     * DEV TEST GROUND — force the post-25-rich-days unlocked state without
     * waiting 25 real days, so the after-unlock experience (and later the
     * spoken reward) can be exercised locally.
     *
     * Simulation ONLY: it overrides the DISPLAYED arrival state; it never
     * writes to the server, never fabricates rich days, and never changes
     * what the engine scored. Default OFF (env VITE_SIMULATE_UNLOCK absent
     * -> false) and it must stay OFF in production.
     */
    simulateUnlock: isEnabled('VITE_SIMULATE_UNLOCK'),
} as const;
