import { useQuery } from '@tanstack/react-query';
import { farmerHealthApi } from '../api/farmerHealthApi';

/**
 * Mode A drilldown query — single farm, current week + 14-day timeline.
 *
 * Used by `FarmerSearchBox` (to validate a typed farmId before navigating)
 * and by `FarmerHealthDrilldown` (D.4) to render the page payload.
 *
 * Pass `enabled: false` to keep the hook mounted but inactive (e.g. before
 * a search submit). Pass an empty string for `farmId` to disable
 * automatically.
 */
export function useFarmerHealth(farmId: string | null | undefined, options?: { enabled?: boolean }) {
  const trimmed = (farmId ?? '').trim();
  const explicitlyDisabled = options?.enabled === false;
  return useQuery({
    queryKey: ['farmer-health', 'drilldown', trimmed],
    queryFn: ({ signal }) => farmerHealthApi.getFarmerHealth(trimmed, signal),
    enabled: !explicitlyDisabled && trimmed.length > 0,
    staleTime: 60_000,
    retry: 0, // 404s should fail fast — search box uses this for "not found" UX
  });
}
