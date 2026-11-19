import { useQuery } from '@tanstack/react-query';
import { adminApi, type AdminResponse } from '@/lib/api';
import { useOrgKey } from '@/lib/orgQuery';
import type { FeedOptions } from './useFarms';

/**
 * CHECKED FARM-DAYS, COUNTED ON REQUEST (CR-2e Task 6, amendment C32).
 *
 * `GET /shramsafal/admin/metrics/wvfd?weeks=N` counts the days itself when the
 * page opens, farm by farm. The answer's shape is the server's
 * `WvfdHistoryDto`, camelCase.
 *
 * A day is "checked" when a person other than the one who saved the entry
 * checked it on purpose within 48 hours. A day confirmed only by the person who
 * saved it is counted apart as "self-only" and is never added to the checked
 * days (D-151 b is open).
 *
 * Weeks are India weeks, Monday to Sunday. The current week is partial
 * (`isPartial`) and is never compared with a full one.
 *
 * `weeks` is in the query key on purpose: without it 8, 12 and 24 weeks would
 * share one cache entry and the page would draw the wrong number of weeks.
 *
 * Each load opens the audited cross-farm reader on the server, so this query
 * never polls, never retries and never refetches on window focus.
 */

export type WvfdNotMeasuredReason = 'too_many_farms_for_live_count' | 'farm_list_unreadable';

export interface WvfdWeekDto {
  /** The Monday the India week starts on (date, `yyyy-MM-dd`). */
  weekStart: string;
  /** Average checked days per active farm; null when no farm was active. */
  avgWvfd: number | null;
  /** Average self-only days per active farm; null when no farm was active. */
  avgSelfOnlyDays: number | null;
  /** Farms that saved at least one counted entry that week. */
  activeFarms: number;
  /** True for the current week, which is not over yet. */
  isPartial: boolean;
}

export interface WvfdFarmRowDto {
  farmId: string;
  checkedDays: number;
  selfOnlyDays: number;
  engagementTier: string;
}

export interface WvfdHistoryDto {
  /** Last complete week; null when that week had no active farm. */
  currentWvfd: number | null;
  currentSelfOnlyDays: number | null;
  priorWvfd: number | null;
  /** Always null: no goal is set yet (W5). */
  goalWvfd: number | null;
  weeks: WvfdWeekDto[];
  farms: WvfdFarmRowDto[];
  countedAtUtc: string;
  notMeasuredReason: WvfdNotMeasuredReason | string | null;
}

/** The server's own clamp on `weeks`. */
export const WVFD_MIN_WEEKS = 4;
export const WVFD_MAX_WEEKS = 52;

/** Org in the key (A7, T12 S3) — see the note in `useFarms.ts`.
 *  `options.enabled` is the fail-closed gate documented on `useSilentChurn`. */
export function useWvfd(weeks = 12, options?: FeedOptions) {
  const org = useOrgKey();
  return useQuery<AdminResponse<WvfdHistoryDto>>({
    /* `weeks` IS LOAD-BEARING HERE. See the header. */
    queryKey: ['metrics', 'wvfd', org, weeks],
    queryFn: async () => {
      const { data } = await adminApi.get<AdminResponse<WvfdHistoryDto>>(
        `/shramsafal/admin/metrics/wvfd?weeks=${weeks}`
      );
      return data;
    },
    enabled: options?.enabled !== false,
    /* Audited on the server: no polling, no retry, no refetch on focus. */
    retry: false,
    staleTime: 0,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });
}
