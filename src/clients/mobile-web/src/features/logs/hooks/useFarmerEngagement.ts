/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useFarmerEngagement — read-only hook over GET /shramsafal/engagement.
 * Fetches the server-folded DFES engagement projection for one farm. The FETCH
 * is gated on the DFES feature flags (disciplineSystem OR understandingMeter):
 * with both OFF — the production default — this hook issues ZERO network calls.
 * Returns null (no fetch) when farmId is absent. spec: dfes-companion-2026-07-11
 */
import { useCallback, useEffect, useState } from 'react';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { FEATURE_FLAGS } from '../../../app/featureFlags';
import type { FarmerEngagementDto } from '../../../infrastructure/api/resources/DfesResource';

export interface UseFarmerEngagementState {
    engagement: FarmerEngagementDto | null;
    isLoading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
}

export function useFarmerEngagement(
    farmId: string | null | undefined,
): UseFarmerEngagementState {
    const [engagement, setEngagement] = useState<FarmerEngagementDto | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        const dfesEnabled =
            FEATURE_FLAGS.disciplineSystem || FEATURE_FLAGS.understandingMeter;
        if (!farmId || !dfesEnabled) {
            setEngagement(null);
            setError(null);
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const dto = await agriSyncClient.getFarmerEngagement(farmId);
            setEngagement(dto);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Failed to load engagement.');
            setEngagement(null);
        } finally {
            setIsLoading(false);
        }
    }, [farmId]);

    useEffect(() => { void refresh(); }, [refresh]);

    return { engagement, isLoading, error, refresh };
}
