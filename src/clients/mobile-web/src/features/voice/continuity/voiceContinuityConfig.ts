/**
 * Module-local voice-continuity constants. NOT scoring tunables — deliberately
 * OUTSIDE DfesTuning (whose shape is locked to richDayThreshold/ShramPointValues/
 * StreakRules etc.). These govern re-interpretation retry behaviour only.
 */
export const VOICE_CONTINUITY = {
    /** Drop a pending capture after this many failed drain attempts. */
    MAX_REINTERPRET_ATTEMPTS: 5,
    /** Minimum gap between drain attempts on the same capture (ms). */
    REINTERPRET_COOLDOWN_MS: 60_000,
} as const;
