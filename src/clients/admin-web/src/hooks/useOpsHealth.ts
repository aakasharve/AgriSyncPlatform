import { useQuery } from '@tanstack/react-query';
import { adminApi, type AdminResponse } from '@/lib/api';
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
 * A TWELFTH DATA KEY THE PLAN DID NOT NAME.
 *
 * Task 12's envelope lists eleven hooks; this dead duplicate is a twelfth data
 * key on the same endpoint, with ZERO callers (verified). It is scheduled for
 * deletion in Task 20 (D10). The org goes into its key anyway, because the one
 * thing that must not survive this task is an example of an org-less data key
 * sitting in the file a later hook gets copied from.
 *
 * The org sits at index 2 here as well, ahead of the wrapped discriminator,
 * because that position is a convention `lib/orgQuery.ts` reads by index and
 * `tenancy.contract.test.tsx` asserts for all twelve keys.
 */
export function useOpsHealthWrapped() {
  const org = useOrgKey();
  return useQuery<AdminResponse<OpsHealthData>>({
    queryKey: ['ops', 'health', org, 'wrapped'],
    queryFn: async () => {
      const { data } = await adminApi.get<AdminResponse<OpsHealthData>>(
        '/shramsafal/admin/ops/health'
      );
      return data;
    },
    staleTime: 25_000,
    refetchInterval: 30_000,
  });
}
