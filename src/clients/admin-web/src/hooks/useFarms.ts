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
export function useFarmsList(page: number, pageSize: number, search?: string, tier?: string) {
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
    staleTime: 60_000, placeholderData: keepPreviousDataWithinOrg<AdminResponse<FarmsList>>(org),
  });
}
export function useSilentChurn() {
  const org = useOrgKey();
  return useQuery<AdminResponse<SilentChurnItem[]>>({
    queryKey: ['farms', 'silent-churn', org],
    queryFn: async () => { const { data } = await adminApi.get<AdminResponse<SilentChurnItem[]>>('/shramsafal/admin/farms/silent-churn'); return data; },
    staleTime: 300_000,
  });
}
export function useSuffering() {
  const org = useOrgKey();
  return useQuery<AdminResponse<SufferingItem[]>>({
    queryKey: ['farms', 'suffering', org],
    queryFn: async () => { const { data } = await adminApi.get<AdminResponse<SufferingItem[]>>('/shramsafal/admin/farms/suffering'); return data; },
    staleTime: 60_000, refetchInterval: 60_000,
  });
}
