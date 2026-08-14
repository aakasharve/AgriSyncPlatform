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
 * day, on a 0–10 scale — plus the kind of day the SERVER recorded.
 *
 * The wire shape is deliberately `{ score, classification }` and nothing more.
 * The 3 internal lenses the score is computed from still NEVER cross this
 * boundary, and must not be added here.
 *
 * `score === null` means "not enough understood yet" (never a 0, never shame).
 *
 * `classification` is the day's STORED `DayClassification` — the string the
 * server's Phase-2 classifier already stamped on the day's aggregate — or null
 * when the server has no aggregate for that day (i.e. no opinion on what kind of
 * day it was). It crossed this boundary on founder ruling 2 (2026-08-14):
 * "Reward honesty and mark its consistency — no score needed for such days." On
 * a `'DeclaredNoWorkDay'` the farmer is shown NO number at all, and the client
 * cannot honour that without being told. The earlier "score only, NEVER cross
 * this boundary" note here is SUPERSEDED for this one field, deliberately and
 * for that reason.
 *
 * Read it, never recompute it: the server is the authority on what kind of day
 * it was (P4/P8). Deriving a classification on the client would be a fabricated
 * fact about the farmer's day.
 */
export interface DayUnderstandingDto {
    score: number | null;
    classification: string | null;
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
