import { useQuery } from '@tanstack/react-query';
import { adminApi, type AdminResponse } from '@/lib/api';

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

export function useOpsHealth() {
  return useQuery<OpsHealthData>({
    queryKey: ['ops', 'health'],
    queryFn: async () => {
      const { data } = await adminApi.get<OpsHealthData>('/shramsafal/admin/ops/health');
      return data;
    },
    staleTime: 25_000,
    refetchInterval: 30_000,
  });
}

export function useOpsHealthWrapped() {
  return useQuery<AdminResponse<OpsHealthData>>({
    queryKey: ['ops', 'health', 'wrapped'],
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
