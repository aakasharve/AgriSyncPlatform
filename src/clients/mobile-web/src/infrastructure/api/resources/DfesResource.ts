/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DfesResource — DFES companion read endpoints (dfes-companion-2026-07-11).
 * Currently one route: GET /shramsafal/engagement?farmId=... returning the
 * read-only farmer-engagement projection folded server-side from
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
