import { useQuery } from '@tanstack/react-query';
import { farmerHealthApi } from '../api/farmerHealthApi';

/**
 * Mode B cohort patterns query — drives the Farmer Health landing page.
 *
 * Cadence: 60s stale + auto-refetch every 5 minutes (per DWC v2 plan §4.3 Step 3).
 * Cancels on unmount via the abort signal so navigation away aborts the request.
 */
export function useCohortPatterns() {
  return useQuery({
    queryKey: ['farmer-health', 'cohort'],
    queryFn: ({ signal }) => farmerHealthApi.getCohort(signal),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}
