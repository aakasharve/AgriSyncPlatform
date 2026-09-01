import { useQuery } from '@tanstack/react-query';
import { farmerHealthApi } from '../api/farmerHealthApi';
import { useOrgKey } from '@/lib/orgQuery';

/**
 * Mode A drilldown query — single farm, current week + 14-day timeline.
 *
 * Used by `FarmerSearchBox` (to PROBE a typed id before navigating anywhere)
 * and by `FarmerHealthDrilldown` to render the page payload.
 *
 * ── `retry: 0` AND THE `enabled` GATE ARE THE PRODUCT, NOT A TUNING (A28) ──
 * Both are deliberate and both are load-bearing for the search box:
 *
 *   `retry: 0`   A 404 must FAIL FAST and become not-found UX. React Query's
 *                global default in this console is `retry: 1` (`App.tsx:34-42`),
 *                and inheriting it here does not produce a wrong answer — it
 *                produces a two-attempt hang before the same answer. A person
 *                typing a wrong id waits through a doubled round trip and then
 *                sees "couldn't find that farmer", which reads as a slow
 *                console rather than as a typo.
 *
 *   `enabled`    The IDLE-BUT-MOUNTED mode. The search box mounts this hook
 *                with nothing submitted and fires it only on an explicit
 *                submit. Without the gate the hook would query on every
 *                keystroke that changed the argument.
 *
 * Pass `enabled: false` to hold it idle; an empty or whitespace-only `farmId`
 * disables it too, so a cleared box cannot start a request for ''.
 *
 * The org is in the key (A7, T12 Step 3). A farm id is not globally unique to
 * an admin's view: the same id resolves — or fails to resolve — differently per
 * organisation, and the search box reads a 404 as "no such farm IN YOUR SCOPE".
 *
 * 🛑 No envelope — see `farmerHealthApi`'s header. `data.data` is the farmer,
 * normalised by that module, not by the server.
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
    retry: 0, // 404s must fail fast — the search box's not-found path depends on it (A28)
  });
}
