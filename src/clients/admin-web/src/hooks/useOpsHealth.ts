import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { useOrgKey } from '@/lib/orgQuery';

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

/** Org in the key (A7, T12 S3) — see the note in `useFarms.ts`. */
export function useOpsHealth() {
  const org = useOrgKey();
  return useQuery<OpsHealthData>({
    queryKey: ['ops', 'health', org],
    queryFn: async () => {
      const { data } = await adminApi.get<OpsHealthData>('/shramsafal/admin/ops/health');
      return data;
    },
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
