import { adminApi, type AdminResponse } from '@/lib/api';
import type { CohortPatternsDto, FarmerHealthDto } from '../farmer-health.types';

/**
 * Typed client for the DWC v2 farmer-health endpoints.
 *
 * Endpoints (per src/AgriSync.Bootstrapper/AdminFarmerHealthEndpoints.cs):
 *  - GET /admin/farmer-health/{farmId}
 *  - GET /admin/farmer-health/cohort
 *
 * Auth + active-org headers + 401/403/428 handling are inherited from the
 * shared `adminApi` axios instance (see src/lib/api.ts).
 */
export const farmerHealthApi = {
  /** Mode A drilldown — single farm, current week + 14-day timeline. */
  async getFarmerHealth(
    farmId: string,
    signal?: AbortSignal,
  ): Promise<AdminResponse<FarmerHealthDto>> {
    const { data } = await adminApi.get<AdminResponse<FarmerHealthDto>>(
      `/admin/farmer-health/${encodeURIComponent(farmId)}`,
      { signal },
    );
    return data;
  },

  /** Mode B cohort — aggregated scoring + intervention/watchlist queues. */
  async getCohort(
    signal?: AbortSignal,
  ): Promise<AdminResponse<CohortPatternsDto>> {
    const { data } = await adminApi.get<AdminResponse<CohortPatternsDto>>(
      '/admin/farmer-health/cohort',
      { signal },
    );
    return data;
  },
};

export type FarmerHealthApi = typeof farmerHealthApi;
