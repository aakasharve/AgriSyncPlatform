import { useQuery } from '@tanstack/react-query';
import { adminApi, type AdminResponse } from '@/lib/api';
import { useOrgKey } from '@/lib/orgQuery';

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

/** Org in the key (A7, T12 S3) — see the note in `useFarms.ts`. */
export function useOpsVoice(days = 14) {
  const org = useOrgKey();
  return useQuery<AdminResponse<OpsVoiceTrend>>({
    queryKey: ['ops', 'voice', org, days],
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
