import { useQuery } from '@tanstack/react-query';
import { adminApi, type AdminResponse } from '@/lib/api';
import { keepPreviousDataWithinOrg, useOrgKey } from '@/lib/orgQuery';

export interface FarmSummary {
  farmId: string; name: string; ownerPhone: string; plan: string;
  wvfd7d: number | null; engagementTier: string | null;
  errors24h: number; lastLogAt: string | null; createdAt: string;
}
export interface FarmsList { items: FarmSummary[]; totalCount: number; page: number; pageSize: number; }
export interface SilentChurnItem { farmId: string; name: string; ownerPhone: string; plan: string; weeksSilent: number; lastLogAt: string | null; }
export interface SufferingItem { farmId: string; name: string; errorCount: number; syncErrors: number; logErrors: number; voiceErrors: number; lastErrorAt: string; }

/**
 * THE ORG IS PART OF THE KEY (Preservation Register A7, Task 12 Step 3).
 *
 * Every row these three hooks return is scoped, server-side, to the
 * organisation in the `X-Active-Org-Id` header. Leave the org out of the key
 * and React Query answers the new organisation's question from the previous
 * organisation's cache the moment an admin switches. That is the whole reason
 * `OrgSwitcher` used to force a full page reload.
 *
 * Placement is a convention, not a preference: resource prefix, then org, then
 * the variables. It keeps `['farms']` working as an invalidation prefix, and
 * it puts the tenant where a reader looking for it will look.
 *
 * The key alone is not enough on a PAGINATED list. `keepPreviousData` (A25)
 * exists to hold the previous page's rows on screen while the next page loads,
 * and it will hold the previous ORGANISATION's rows just as happily. See
 * `lib/orgQuery.ts` — same behaviour across a page change, loading state
 * across an org change.
 */
export function useFarmsList(
  page: number,
  pageSize: number,
  search?: string,
  tier?: string,
  /**
   * `enabled: false` keeps the hook mounted but silent — the same gate
   * `useFarmerHealth` already offers (A28), spelled the same way so there is
   * one idiom for it in this console rather than two.
   *
   * ADDED IN TASK 13, for one reason that is a security property rather than
   * a performance one. The command palette indexes farm names and owner
   * phone numbers, and it must not ASK for them when the current scope says
   * the reader may not see them: an unconditional fetch would 403, and a 403
   * on a data endpoint invalidates the cached scope (App.tsx's QueryCache
   * onError), so a palette opened by an admin without `farms.list` would
   * quietly re-ask for the scope every time. Fail-closed at the request, not
   * at the render.
   */
  options?: { enabled?: boolean },
) {
  const org = useOrgKey();
  return useQuery<AdminResponse<FarmsList>>({
    queryKey: ['farms', 'list', org, page, pageSize, search, tier],
    queryFn: async () => {
      const sp = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search) sp.set('search', search);
      if (tier) sp.set('tier', tier);
      const { data } = await adminApi.get<AdminResponse<FarmsList>>(`/shramsafal/admin/farms?${sp}`);
      return data;
    },
    enabled: options?.enabled !== false,
    staleTime: 60_000, placeholderData: keepPreviousDataWithinOrg<AdminResponse<FarmsList>>(org),
  });
}
/**
 * THE SAME `enabled` GATE `useFarmsList` ALREADY CARRIES, AND FOR THE SAME
 * SECURITY REASON — added in Task 26, spelled identically so this console has
 * one idiom for "mounted but silent" rather than three.
 *
 * Home is the ONE screen with no route guard (Preservation Register A4), and
 * it mounts five hooks whose endpoints are each gated server-side on a
 * different module key. An admin who may open Home but holds none of those
 * keys would fire five requests that each come back a denial — and a denial
 * invalidates the cached scope (`App.tsx`'s `QueryCache.onError`), which
 * re-asks for the scope, which re-renders Home, which fires them again. Task 13
 * met exactly this shape on the command palette and closed it the same way:
 * FAIL CLOSED AT THE REQUEST, NOT AT THE RENDER.
 */
export interface FeedOptions {
  enabled?: boolean;
}

/**
 * THE SILENT-CHURN HOLD-OUT, AS ONE RULE READ BY TWO SCREENS.
 *
 * A row with no `lastLogAt` has nothing to count silence back from, so it is
 * held OUT of the watchlist: out of the list, out of the summary, out of every
 * facet count and out of the sort. Task 15 established it and proved it by
 * breaking it; Task 26 needs the same split to merge this feed with Suffering
 * on Home, and a second copy of the rule is how the conflation Task 15 deleted
 * ("never logged" and "logged and stopped" printed the same) comes back on one
 * screen and not the other.
 *
 * ⚠️ THE HELD-OUT SIDE IS EMPTY TODAY, BY CONSTRUCTION, AND THE GUARD STILL
 * SHIPS. `mis.silent_churn_watchlist` does `FROM sf JOIN last_log ll … WHERE
 * ll.last_log_at < NOW() - INTERVAL '14 days'` — an INNER JOIN plus a
 * comparison against NULL — so a farm with no log is dropped before the list
 * is built. The DTO's `LastLogAt` is nullable and the reader handles `DBNull`,
 * so the day the feed changes, the conflation must not come back with it.
 *
 * `weeksSilent` arrives as a plain non-null number on every row. For a row
 * with no `lastLogAt` that number was computed from nothing, so it is not a
 * reading — which is why the split keys on the last log and never on the week
 * count.
 */
export interface SilentChurnPartition {
  watchlist: SilentChurnItem[];
  heldOut: SilentChurnItem[];
}

export function partitionSilentChurn(rows: SilentChurnItem[]): SilentChurnPartition {
  const watchlist: SilentChurnItem[] = [];
  const heldOut: SilentChurnItem[] = [];
  for (const row of rows) (row.lastLogAt ? watchlist : heldOut).push(row);
  return { watchlist, heldOut };
}

export function useSilentChurn(options?: FeedOptions) {
  const org = useOrgKey();
  return useQuery<AdminResponse<SilentChurnItem[]>>({
    queryKey: ['farms', 'silent-churn', org],
    queryFn: async () => { const { data } = await adminApi.get<AdminResponse<SilentChurnItem[]>>('/shramsafal/admin/farms/silent-churn'); return data; },
    enabled: options?.enabled !== false,
    staleTime: 300_000,
  });
}
export function useSuffering(options?: FeedOptions) {
  const org = useOrgKey();
  return useQuery<AdminResponse<SufferingItem[]>>({
    queryKey: ['farms', 'suffering', org],
    queryFn: async () => { const { data } = await adminApi.get<AdminResponse<SufferingItem[]>>('/shramsafal/admin/farms/suffering'); return data; },
    enabled: options?.enabled !== false,
    staleTime: 60_000, refetchInterval: 60_000,
  });
}
