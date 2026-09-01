import { useQuery } from '@tanstack/react-query';
import { adminApi, type AdminResponse } from '@/lib/api';
import { useOrgKey } from '@/lib/orgQuery';
import type { FeedOptions } from './useFarms';

/**
 * WVFD — WHAT `/shramsafal/admin/metrics/wvfd` ACTUALLY RETURNS.
 *
 * Read in the backend on 2026-09-01: `WvfdHistoryDto.cs`,
 * `GetWvfdHistoryHandler.cs`, `AdminMisRepository.GetWvfdHistoryAsync`
 * (`AdminMisRepository.cs:15-80`) and the matview the whole thing is a
 * `GROUP BY` over, `mis.wvfd_weekly`
 * (`20260817150453_WvfdWeekBoundaryToIst.cs:473-509`). The DTO's shape is
 * below; the eight properties that decide what the SCREEN may claim are in
 * `NorthStarPage.tsx`.
 *
 * The one that belongs HERE, because it is a property of the QUERY and not
 * of the screen: `weeks` is in the query key, and it has to be. Miss it and
 * 8, 12 and 24 resolve to one cache entry, react-query issues no request (the
 * cadence below is five minutes) and the console draws twelve weeks under a
 * heading that says twenty-four — with no request, no error and nothing for a
 * reader to notice. `NorthStarPage.test.tsx` proves it by mutation.
 */

export interface WvfdWeek {
  /**
   * The MONDAY the week starts on, as an IST week boundary:
   * `date_trunc('week', created_at_utc AT TIME ZONE 'Asia/Kolkata')`. A
   * farmer's 05:00 IST log is 23:30 UTC the previous day, and early morning
   * is when farm work happens — bucketing it in UTC put it in the wrong week
   * every day, which is what that migration exists to fix.
   */
  weekStart: string;
  /** `ROUND(AVG(wvfd), 2)` across the farms that HAVE A ROW in that week —
   *  see the denominator note in `NorthStarPage.tsx`. Never null on a week
   *  that appears at all; a week with no rows is simply absent. */
  avgWvfd: number;
  /** `COUNT(DISTINCT farm_id)` in that week. This is the average's OWN
   *  denominator, and it is the only measure of it this feed carries. */
  activeFarms: number;
}

export interface WvfdFarmRow {
  farmId: string;
  /** `LEAST(verified_farm_days, 7)` for this farm in the latest week. */
  wvfd: number;
  /** Derived from the same count, so tier is a MONOTONE function of `wvfd`:
   *  A >= 5, B 3-4, C 1-2, D 0. That is what makes the truncation note on the
   *  screen provable rather than a hedge. */
  engagementTier: 'A' | 'B' | 'C' | 'D';
  /**
   * 🛑 ALWAYS 0. `AdminMisRepository.cs:65` constructs every farm row with
   * `ActiveFarms: 0` — the field exists on the record and is never populated
   * from the query. It is not rendered anywhere, and it must not be: a
   * hardcoded 0 printed as a count is the fabrication this redesign exists to
   * remove, and it would look exactly like a measurement.
   */
  activeFarms: number;
}

export interface WvfdHistory {
  /**
   * The average for the NEWEST WEEK THAT HAS A ROW — `weekRows[^1].AvgWvfd`.
   *
   * 🛑 IT IS 0 WHEN THERE ARE NO WEEKS AT ALL. `weekRows.Count > 0 ? ... : 0m`
   * (`AdminMisRepository.cs:68`), and the catch one line further down returns
   * `new WvfdHistoryDto(0m, null, 4.5m, [], [])`. So a 0 here is the server's
   * substitution as often as it is a reading, and the screen rescues it the
   * same way `/ops/voice` rescues a 0ms latency.
   */
  currentWvfd: number;
  /**
   * `weekRows[^2].AvgWvfd` — the second-newest ROW, which is the previous
   * WEEK only when no week between them is missing. The screen therefore
   * names the week it compared against instead of saying "last week".
   */
  priorWvfd: number | null;
  /**
   * 🛑 A HARDCODED CONSTANT IN THE API. `GoalWvfd: 4.5m`
   * (`AdminMisRepository.cs:74`) — a C# literal, repeated in the failure path
   * at `:78`. There is no goals table, no configuration value and no admin
   * screen that sets it; the only other place the platform records it is a
   * doc-comment, `FarmWeekMisDto.cs:9` ("Rolling 7-day verified farm-days
   * (0-7). North Star target >= 4.5"), which names a window this endpoint does
   * not measure. It is a DECLARED product target, which is a different thing
   * from the fabricated 90% line Task 19 deleted from `/ops/voice` — that one
   * came from the client with nothing at all behind it. The screen keeps this
   * one, says where it comes from, and still routes it through `fmt` so a null
   * renders as an absence instead of falling back to a literal `4.5` in the
   * client, which is what it used to do three times over.
   */
  goalWvfd: number;
  weeks: WvfdWeek[];
  /**
   * NOT every farm: `ORDER BY w.wvfd DESC LIMIT 50` over the single latest
   * week (`AdminMisRepository.cs:49-58`). At 50 rows the list is a truncated
   * prefix of a WVFD-descending order, so the low tiers are cut off first.
   */
  topFarms: WvfdFarmRow[];
}

/** The server's `LIMIT 50` (`AdminMisRepository.cs:57`). Hitting it is how the
 *  screen knows the per-farm counts below are floors rather than counts. */
export const WVFD_FARM_LIMIT = 50;

/** The server's own clamp, `Math.Clamp(weeks, 4, 52)` (`AdminEndpoints.cs:167`). */
export const WVFD_MIN_WEEKS = 4;
export const WVFD_MAX_WEEKS = 52;

/** Org in the key (A7, T12 S3) — see the note in `useFarms.ts`.
 *  `options.enabled` is the fail-closed gate documented on `useSilentChurn`. */
export function useWvfd(weeks = 12, options?: FeedOptions) {
  const org = useOrgKey();
  return useQuery<AdminResponse<WvfdHistory>>({
    /* `weeks` IS LOAD-BEARING HERE. See the header. */
    queryKey: ['metrics', 'wvfd', org, weeks],
    queryFn: async () => {
      const { data } = await adminApi.get<AdminResponse<WvfdHistory>>(
        `/shramsafal/admin/metrics/wvfd?weeks=${weeks}`
      );
      return data;
    },
    enabled: options?.enabled !== false,
    staleTime: 300_000,
    refetchInterval: 300_000,
  });
}
