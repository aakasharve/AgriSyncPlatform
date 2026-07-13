/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * dfesTuning — frontend mirror of ShramSafal.Domain.Dfes.DfesTuning.
 *
 * THE SINGLE SOURCE of every DFES tunable on the client. Phases 2/3/5 read
 * from here — no component, hook, or service may hardcode any of these
 * numbers. Kept value-locked against the backend via dfesTuning.test.ts and
 * DfesTuningTests.cs (identical numbers, both sides).
 *
 * spec: dfes-companion-2026-07-11
 */
export const DFES_TUNING = {
  /** Rich DAYS before the understanding bar is considered arrived. */
  richDayThreshold: 25,
  /** count(advancesBar) at which unlockStatus flips to "unlocked" (set-once). */
  unlockThreshold: 25,
  /** Stamped onto every aggregate row (ScoreEngineVersion). */
  scoreEngineVersion: 'dfes-1',
  /** Max Shram points a single local date can earn after bonuses. */
  dailyPointCap: 15,
  /** Reward point values. */
  shramPointValues: {
    noWork: 2,
    basic: 5,
    rich: 10,
    observationBonus: 3,
    learningBonus: 5,
    followupBonus: 2,
  },
  /** Streak-fold rules. */
  streakRules: {
    advanceOnDeclaredNoWork: true,
    neutralOnRestDay: true,
    graceDaysBeforeBreak: 1,
  },
} as const;

export type DfesTuning = typeof DFES_TUNING;
