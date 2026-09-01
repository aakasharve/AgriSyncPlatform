import { useQuery } from '@tanstack/react-query';
import { farmerHealthApi } from '../api/farmerHealthApi';
import { useOrgKey } from '@/lib/orgQuery';

/**
 * Mode B cohort patterns query — drives the Farmer Health landing page.
 *
 * Cadence: 60s stale + auto-refetch every 5 minutes (per DWC v2 plan §4.3
 * Step 3, pinned as data by `queryContracts.contract.test.tsx`). Cancels on
 * unmount via the abort signal (A28), so navigating away aborts the request
 * rather than resolving into an unmounted tree.
 *
 * The org is in the key (A7, T12 Step 3). This one matters more than most: the
 * cohort payload is farmer NAMES, and the endpoint is scoped by the
 * `X-Active-Org-Id` header alone.
 *
 * 🛑 THE RESPONSE HAS NO ENVELOPE. `GetCohortPatternsHandler.cs:34` returns
 * `Result<CohortPatternsDto>`, not `Result<AdminResponseDto<…>>`. The api
 * module normalises it — read that file's header before assuming `meta` is
 * there. `meta` is `undefined` today, which is why this screen carries no
 * freshness chip.
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
