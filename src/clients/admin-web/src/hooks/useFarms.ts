import { useQuery } from '@tanstack/react-query';
import { adminApi, type AdminResponse } from '@/lib/api';
import { keepPreviousDataWithinOrg, useOrgKey } from '@/lib/orgQuery';

export interface FarmSummary {
  farmId: string; name: string; ownerPhone: string; plan: string;
  /** Checked days last complete India week; null when the farm saved no counted entry that week. */
  wvfd7d: number | null;
  /** Days last week confirmed only by the person who saved them; null with wvfd7d. */
  selfOnlyDays7d?: number | null;
  /** Set ("farm_unreadable") when the server could not count this farm's days: the cells say not measured. */
  confirmedDaysNotMeasuredReason?: string | null;
  engagementTier: string | null;
  errors24h: number; lastLogAt: string | null; createdAt: string;
}
/** The server answers a tier filter with 409 `tier_filter_too_many_farms` when it cannot count that many farms live. */
export function isTierFilterTooManyFarms(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const r = (error as { response?: { status?: unknown; data?: { code?: unknown } } }).response;
  return r?.status === 409 && r?.data?.code === "tier_filter_too_many_farms";
}
function errorBody(error: unknown): { status?: unknown; code?: unknown } {
  if (typeof error !== 'object' || error === null) return {};
  const r = (error as { response?: { status?: unknown; data?: { code?: unknown } } }).response;
  return { status: r?.status, code: r?.data?.code };
}
/** 409 `tier_filter_not_measured`: the server could not count every farm for the tier filter. */
export function isTierFilterNotMeasured(error: unknown): boolean {
  const b = errorBody(error);
  return b.status === 409 && b.code === 'tier_filter_not_measured';
}
export interface FarmsList {
  items: FarmSummary[];
  /** Farms matching, with farms owned by test accounts left out (the server's count). */
  totalCount: number;
  /** Test-owned farms matching that the list still shows; the list holds `totalCount + testFarmsShown` rows. Absent from an older server. */
  testFarmsShown?: number;
  page: number;
  pageSize: number;
}
export type SilentBand = '7-13' | '14-29' | '30+' | 'never';
export type SilentNotMeasuredReason = 'farm_list_unreadable' | 'too_many_farms_for_live_count';
/** One silent farm, as the server counts it (CR-2e C26). */
export interface SilentFarm {
  farmId: string;
  name: string;
  ownerPhone: string | null;
  band: SilentBand;
  daysSilent: number | null;
  lastEntryUtc: string | null;
  planCode: string | null;
  planStatus: number | null;
}
export interface SilentChurnAnswer {
  countedAtUtc: string;
  farms: SilentFarm[];
  notMeasuredReason: SilentNotMeasuredReason | null;
}
/** One farm with repeated problems in the last 7 days (3 or more). Names come from `useFarmContacts`. */
export interface SufferingItem {
  farmId: string;
  problemCount: number;
  syncProblems: number;
  entryProblems: number;
  voiceProblems: number;
  otherProblems: number;
  lastProblemAt: string;
}

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
    /* The server counts days live and audits each load: no retry (a 409 is an answer, not a fault). */
    retry: false,
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
 * SILENT FARMS, COUNTED LIVE ON REQUEST (CR-2e C26/C27).
 *
 * Each load writes audit rows on the server, so this query never polls and never
 * refetches on window focus. The short stale time only stops Home and the Silent
 * Churn page from asking twice in one visit.
 */
export function useSilentChurn(options?: FeedOptions) {
  const org = useOrgKey();
  return useQuery<AdminResponse<SilentChurnAnswer>>({
    queryKey: ['farms', 'silent-churn', org],
    queryFn: async () => { const { data } = await adminApi.get<AdminResponse<SilentChurnAnswer>>('/shramsafal/admin/farms/silent-churn'); return data; },
    enabled: options?.enabled !== false,
    /* Audited: each load writes audit rows, so a failure must write one, not two. */
    retry: false,
    staleTime: 30_000, refetchInterval: false, refetchOnWindowFocus: false,
  });
}
export function useSuffering(options?: FeedOptions) {
  const org = useOrgKey();
  return useQuery<AdminResponse<SufferingItem[]>>({
    queryKey: ['farms', 'suffering', org],
    queryFn: async () => { const { data } = await adminApi.get<AdminResponse<SufferingItem[]>>('/shramsafal/admin/farms/suffering'); return data; },
    enabled: options?.enabled !== false,
    retry: false,
    staleTime: 60_000, refetchInterval: false,
  });
}
