import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { useOrgKey } from '@/lib/orgQuery';
import type { FeedOptions } from './useFarms';

export interface OpsErrorEvent {
  eventType: string;
  endpoint: string;
  statusCode: number | null;
  latencyMs: number | null;
  farmId: string | null;
  occurredAtUtc: string;
}
export interface OpsFarmError {
  farmId: string;
  errorCount: number;
  syncErrors: number;
  logErrors: number;
  voiceErrors: number;
  lastErrorAt: string;
}
export interface OpsHealthData {
  voiceInvocations24h: number;
  voiceFailures24h: number;
  voiceFailureRatePct: number;
  voiceAvgLatencyMs: number;
  voiceP95LatencyMs: number;
  recentErrors: OpsErrorEvent[];
  topSufferingFarms: OpsFarmError[];
  apiErrorSpike: boolean | null;
  voiceDegraded: boolean | null;
  computedAtUtc: string;
}

/**
 * THE `recentErrors` WINDOW IS TWO HOURS AND ITS CAP IS FIFTY — read in
 * `AdminOpsRepository.GetRecentErrorsAsync` (`:85-123`) on 2026-09-01, and
 * recorded here because Task 26 needed it and the plan assumed otherwise.
 *
 * `WHERE event_type IN ('api.error','api.slow','client.error') AND
 *  occurred_at_utc >= NOW() - INTERVAL '2 hours' ORDER BY occurred_at_utc DESC
 *  LIMIT 50`, ending in `catch { /* graceful *\/ }` over a pre-declared empty
 * list. Three consequences a caller must not discover by accident:
 *
 *   1. There is NO 24-hour API-error count on this endpoint. The plan's Home
 *      tile asked for one; the nearest true reading is a 2-hour count, and
 *      Home says two hours because two hours is what was measured.
 *   2. An EMPTY list is not a quiet window. The catch and a genuinely calm two
 *      hours arrive identically, with HTTP 200.
 *   3. FIFTY ROWS IS A FLOOR. At the cap the count is "at least 50", and a
 *      subcount of one event type within it is a floor twice over.
 */
export const OPS_HEALTH_RECENT_WINDOW = 'the last 2 hours';
export const OPS_HEALTH_RECENT_CAP = 50;

/** Org in the key (A7, T12 S3) — see the note in `useFarms.ts`.
 *  `options.enabled` is the fail-closed gate documented on `useSilentChurn`. */
export function useOpsHealth(options?: FeedOptions) {
  const org = useOrgKey();
  return useQuery<OpsHealthData>({
    queryKey: ['ops', 'health', org],
    queryFn: async () => {
      const { data } = await adminApi.get<OpsHealthData>('/shramsafal/admin/ops/health');
      return data;
    },
    enabled: options?.enabled !== false,
    staleTime: 25_000,
    refetchInterval: 30_000,
  });
}

/**
 * `useOpsHealthWrapped` WAS HERE. Deleted in Task 20 (D10).
 *
 * A dead duplicate of the hook above on the SAME endpoint with a divergent
 * query key and zero callers (verified again before deleting: `grep` found it
 * only in its own definition and in the tenancy contract test that mounted it).
 * Wiring it beside `useOpsHealth` would have polled `/shramsafal/admin/ops/health`
 * TWICE every 30 seconds — on a 2-vCPU box with a measured ceiling of about 32
 * simultaneous requests, and behind a 30-second server-side output cache that
 * would have served the second call a byte-identical body.
 *
 * Task 12 gave it an org key anyway, deliberately, so that an org-LESS data key
 * could not sit in the file the next hook gets copied from. That reason expires
 * with the hook, and this note is what replaces it: the file it would have been
 * copied from now contains exactly one key, and that key carries the org.
 *
 * It also typed the response as `AdminResponse<OpsHealthData>`, which is the
 * A27 mistake in source form — this endpoint sends no envelope, so the hook
 * would have handed every caller `data.data === undefined` and a `meta` that
 * was never there.
 */
