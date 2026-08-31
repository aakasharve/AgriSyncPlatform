import { useQuery } from '@tanstack/react-query';
import { farmerHealthApi } from '../api/farmerHealthApi';
import { useOrgKey } from '@/lib/orgQuery';

/**
 * Mode B cohort patterns query — drives the Farmer Health landing page.
 *
 * Cadence: 60s stale + auto-refetch every 5 minutes (per DWC v2 plan §4.3 Step 3).
 * Cancels on unmount via the abort signal so navigation away aborts the request.
 *
 * The org is in the key (A7, T12 Step 3). This one matters more than most: the
 * cohort payload is farmer NAMES and phone numbers, and the endpoint is scoped
 * by the `X-Active-Org-Id` header alone.
 */
export function useCohortPatterns() {
  const org = useOrgKey();
  return useQuery({
    queryKey: ['farmer-health', 'cohort', org],
    queryFn: ({ signal }) => farmerHealthApi.getCohort(signal),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}
