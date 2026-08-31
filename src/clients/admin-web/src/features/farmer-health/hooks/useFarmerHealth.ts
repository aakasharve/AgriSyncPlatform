import { useQuery } from '@tanstack/react-query';
import { farmerHealthApi } from '../api/farmerHealthApi';
import { useOrgKey } from '@/lib/orgQuery';

/**
 * Mode A drilldown query — single farm, current week + 14-day timeline.
 *
 * Used by `FarmerSearchBox` (to validate a typed farmId before navigating)
 * and by `FarmerHealthDrilldown` (D.4) to render the page payload.
 *
 * Pass `enabled: false` to keep the hook mounted but inactive (e.g. before
 * a search submit). Pass an empty string for `farmId` to disable
 * automatically.
 *
 * The org is in the key (A7, T12 Step 3). A farm id is not globally unique to
 * an admin's view: the same id resolves — or fails to resolve — differently per
 * organisation, and the search box reads a 404 as "no such farm".
 */
export function useFarmerHealth(farmId: string | null | undefined, options?: { enabled?: boolean }) {
  const trimmed = (farmId ?? '').trim();
  const explicitlyDisabled = options?.enabled === false;
  const org = useOrgKey();
  return useQuery({
    queryKey: ['farmer-health', 'drilldown', org, trimmed],
    queryFn: ({ signal }) => farmerHealthApi.getFarmerHealth(trimmed, signal),
    enabled: !explicitlyDisabled && trimmed.length > 0,
    staleTime: 60_000,
    retry: 0, // 404s should fail fast — search box uses this for "not found" UX
  });
}
