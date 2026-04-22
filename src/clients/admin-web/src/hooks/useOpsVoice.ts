import { useQuery } from '@tanstack/react-query';
import { adminApi, type AdminResponse } from '@/lib/api';

export interface OpsVoiceDay {
  date: string;
  invocations: number;
  failures: number;
  successRatePct: number;
  avgLatencyMs: number;
}
export interface OpsVoiceTrend {
  days: OpsVoiceDay[];
}

export function useOpsVoice(days = 14) {
  return useQuery<AdminResponse<OpsVoiceTrend>>({
    queryKey: ['ops', 'voice', days],
    queryFn: async () => {
      const { data } = await adminApi.get<AdminResponse<OpsVoiceTrend>>(
        `/shramsafal/admin/ops/voice?days=${days}`
      );
      return data;
    },
    staleTime: 300_000,
    refetchInterval: 300_000,
  });
}
