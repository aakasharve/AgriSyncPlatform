/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DfesResource — DFES companion read endpoints (dfes-companion-2026-07-11).
 * Two routes:
 *   GET /shramsafal/engagement?farmId=...        → farmer-engagement projection
 *   GET /shramsafal/day-understanding?farmId=&date=  → farmer-facing Day
 *       Understanding Score (X/10) for the active farm's day.
 * Both are read-only projections folded server-side from
 * ssf.daily_richness_aggregates.
 */
import type { HttpTransport } from '../transport';

export interface FarmerEngagementDto {
    currentStreak: number;
    longestStreak: number;
    totalShramPoints: number;
    lastAccountedDate: string | null;
    totalRichDays: number;
    unlockStatus: 'locked' | 'unlocked';
}

export async function getFarmerEngagement(
    t: HttpTransport,
    farmId: string,
): Promise<FarmerEngagementDto> {
    const response = await t.http.get<FarmerEngagementDto>(
        `/shramsafal/engagement?farmId=${encodeURIComponent(farmId)}`,
    );
    return response.data;
}

/**
 * The Day Understanding Score — the ASSISTANT's understanding of the farmer's
 * day, on a 0–10 scale. Computed server-side from the 3 internal lenses, which
 * NEVER cross this boundary: the wire shape is deliberately `{ score }` ONLY.
 * `score === null` means "not enough understood yet" (never a 0, never shame).
 */
export interface DayUnderstandingDto {
    score: number | null;
}

export async function getDayUnderstanding(
    t: HttpTransport,
    farmId: string,
    date?: string,
): Promise<DayUnderstandingDto> {
    const query = date
        ? `?farmId=${encodeURIComponent(farmId)}&date=${encodeURIComponent(date)}`
        : `?farmId=${encodeURIComponent(farmId)}`;
    const response = await t.http.get<DayUnderstandingDto>(
        `/shramsafal/day-understanding${query}`,
    );
    return response.data;
}
