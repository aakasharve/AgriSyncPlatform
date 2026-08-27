/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * dfesWeatherReconcile — pure "severe weather, no logged impact" care-check
 * signal (Phase 5, Task 4B).
 *
 * Both fields it compares live on the SAME saved DailyLog:
 *   - `weatherStamp` (domain/types/weather.types.ts) — the recorded weather
 *     at log time (the Spine; real, not fabricated).
 *   - `disturbance.cause` (domain/types/log.types.ts) — the farmer's own
 *     structured "this blocked my work" claim, `'WEATHER'` being the
 *     weather-specific value (BucketIssueType).
 *
 * Fires ONLY when the weather was genuinely SEVERE (conservative,
 * founder-tunable thresholds below — never light/ordinary rain) AND the
 * farmer did NOT already log a weather disturbance for that day (never
 * double-ask). This is a warm care-check, never a doubt of the farmer's
 * account — the `reason` string is internal telemetry only and must never
 * reach the UI (see dfesQuestionEngine.ts's pack(), which never threads it
 * into the farmer-facing prompt).
 *
 * PURE: no Date.now(), no network, no React/DOM.
 *
 * spec: dfes-companion-2026-07-11
 */
import type { DailyLog } from '../../../domain/types/log.types';

/** Heavy-rain threshold (mm) — conservative; ordinary/light rain never qualifies. */
export const SEVERE_PRECIP_MM = 15;
/** Damaging-wind threshold (kph), checked against gust (falling back to sustained wind). */
export const SEVERE_WIND_GUST_KPH = 45;

export interface WeatherReconcileContext {
    severity: 'severe';
    /** Internal telemetry only — NEVER a farmer-facing claim, never shown in the UI. */
    reason: string;
}

/**
 * Returns a care-check context only when the saved log's own weatherStamp
 * was genuinely severe AND the farmer has not already logged a weather
 * disturbance for the same day. Otherwise returns null (no stamp, ordinary
 * weather, or already accounted for — never double-ask).
 */
export function reconcileWeather(savedLog: DailyLog | undefined): WeatherReconcileContext | null {
    const stamp = savedLog?.weatherStamp;
    if (!stamp) return null;

    // Farmer already told us weather blocked their work today — never double-ask.
    if (savedLog?.disturbance?.cause === 'WEATHER') return null;

    const heavyRain = stamp.precipMm >= SEVERE_PRECIP_MM;
    const damagingWind = (stamp.windGustKph ?? stamp.windKph ?? 0) >= SEVERE_WIND_GUST_KPH;
    const hasAlert = (stamp.alerts?.length ?? 0) > 0;

    if (!heavyRain && !damagingWind && !hasAlert) return null;

    const reason = heavyRain
        ? `precipMm ${stamp.precipMm} >= ${SEVERE_PRECIP_MM}`
        : damagingWind
            ? `windGust ${stamp.windGustKph ?? stamp.windKph} >= ${SEVERE_WIND_GUST_KPH}`
            : `alerts ${stamp.alerts?.length ?? 0} present`;

    return { severity: 'severe', reason };
}
